/**
 * Which persisted runs the boot restart is allowed to see.
 *
 * The failure this prevents is a crash at startup, so the test is about which runs get
 * retired and which are left alone -- a run wrongly retired is work silently abandoned, and
 * one wrongly kept is the crash coming back.
 */

import { describe, expect, it, mock } from 'bun:test';
import { retireUnrestartableRuns } from './workflow-run-recovery.js';

const GRAPH = [{ type: 'step', step: { id: 'check-email' } }];
const CHANGED_GRAPH = [
  { type: 'step', step: { id: 'check-email' } },
  { type: 'step', step: { id: 'summarize' } },
];

/** Just enough Mastra to run the sweep: some workflows, some active runs, a store. */
function mastraWith(options: {
  workflows: Record<string, unknown>;
  runs: { workflowName: string; runId: string; snapshot: unknown }[];
}) {
  const updateWorkflowState = mock(async () => undefined);

  const mastra = {
    listWorkflows: () => options.workflows,
    listActiveWorkflowRuns: async () => ({ runs: options.runs, total: options.runs.length }),
    getStorage: () => ({ getStore: async () => ({ updateWorkflowState }) }),
  };

  return { mastra, updateWorkflowState };
}

/** The run ids the sweep retired. */
function retired(updateWorkflowState: ReturnType<typeof mock>): string[] {
  return updateWorkflowState.mock.calls.map((call) => (call[0] as { runId: string }).runId);
}

describe('retiring runs the boot restart cannot resume', () => {
  it('leaves a run whose workflow has not changed', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [{ workflowName: 'emailCheckingWorkflow', runId: 'run-1', snapshot: { serializedStepGraph: GRAPH } }],
    });

    await retireUnrestartableRuns(mastra as never);

    expect(retired(updateWorkflowState)).toEqual([]);
  });

  it('retires a run written against a different shape of the same workflow', async () => {
    // The actual failure: a saved position that no longer refers to a step that exists.
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [
        { workflowName: 'emailCheckingWorkflow', runId: 'run-2', snapshot: { serializedStepGraph: CHANGED_GRAPH } },
      ],
    });

    await retireUnrestartableRuns(mastra as never);

    expect(retired(updateWorkflowState)).toEqual(['run-2']);
  });

  it('retires a run whose workflow is gone, since there is nothing to resume it into', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: {},
      runs: [{ workflowName: 'deletedWorkflow', runId: 'run-3', snapshot: { serializedStepGraph: GRAPH } }],
    });

    await retireUnrestartableRuns(mastra as never);

    expect(retired(updateWorkflowState)).toEqual(['run-3']);
  });

  it('reads a snapshot that storage handed back as JSON', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [
        {
          workflowName: 'emailCheckingWorkflow',
          runId: 'run-4',
          snapshot: JSON.stringify({ serializedStepGraph: GRAPH }),
        },
      ],
    });

    await retireUnrestartableRuns(mastra as never);

    expect(retired(updateWorkflowState)).toEqual([]);
  });

  it('leaves a snapshot it cannot read, rather than retiring work on a guess', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [{ workflowName: 'emailCheckingWorkflow', runId: 'run-5', snapshot: 'not json' }],
    });

    await retireUnrestartableRuns(mastra as never);

    expect(retired(updateWorkflowState)).toEqual([]);
  });

  it('records why, so a failed run is not mistaken for the workflow having failed', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [
        { workflowName: 'emailCheckingWorkflow', runId: 'run-6', snapshot: { serializedStepGraph: CHANGED_GRAPH } },
      ],
    });

    await retireUnrestartableRuns(mastra as never);

    const [call] = updateWorkflowState.mock.calls as unknown as [
      { opts: { status: string; error: { name: string } } },
    ][];
    expect(call[0].opts.status).toBe('failed');
    expect(call[0].opts.error.name).toBe('StaleWorkflowRun');
  });
});
