import { mastra } from './index.js';
import { reconcileSchedules, SCHEDULED_WORKFLOWS, TIMEZONE } from './schedule-reconciler.js';
import { logger } from './utils/logger.js';

/**
 * Boot wiring for the scheduled workflows.
 *
 * What runs when lives in {@link ./schedule-reconciler.ts}; this file is only the part
 * that needs the application's Mastra instance.
 */
/**
 * Whether a declared workflow is actually registered on the instance that will run it.
 *
 * A schedule row names its target by id. When the scheduler cannot resolve that id it
 * deletes the row after a few ticks, so a workflow declared here but left out of
 * `mastra/index.ts` would simply stop being scheduled about thirty seconds after boot,
 * silently. The old scheduler refused to start in that situation and this keeps that.
 */
function isRegistered(workflowId: string): boolean {
  try {
    return Boolean(mastra.getWorkflowById(workflowId));
  } catch {
    return false;
  }
}

export async function initializeScheduler(): Promise<void> {
  const unregistered = SCHEDULED_WORKFLOWS.filter((declaration) => !isRegistered(declaration.workflowId));
  if (unregistered.length > 0) {
    throw new Error(
      `Scheduled workflows are not registered with Mastra: ${unregistered
        .map((declaration) => declaration.workflowId)
        .join(', ')}. Add them to the \`workflows\` map in mastra/index.ts.`,
    );
  }

  // Workers first: the scheduler worker only starts when there is storage for it to poll,
  // and the workflow event processor it publishes fires to has to be listening before the
  // first one arrives.
  await mastra.startWorkers();

  const scheduleIdsByWorkflowId = await reconcileSchedules(mastra.schedules);
  logger.info('Workflow schedules reconciled', {
    count: scheduleIdsByWorkflowId.size,
    timezone: TIMEZONE,
  });

  for (const declaration of SCHEDULED_WORKFLOWS) {
    if (!declaration.runOnStartup) {
      continue;
    }

    const scheduleId = scheduleIdsByWorkflowId.get(declaration.workflowId);
    if (!scheduleId) {
      continue;
    }

    // Fired off the schedule and not awaited: these exist to catch up on whatever happened
    // while the process was down, and the server should not wait on that before it starts
    // serving. A failure is logged rather than propagated, for the same reason the old
    // scheduler swallowed one — there is no caller that can act on it.
    void mastra.schedules
      .run(scheduleId)
      .catch((error) => logger.error('Startup run failed', { workflowId: declaration.workflowId, error }));
  }
}
