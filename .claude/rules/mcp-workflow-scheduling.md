---
paths:
  - "mcp/**"
---

# 📅 Workflow Scheduling

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Scheduled workflows run through Mastra's built-in `mastra.schedules`, which persists each
schedule as a storage row rather than holding it in memory.

**Key Features:**
- **Durable**: a schedule survives a restart or redeploy, and can be paused, resumed, retimed or
  fired once through `mastra.schedules` (and over `/api/schedules`) with no deploy
- **Reconciled on boot**: `mastra/schedule-reconciler.ts` is the source of truth; the stored rows
  are brought in line with it every time the server starts
- **Timezone support**: every cadence is stored with `Europe/Copenhagen`
- **Run on startup**: a declaration can also fire once at boot, for workflows that catch up on
  what happened while the process was down
- **Pre-defined patterns**: cadences named in `utils/workflows/cron-patterns.ts`
- **Error handling**: a scheduled run that throws is reported through the instance's
  `scheduler.onError`, which logs it with the schedule id and the error intact. Without that
  handler the rejection is swallowed with nothing to say which schedule it came from.

**How to Schedule a Workflow:**

Add a declaration to `SCHEDULED_WORKFLOWS` in `mcp/mastra/schedule-reconciler.ts`:

```typescript
export const SCHEDULED_WORKFLOWS: ScheduledWorkflowDeclaration[] = [
  {
    workflowId: myWorkflow.id,
    cron: CronPatterns.EVERY_3_HOURS,
  },
  {
    workflowId: myStartupWorkflow.id,
    cron: CronPatterns.EVERY_MINUTE,
    runOnStartup: true,
  },
];
```

The workflow must also be registered in the `workflows` map in `mastra/index.ts` — the boot path
refuses to start otherwise, because a schedule whose target cannot be resolved is deleted by the
scheduler about thirty seconds later, silently.

**Reconciliation rules:**
- Rows are matched to declarations by workflow id
- Removing a declaration deletes its row; a durable row outlives the code that created it
- The sweep only touches rows tagged `managedBy: hey-jarvis-scheduler`, so a schedule created at
  runtime or by another feature survives a deploy
- A runtime pause is not permanent: reconciliation restates `status: active`, because the
  declarations are what say whether a schedule should be running

**Only `mcp-server` fires schedules:**
The container runs `mcp-server` and `mastra dev` side by side (`mcp/supervisord.conf`), both on
the same `mastra.sql.db`. `mastra dev` starts its workers unconditionally, and Mastra starts a
scheduler for any schedule rows it finds — so until this was pinned down, both processes polled
the same rows every ten seconds, raced to claim each fire, and ran the winner's workflow in
whichever process won. Twice the writers on one SQLite write lock is what produced the
`Failed to claim due schedule fire` / `SQLITE_BUSY: database is locked` bursts on the Pi, and the
400 Studio answered a chat with. `ownsSchedules()` in `schedule-reconciler.ts` reads the
`MASTRA_DEV=true` that `mastra dev` sets on the server it spawns, and `mastra/index.ts` passes
`scheduler: { enabled: false }` there. Studio can still list, pause and edit schedules; it just
never fires them.

**Runs left behind by a restart:**
`mastra dev` asks Mastra to restart every active workflow run once its server is up. A scheduled
run is persisted as `running` with `activePaths: []` and keeps that until it ends — the
event-driven engine only records a position on end, failure or suspend — so one interrupted
mid-flight can never be restarted: the engine starts at index `undefined`, runs no step, and
throws `undefined is not an object (evaluating 'lastOutput.result')`. Every crash left more of
them, and every boot logged the error once per orphan. `retireUnrestartableRuns`
(`workflow-run-recovery.ts`) marks them failed with the reason on the run, alongside runs whose
workflow graph has changed. It only retires positionless runs in the process that owns the
schedules, at boot, before its scheduler starts — from `mastra dev` such a run is
indistinguishable from one `mcp-server` is executing right now. That means `mastra dev` can still
log the error for a scheduled run that happens to be in flight when it boots; the restart throws
before running any step, so it changes nothing.

**SQLite connections:**
Every table lives in `mastra.sql.db`, opened by LibSQLStore and by each class in
`mastra/storage/`, in both processes. Open a new connection with `openSqliteClient`
(`storage/sqlite-client.ts`), never a bare `createClient({ url })`: the bare client's busy timeout
is zero, so it fails with `SQLITE_BUSY` the instant anything else is writing.
`SQLITE_BUSY_TIMEOUT_MS` (15 s) is shared with LibSQLStore's `connectionTimeoutMs`. LibSQLStore
also switches the file to WAL, which persists in the file, so readers never wait on a writer. The
wait happens inside the synchronous driver and stalls that process's event loop, so it is a
ceiling for a slow SD card, not something to lean on.

**Available Cron Patterns** (`utils/workflows/cron-patterns.ts`):
- `EVERY_MINUTE`: `* * * * *`
- `EVERY_3_HOURS`: `0 */3 * * *`
- `DAILY_AT_MIDNIGHT`: `0 0 * * *`
- `WEEKLY_SUNDAY_8AM`: `0 8 * * 0`
- `WEEKLY_MONDAY_7AM`: `0 7 * * 1`

Mastra validates the expression when the row is created, so a new cadence can be added verbatim
in standard 5-field form; croner nicknames (`@hourly`, `@daily`) work too.

**Currently Scheduled Workflows** (see `mastra/schedule-reconciler.ts`):
1. **Weather Monitoring** - Runs every 3 hours
   - Workflow: `weatherMonitoringWorkflow`
   - Purpose: Updates weather information and notifies other agents of changes

2. **Weekly Meal Planning** - Runs every Sunday at 8:00 AM
   - Workflow: `weeklyMealPlanningWorkflow`
   - Purpose: Generates weekly meal plan with Danish recipes

3. **Email Checking** - Runs every minute + on startup
   - Workflow: `emailCheckingWorkflow`
   - Purpose: Tracks which emails have arrived; does not trigger the state reactor

4. **Form Replies Detection** - Runs every 3 hours + on startup
   - Workflow: `formRepliesDetectionWorkflow`
   - Purpose: Resumes the suspended runs that inbound form replies answer, and registers the
     emails as a state change

5. **IoT Noise Baselines** - Runs every 3 hours + on startup
   - Workflow: `iotNoiseBaselineWorkflow`
   - Purpose: Recalculates how much each entity normally fluctuates, from 15 minutes of history,
     so the Home Assistant event monitor can drop changes that are only noise. The changes
     themselves are not polled: see [Home Assistant Event Monitor](mcp-integration-capabilities.md#home-assistant-event-monitor)

6. **Storage Retention** - Runs nightly at midnight
   - Workflow: `storageRetentionWorkflow`
   - Purpose: Trims token usage rows (90 days), Mastra's spans and workflow snapshots, and
     observability logs (14 days) past their retention window

7. **Weekly News Digest** - Runs every Monday at 7:00 AM
   - Workflow: `weeklyNewsDigestWorkflow`
   - Purpose: Summarizes the past week's news and daily.dev's most upvoted posts on one visualized
     page, and pushes its link to the phone (see [Web Research](mcp-visualize-vertical-shortcuts.md#visualize-vertical-shortcuts))

**Monitoring Scheduled Workflows:**

View logs in the terminal when workflows execute:
```
⚙️  Executing scheduled workflow: Hourly Weather Check
   Time: 2024-01-15T10:00:00.000Z
✅ Workflow completed successfully (1234ms)
   Status: success
```
