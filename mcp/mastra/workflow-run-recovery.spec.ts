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

  it('only retires a run that is still active when the update lands', async () => {
    // A run that finishes between the listing and the update keeps the result it finished with.
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [
        { workflowName: 'emailCheckingWorkflow', runId: 'run-7', snapshot: { serializedStepGraph: CHANGED_GRAPH } },
      ],
    });

    await retireUnrestartableRuns(mastra as never);

    const [call] = updateWorkflowState.mock.calls as unknown as [{ opts: { expectedStatus: string[] } }][];
    expect(call[0].opts.expectedStatus).toEqual(['running', 'waiting']);
  });
});

describe('runs that never recorded a position', () => {
  // What a scheduled run looks like for its whole life: the event-driven engine persists it as
  // running with no position and only writes one when it ends. Restarting it starts the engine
  // at index `undefined`, which runs no step and then crashes on `lastOutput.result`.
  const positionless = {
    workflowName: 'emailCheckingWorkflow',
    runId: 'sched_schedule_1_1',
    snapshot: { serializedStepGraph: GRAPH, status: 'running', activePaths: [] },
  };

  it('are retired by the process that executes them', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [positionless],
    });

    await retireUnrestartableRuns(mastra as never, { retirePositionlessRuns: true });

    expect(retired(updateWorkflowState)).toEqual(['sched_schedule_1_1']);
  });

  it('are left alone by any other process, which cannot tell them from runs in flight', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [positionless],
    });

    await retireUnrestartableRuns(mastra as never);

    expect(retired(updateWorkflowState)).toEqual([]);
  });

  it('do not include a run that has reached a step, which the restart can resume', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [{ ...positionless, runId: 'run-8', snapshot: { ...positionless.snapshot, activePaths: [0] } }],
    });

    await retireUnrestartableRuns(mastra as never, { retirePositionlessRuns: true });

    expect(retired(updateWorkflowState)).toEqual([]);
  });

  it('say so on the run, rather than blaming a changed workflow', async () => {
    const { mastra, updateWorkflowState } = mastraWith({
      workflows: { emailCheckingWorkflow: { serializedStepGraph: GRAPH } },
      runs: [positionless],
    });

    await retireUnrestartableRuns(mastra as never, { retirePositionlessRuns: true });

    const [call] = updateWorkflowState.mock.calls as unknown as [{ opts: { error: { message: string } } }][];
    expect(call[0].opts.error.message).toContain('before it recorded which step it had reached');
  });
});
