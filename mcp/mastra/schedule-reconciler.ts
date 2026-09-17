import type { Mastra } from '@mastra/core';
import { logger } from './utils/logger.js';
import { CronPatterns } from './utils/workflows/cron-patterns.js';
import {
  emailCheckingWorkflow,
  formRepliesDetectionWorkflow,
  iotMonitoringWorkflow,
  storageRetentionWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
} from './verticals/index.js';

/**
 * Which workflows run on a schedule, and how the stored rows are kept in step with that.
 *
 * The declarations below are the source of truth; the rows in storage are derived from
 * them on every boot. Add a workflow here to schedule it, remove it here to unschedule it.
 *
 * Schedules are persisted by Mastra rather than held in memory by a `node-cron` process,
 * which changes three things worth knowing:
 *
 * - A row survives a restart or redeploy, so a schedule can be paused, resumed, retimed
 *   or fired once through `mastra.schedules` (and over `/api/schedules`) at runtime with
 *   no deploy. Anything done that way is reverted on the next boot, because
 *   {@link reconcileSchedules} re-asserts what this file declares.
 * - Removing a declaration is no longer enough to stop a schedule on its own — the row
 *   outlives the code that created it — so the reconcile deletes rows it owns and no
 *   longer declares.
 * - The rows this file owns are tagged with {@link MANAGED_BY}. The sweep only ever
 *   touches tagged rows, so a schedule created by hand or by another feature is left
 *   alone instead of being deleted on the next deploy.
 *
 * This module deliberately does not import the application's Mastra instance. That import
 * boots the whole server, and the reconcile has to be testable on its own.
 */

/** The timezone every cadence here is written in. */
export const TIMEZONE = 'Europe/Copenhagen';

/**
 * Marks the rows this file owns.
 *
 * Without it the orphan sweep would have to assume every workflow schedule in storage
 * came from here, and would delete anything created at runtime on the next boot.
 */
export const MANAGED_BY = 'hey-jarvis-scheduler';

/** A workflow schedule as this file declares it, before it becomes a stored row. */
export interface ScheduledWorkflowDeclaration {
  workflowId: string;
  cron: string;
  /**
   * Also fire once at boot, on top of the cron cadence.
   *
   * For the workflows whose job is to catch up on whatever happened while the process was
   * down, where waiting for the next tick would leave a gap in coverage.
   */
  runOnStartup?: boolean;
}

export const SCHEDULED_WORKFLOWS: ScheduledWorkflowDeclaration[] = [
  // Weather monitoring - every 3 hours
  {
    workflowId: weatherMonitoringWorkflow.id,
    cron: CronPatterns.EVERY_3_HOURS,
  },
  // Weekly meal planning - every Sunday at 8am
  {
    workflowId: weeklyMealPlanningWorkflow.id,
    cron: CronPatterns.WEEKLY_SUNDAY_8AM,
  },
  // Email checking - every minute
  // Checks for new emails and updates tracking (does NOT trigger state reactor)
  {
    workflowId: emailCheckingWorkflow.id,
    cron: CronPatterns.EVERY_MINUTE,
    runOnStartup: true,
  },
  // Form replies detection - every 3 hours
  // Processes form reply emails and triggers state reactor for notifications
  {
    workflowId: formRepliesDetectionWorkflow.id,
    cron: CronPatterns.EVERY_3_HOURS,
    runOnStartup: true,
  },
  // IoT device monitoring - every 3 hours
  // Polls Home Assistant for state changes, filters out devices/entities with 'sensitive' label.
  {
    workflowId: iotMonitoringWorkflow.id,
    cron: CronPatterns.EVERY_3_HOURS,
    runOnStartup: true,
  },
  // Storage retention - nightly
  // Trims token usage rows past their retention window. Nothing called the cleanup this
  // runs, so the table grew for the life of the database; midnight is chosen because the
  // delete is the only write that touches every row and the device is otherwise idle.
  {
    workflowId: storageRetentionWorkflow.id,
    cron: CronPatterns.DAILY_AT_MIDNIGHT,
  },
];

/** The schedules service as exposed on a Mastra instance. */
type SchedulesService = Mastra['schedules'];

/** One stored row, narrowed to the workflow variant of the union. */
type StoredSchedule = Awaited<ReturnType<SchedulesService['list']>>[number];
type StoredWorkflowSchedule = Extract<StoredSchedule, { workflowId: string }>;

function isManagedWorkflowSchedule(schedule: StoredSchedule): schedule is StoredWorkflowSchedule {
  return schedule.workflowId !== undefined && schedule.metadata?.managedBy === MANAGED_BY;
}

/** Whether a stored row still says what its declaration says. */
function matchesDeclaration(row: StoredWorkflowSchedule, declaration: ScheduledWorkflowDeclaration): boolean {
  return row.cron === declaration.cron && row.timezone === TIMEZONE && row.status === 'active';
}

/**
 * Brings the stored schedule rows in line with {@link SCHEDULED_WORKFLOWS}.
 *
 * Rows are matched to declarations by workflow id rather than by row id, so the id scheme
 * Mastra normalizes to is never something this file has to predict.
 *
 * @returns The stored row id for each declared workflow, so the caller can fire the
 * startup ones without looking them up again.
 */
export async function reconcileSchedules(
  schedules: SchedulesService,
  declarations: ScheduledWorkflowDeclaration[] = SCHEDULED_WORKFLOWS,
): Promise<Map<string, string>> {
  const managedRows = (await schedules.list()).filter(isManagedWorkflowSchedule);
  const declaredWorkflowIds = new Set(declarations.map((declaration) => declaration.workflowId));

  for (const row of managedRows) {
    if (!declaredWorkflowIds.has(row.workflowId)) {
      await schedules.delete(row.id);
      logger.info('Deleted schedule for a workflow that is no longer declared', {
        workflowId: row.workflowId,
        scheduleId: row.id,
      });
    }
  }

  const scheduleIdsByWorkflowId = new Map<string, string>();

  for (const declaration of declarations) {
    const rows = managedRows.filter((row) => row.workflowId === declaration.workflowId);

    // More than one row for the same workflow can only come from a reconcile that was
    // interrupted partway through. Keep the first and drop the rest, so the duplicates
    // cannot quietly double every fire from here on.
    for (const duplicate of rows.slice(1)) {
      await schedules.delete(duplicate.id);
      logger.warn('Deleted a duplicate schedule row', {
        workflowId: declaration.workflowId,
        scheduleId: duplicate.id,
      });
    }

    const existingRow = rows[0];

    if (!existingRow) {
      const created = await schedules.create({
        workflowId: declaration.workflowId,
        cron: declaration.cron,
        timezone: TIMEZONE,
        inputData: {},
        metadata: { managedBy: MANAGED_BY },
      });
      scheduleIdsByWorkflowId.set(declaration.workflowId, created.id);
      logger.info('Created schedule', {
        workflowId: declaration.workflowId,
        scheduleId: created.id,
        cron: declaration.cron,
      });
      continue;
    }

    scheduleIdsByWorkflowId.set(declaration.workflowId, existingRow.id);

    if (!matchesDeclaration(existingRow, declaration)) {
      // `status: 'active'` is restated rather than left as it is, on purpose: a schedule
      // paused at runtime is meant to come back on the next deploy, because this file is
      // what says whether it should be running at all.
      await schedules.update(existingRow.id, {
        cron: declaration.cron,
        timezone: TIMEZONE,
        status: 'active',
      });
      logger.info('Updated schedule to match its declaration', {
        workflowId: declaration.workflowId,
        scheduleId: existingRow.id,
        cron: declaration.cron,
      });
    }
  }

  return scheduleIdsByWorkflowId;
}
