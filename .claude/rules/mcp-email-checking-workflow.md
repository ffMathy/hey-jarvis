---
paths:
  - "mcp/**"
---

# Email Checking Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Tracks which emails have arrived, with **persistent tracking** of the last seen email. It does
not touch form replies or the state reactor — that is the form replies workflow below, which
keeps its own last-seen state under a separate storage key:
- **`emailCheckingWorkflow`**: Scheduled workflow that runs every minute + on startup
- **Step 1 - Search NEW Emails**: Uses `findNewEmailsSinceLastCheck` with persistent storage to fetch only emails received since the last workflow run
- **Step 2 - Store in State**: Stores new emails in workflow state and tracks the most recent email ID/timestamp
- **Step 3 - Update Last Seen**: Updates the `email_last_seen` database table with the most recent email
- **Step 4 - Format Output**: Returns summary with email count and update status

**Key Feature - Persistent Email Tracking:**
The workflow uses the `email_last_seen` database table to track which emails have been processed:
- **First run**: Returns recent emails (up to limit), stores the most recent as "last seen"
- **Subsequent runs**: Only returns emails received AFTER the last seen timestamp
- **Avoids reprocessing**: Each email is processed only once, even if it remains unread
- **Persists across restarts**: State is stored in LibSQL database (backed up in Home Assistant)

**Email State Functions:**
These are internal functions (not exposed as agent tools) for tracking email state:
```typescript
// Find only NEW emails since last check (storage key, mailbox folder, limit)
const result = await findNewEmailsSinceLastCheck('inbox', 'inbox', 50);

// Manually update last seen state
await updateLastSeenEmail('inbox', 'email-id-123', '2025-12-01T10:00:00Z');

// Get current last seen state
const state = await getLastSeenEmailState('inbox');

// Reset state (next run fetches recent emails again)
await clearLastSeenEmailState('inbox');
```

**Scheduled Execution:**
```typescript
scheduler.schedule({
  workflow: emailCheckingWorkflow,
  schedule: CronPatterns.EVERY_MINUTE,
  inputData: {},
  runOnStartup: true,
});
```
