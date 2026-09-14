/**
 * The poll loop, which is the part of routing this vertical still owns.
 *
 * Ordering, parallelism and dependency passing are the supervisor's job inside its own
 * delegation loop; concurrency, persistence and retry are the background task manager's.
 * What is left here is the contract with Jarvis: what a poll returns, when it blocks, that
 * a result is relayed exactly once, and that the closing report recaps everything in case a
 * response was lost on the way.
 *
 * The task manager is faked, so nothing here calls a model — but the folding itself is the
 * real {@link buildSnapshot} over real {@link BackgroundTask} records, so what a poll is
 * allowed to say is covered rather than stubbed around.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { MastraDBMessage } from '@mastra/core/agent';
import type { AgentControllerEvent } from '@mastra/core/agent-controller';
import type { BackgroundTask } from '@mastra/core/background-tasks';
import {
  buildSnapshot,
  DEFAULT_ROUTING_SESSION_ID,
  RoutingProgress,
  type RoutingRuntime,
  resetRoutingRuntime,
  setRoutingRuntime,
} from './controller.js';
import {
  getNextInstructionsWorkflow,
  resetPollDeadlineForTest,
  routePromptWorkflow,
  setPollDeadlineForTest,
} from './workflows.js';

const progressBySessionId = new Map<string, RoutingProgress>();
const tasksBySessionId = new Map<string, BackgroundTask[]>();

function progressFor(sessionId: string): RoutingProgress {
  let progress = progressBySessionId.get(sessionId);
  if (!progress) {
    progress = new RoutingProgress();
    progressBySessionId.set(sessionId, progress);
  }
  return progress;
}

function tasksFor(sessionId: string): BackgroundTask[] {
  let tasks = tasksBySessionId.get(sessionId);
  if (!tasks) {
    tasks = [];
    tasksBySessionId.set(sessionId, tasks);
  }
  return tasks;
}

/**
 * One delegation, as the background task manager records it.
 *
 * The tool name is `agent-<id>`, which is how Mastra actually names a delegation tool and
 * therefore how it lands on the task row. Emitting the bare id here is what let that prefix
 * go unnoticed once already: the permission lookup and every reported agent name silently
 * took a tool name for an agent id.
 */
function task(agentId: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: `task-${agentId}-${Math.random().toString(36).slice(2)}`,
    status: 'completed',
    toolName: `agent-${agentId}`,
    toolCallId: `call-${agentId}`,
    args: {},
    agentId: 'routing-supervisor',
    runId: 'run-1',
    result: { text: 'done' },
    createdAt: new Date(),
    retryCount: 0,
    maxRetries: 0,
    timeoutMs: 300_000,
    ...overrides,
  };
}

/** Records one delegation against a session, as the manager would. */
function dispatch(sessionId: string, agentId: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  const record = task(agentId, overrides);
  tasksFor(sessionId).push(record);
  return record;
}

const fakeRuntime: RoutingRuntime = {
  async start(sessionId) {
    const progress = progressFor(sessionId);
    progress.reset();
    tasksBySessionId.set(sessionId, []);
  },
  async poll(sessionId) {
    return buildSnapshot(progressFor(sessionId), tasksFor(sessionId));
  },
  async waitForChange(_sessionId, deadlineMs) {
    // Nothing in these tests settles on its own — the spec arranges state up front — so a
    // wait here can only ever run out. Consuming the deadline rather than returning at once
    // is what keeps the poll loop from spinning through it in tight iterations.
    await new Promise((resolve) => setTimeout(resolve, deadlineMs));
  },
};

async function runWorkflow<TInput, TResult>(
  workflow: { createRun(): Promise<{ start: (args: { inputData: TInput }) => Promise<TResult> }> },
  inputData: TInput,
): Promise<TResult> {
  const run = await workflow.createRun();
  return run.start({ inputData });
}

function assistantMessage(text: string): AgentControllerEvent {
  return {
    type: 'message_end',
    message: {
      id: 'assistant-1',
      role: 'assistant',
      content: { format: 2, parts: [{ type: 'text', text }] },
      createdAt: new Date(),
    } as unknown as MastraDBMessage,
  };
}

/** The supervisor's own loop ending. Delegations may still be running behind it. */
function endSupervisorTurn(progress: RoutingProgress): void {
  progress.handle({ type: 'agent_end' });
}

type WorkflowResult<T> = { status: string; result?: T };

function resultOf<T>(outcome: WorkflowResult<T>): T {
  if (outcome.status !== 'success' || !outcome.result) {
    throw new Error(`workflow did not succeed: ${outcome.status}`);
  }
  return outcome.result;
}

beforeEach(() => {
  progressBySessionId.clear();
  tasksBySessionId.clear();
  setRoutingRuntime(fakeRuntime);
  // A poll with nothing to report blocks until its deadline by design. That is five seconds
  // in production, which every such case here would otherwise sit through.
  setPollDeadlineForTest(50);
});

afterEach(() => {
  resetRoutingRuntime();
  resetPollDeadlineForTest();
});

describe('routePromptWorkflow', () => {
  it('asks Jarvis to speak before polling, so the user is not left in silence', async () => {
    const outcome = resultOf(
      await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false }),
    );

    expect(outcome.instructions).toContain('in your own voice');
    expect(outcome.instructions).toContain('getNextInstructionsWorkflow');
  });

  it('carries the loop and its failure handling, so the prompt does not have to', async () => {
    const outcome = resultOf(
      await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false }),
    );

    // A failed poll is a lost answer, not a delayed one, so the instruction to retry has to
    // travel with the loop rather than living in the agent prompt.
    expect(outcome.instructions).toContain('call it again straight away');
    expect(outcome.instructions).toContain('never the end of the request');
  });

  it('tells Jarvis to end the call when the request is fire-and-forget', async () => {
    const outcome = resultOf(await runWorkflow(routePromptWorkflow, { userQuery: 'turn the lights off', async: true }));

    expect(outcome.instructions).toContain('End the call now');
  });

  it('hands back the session so a poll can name the request it is asking about', async () => {
    const outcome = resultOf(
      await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false, sessionId: 'caller-a' }),
    );

    expect(outcome.sessionId).toBe('caller-a');
  });

  it('defaults to one shared session when the caller does not identify itself', async () => {
    const outcome = resultOf(
      await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false }),
    );

    expect(outcome.sessionId).toBe(DEFAULT_ROUTING_SESSION_ID);
  });
});

describe('getNextInstructionsWorkflow', () => {
  it('reports a delegation that has finished', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { result: { text: 'It is 8 degrees.' } });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(outcome.instructions).toContain('not finished yet');
  });

  it('hands a result over exactly once while the request is still running', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { result: { text: 'It is 8 degrees.' } });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'calendar', { status: 'running', result: undefined });

    const first = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));
    const second = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(first.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    // Nothing new settled, and the weather result has already been relayed.
    expect(second.completedTaskResults).toBeUndefined();
    expect(second.instructions).toContain('Still processing');
  });

  it('names what is still running, so the caller knows the request is not stalled', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { result: { text: 'It is 8 degrees.' } });
    const pending = dispatch(DEFAULT_ROUTING_SESSION_ID, 'calendar', { status: 'running', result: undefined });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.taskIdsInProgress).toEqual([pending.id]);
  });

  it('does not close the request while a delegation is still running', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'calendar', { status: 'running', result: undefined });

    // The supervisor's turn ends as soon as it has dispatched, which is the whole point of
    // dispatching in the background. Treating that as the end of the request would close
    // the loop on work that has not happened yet.
    endSupervisorTurn(progress);

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).not.toContain('All tasks have completed');
  });

  it('recaps every result once the request is done, including ones already relayed', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { result: { text: 'It is 8 degrees.' } });

    const first = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));
    expect(first.completedTaskResults).toHaveLength(1);

    dispatch(DEFAULT_ROUTING_SESSION_ID, 'calendar', { result: { text: 'Dentist at four.' } });
    progress.handle(assistantMessage('Eight degrees, and the dentist at four.'));
    endSupervisorTurn(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('All tasks have completed');
    // A response lost on the way must not take a result with it, so the last word carries
    // everything the request produced rather than only what is new.
    const ids = closing.completedTaskResults?.map((entry) => entry.id);
    expect(ids).toContain('weather');
    expect(ids).toContain('calendar');
    expect(ids).toContain('summary');
    expect(closing.taskIdsInProgress).toEqual([]);
  });

  it('reports a request that failed outright rather than going quiet', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    progressFor(DEFAULT_ROUTING_SESSION_ID).fail('the supervisor could not be reached');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).toContain('could not be completed');
    expect(outcome.instructions).toContain('the supervisor could not be reached');
  });
});

describe('two callers at once', () => {
  it('keeps one caller’s delegations out of the other’s report', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false, sessionId: 'caller-a' });
    await runWorkflow(routePromptWorkflow, {
      userQuery: 'what is on my calendar',
      async: false,
      sessionId: 'caller-b',
    });

    dispatch('caller-a', 'weather', { result: { text: 'It is 8 degrees.' } });
    dispatch('caller-b', 'calendar', { result: { text: 'Dentist at four.' } });

    const forA = resultOf(await runWorkflow(getNextInstructionsWorkflow, { sessionId: 'caller-a' }));

    expect(forA.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });
});

describe('delegation tool names', () => {
  /**
   * Mastra registers a subagent's delegation tool as `agent-<id>`, not `<id>`, and records
   * it under that name. Everything that reads a tool name as an agent id has to take the
   * prefix off first, and the two places it matters are the reports and the permission
   * category.
   */
  it('names the agent, not the delegation tool, in a report', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { result: { text: 'It is 8 degrees.' } });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });
});

describe('failed delegations', () => {
  it('reports why a delegation failed, not just that it did', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', {
      status: 'failed',
      result: undefined,
      error: { message: 'OpenWeather rejected the API key' },
    });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    // The task row carries the underlying error, which is the thing the previous
    // implementation could not get at: the only copy it saw had already been wrapped for
    // the model, leaving "Failed agent tool execution for weather" and nothing more.
    expect(outcome.completedTaskResults?.[0].result).toContain('OpenWeather rejected the API key');
  });

  it('says something useful when a delegation times out without an error', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { status: 'timed_out', result: undefined });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults?.[0].result).toContain('timed out');
  });

  it('carries on reporting the rest of the request when one delegation fails', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'weather', { status: 'failed', result: undefined, error: { message: 'no' } });
    dispatch(DEFAULT_ROUTING_SESSION_ID, 'calendar', { result: { text: 'Dentist at four.' } });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    const ids = outcome.completedTaskResults?.map((entry) => entry.id);
    expect(ids).toEqual(['weather', 'calendar']);
  });
});
