import type { Mastra } from '@mastra/core';
import type { WorkflowRunState } from '@mastra/core/workflows';
import { logger } from './utils/logger.js';

/**
 * Retiring persisted workflow runs that can no longer be restarted.
 *
 * Every boot of `mastra dev`, Mastra restarts the runs it finds active in storage. A restart
 * resumes a run at the position it had reached, `activePaths[0]`, and the engine's loop is
 * `for (let i = startIdx; i < steps.length; i++)`. When that loop never runs, the code after
 * it dereferences a `lastOutput` that was never set:
 *
 *   ERROR (Mastra): Failed to restart workflow run
 *       workflow: "emailCheckingWorkflow"
 *       runId: "sched_schedule_…"
 *       TypeError: undefined is not an object (evaluating 'lastOutput.result')
 *
 * Two kinds of run end up there.
 *
 * - **Its workflow changed since it was persisted.** A step added, removed or reordered, and
 *   the saved position means nothing in the graph it is being resumed into -- past the end,
 *   or at the wrong step, which is worse than crashing because nothing reports it.
 * - **It never recorded a position at all.** A run the scheduler fires is persisted as
 *   `running` with `activePaths: []`, and keeps that until it finishes: the event-driven
 *   engine only writes a position when the run ends, fails or suspends. So every scheduled
 *   run the process died in the middle of -- a crash loop leaves one per fire -- is active
 *   forever with no position, the restart's start index is `undefined`, the loop is skipped,
 *   and the same error comes back on every boot, once per orphan.
 *
 * A retired run is marked failed rather than deleted. It stops being active, so nothing
 * tries to restart it, and the row stays for anyone asking what happened to it.
 */

/** Why a run was retired, recorded on the run itself. */
const STALE_GRAPH_REASON =
  'Retired at boot: the workflow changed since this run was persisted, so its saved position no longer refers to a step that exists.';
const NO_POSITION_REASON =
  'Retired at boot: the run was interrupted before it recorded which step it had reached, so there is no position to resume it from.';

/** A run's snapshot, which storage may hand back as JSON. */
function snapshotOf(snapshot: WorkflowRunState | string): WorkflowRunState | undefined {
  if (typeof snapshot !== 'string') {
    return snapshot;
  }

  try {
    return JSON.parse(snapshot) as WorkflowRunState;
  } catch {
    return undefined;
  }
}

/**
 * Whether a run would be resumed into the graph it was written against.
 *
 * Compared whole rather than by length. A graph with the same number of steps in a different
 * order resumes at a position that exists and is still the wrong step, which is worse than
 * crashing because nothing reports it.
 */
function matchesCurrentGraph(mastra: Mastra, workflowName: string, snapshot: WorkflowRunState): boolean {
  const workflow = mastra.listWorkflows()[workflowName];
  if (!workflow) {
    // Nothing to restart it into.
    return false;
  }

  return JSON.stringify(workflow.serializedStepGraph) === JSON.stringify(snapshot.serializedStepGraph);
}

/**
 * Whether a run was persisted without ever recording a position.
 *
 * Only an explicitly empty `activePaths` counts. A snapshot without the field is not one
 * Mastra wrote, and is left alone rather than retired on a guess.
 */
function hasNoPosition(snapshot: WorkflowRunState): boolean {
  return Array.isArray(snapshot.activePaths) && snapshot.activePaths.length === 0;
}

export interface RetireOptions {
  /**
   * Also retire active runs that never recorded a position.
   *
   * From the outside, such a run looks exactly like one that is executing right now in
   * another process, so this is only safe in the process that executes them, before its
   * own scheduler starts: whatever it finds then was left behind by its previous life.
   */
  retirePositionlessRuns?: boolean;
}

/** Why a run cannot be restarted, or undefined when it can. */
function retirementReason(
  mastra: Mastra,
  workflowName: string,
  snapshot: WorkflowRunState,
  options: RetireOptions,
): string | undefined {
  if (!matchesCurrentGraph(mastra, workflowName, snapshot)) {
    return STALE_GRAPH_REASON;
  }

  if (options.retirePositionlessRuns && hasNoPosition(snapshot)) {
    return NO_POSITION_REASON;
  }

  return undefined;
}

/**
 * Marks every active run the boot restart cannot resume as failed, so the restart skips it.
 *
 * The update only applies while the run is still active, so a run that finishes between
 * the listing and the update keeps the result it finished with.
 *
 * Failure is logged rather than thrown. Leaving a stale run is the situation this exists to
 * improve, not one worth refusing to start the server over.
 */
export async function retireUnrestartableRuns(mastra: Mastra, options: RetireOptions = {}): Promise<void> {
  const workflows = await mastra.getStorage()?.getStore('workflows');
  if (!workflows) {
    return;
  }

  try {
    const { runs } = await mastra.listActiveWorkflowRuns();

    for (const run of runs) {
      const snapshot = snapshotOf(run.snapshot);
      if (!snapshot) {
        continue;
      }

      const reason = retirementReason(mastra, run.workflowName, snapshot, options);
      if (!reason) {
        continue;
      }

      await workflows.updateWorkflowState({
        workflowName: run.workflowName,
        runId: run.runId,
        opts: {
          status: 'failed',
          error: { name: 'StaleWorkflowRun', message: reason },
          expectedStatus: ['running', 'waiting'],
        },
      });

      logger.warn('Retired a workflow run that cannot be resumed', {
        workflow: run.workflowName,
        runId: run.runId,
        reason,
      });
    }
  } catch (error) {
    logger.error('Could not retire unrestartable workflow runs', { error });
  }
}
