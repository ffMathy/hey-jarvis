import type { Mastra } from '@mastra/core';
import type { WorkflowRunState } from '@mastra/core/workflows';
import { logger } from './utils/logger.js';

/**
 * Retiring persisted workflow runs that can no longer be restarted.
 *
 * Every boot, Mastra restarts the runs it finds active in storage. A run carries the step
 * graph it was written against, and resumes at the position it had reached in *that* graph.
 * When the workflow has changed since -- a step added, removed or reordered -- that position
 * means nothing in the graph it is being resumed into, and the restart walks off the end:
 *
 *   ERROR (Mastra): Failed to restart workflow run
 *       workflow: "emailCheckingWorkflow"
 *       runId: "sched_schedule_…"
 *       TypeError: undefined is not an object (evaluating 'lastOutput.result')
 *
 * The engine's loop is `for (let i = startIdx; i < steps.length; i++)`, and with a start
 * index past the end it never runs, leaving the `lastOutput` the code after it dereferences
 * undefined. So the crash is the visible half; the quiet half is that resuming step four of
 * a workflow that no longer has four steps was never going to be right even if it had run.
 *
 * This repo felt the quiet half for a while. The error read `error: {}` until the logger
 * learned to print causes, which is why it is only now legible -- and why it is worth
 * fixing at the source rather than waiting for the next shape change to produce it again.
 *
 * A retired run is marked failed rather than deleted. It stops being active, so nothing
 * tries to restart it, and the row stays for anyone asking what happened to it.
 */

/** Why a run was retired, recorded on the run itself. */
const RETIREMENT_REASON =
  'Retired at boot: the workflow changed since this run was persisted, so its saved position no longer refers to a step that exists.';

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
 * Marks every active run whose workflow has moved on as failed, so the boot restart skips it.
 *
 * Failure is logged rather than thrown. Leaving a stale run is the situation this exists to
 * improve, not one worth refusing to start the server over.
 */
export async function retireUnrestartableRuns(mastra: Mastra): Promise<void> {
  const workflows = await mastra.getStorage()?.getStore('workflows');
  if (!workflows) {
    return;
  }

  try {
    const { runs } = await mastra.listActiveWorkflowRuns();

    for (const run of runs) {
      const snapshot = snapshotOf(run.snapshot);
      if (!snapshot || matchesCurrentGraph(mastra, run.workflowName, snapshot)) {
        continue;
      }

      await workflows.updateWorkflowState({
        workflowName: run.workflowName,
        runId: run.runId,
        opts: { status: 'failed', error: { name: 'StaleWorkflowRun', message: RETIREMENT_REASON } },
      });

      logger.warn('Retired a workflow run the current workflow cannot resume', {
        workflow: run.workflowName,
        runId: run.runId,
      });
    }
  } catch (error) {
    logger.error('Could not retire unrestartable workflow runs', { error });
  }
}
