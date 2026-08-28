/**
 * The poll loop, which is the part of routing this vertical still owns.
 *
 * Ordering, parallelism and dependency passing moved into the supervisor's own delegation
 * loop when the task DAG went away, so what is left here is the contract with Jarvis: what
 * a poll returns, when it blocks, that a result is relayed exactly once, and that the
 * closing report recaps everything in case a response was lost on the way.
 *
 * The runtime is substituted, so nothing here calls a model. Progress is driven by feeding
 * the same `AgentControllerEvent` values a real session would emit, so the event folding is
 * covered too rather than being stubbed around.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { MastraDBMessage } from '@mastra/core/agent';
import type { AgentControllerEvent } from '@mastra/core/agent-controller';
import {
  DEFAULT_ROUTING_SESSION_ID,
  RoutingProgress,
  type RoutingRuntime,
  resetRoutingRuntime,
  setRoutingRuntime,
} from './controller.js';
import { getNextInstructionsWorkflow, routePromptWorkflow } from './workflows.js';

const progressBySessionId = new Map<string, RoutingProgress>();

function progressFor(sessionId: string): RoutingProgress {
  let progress = progressBySessionId.get(sessionId);
  if (!progress) {
    progress = new RoutingProgress();
    progressBySessionId.set(sessionId, progress);
  }
  return progress;
}

const fakeRuntime: RoutingRuntime = {
  async start(sessionId) {
    const progress = progressFor(sessionId);
    progress.reset();
    return progress;
  },
  async get(sessionId) {
    return progressFor(sessionId);
  },
};

async function runWorkflow<TInput, TResult>(
  workflow: { createRun(): Promise<{ start: (args: { inputData: TInput }) => Promise<TResult> }> },
  inputData: TInput,
): Promise<TResult> {
  const run = await workflow.createRun();
  return run.start({ inputData });
}

/** The events a session emits when one delegation runs to completion. */
function delegate(progress: RoutingProgress, agentId: string, result: string, isError = false): void {
  const toolCallId = `call-${agentId}-${Math.random().toString(36).slice(2)}`;
  progress.handle({ type: 'tool_start', toolCallId, toolName: agentId, args: {} });
  progress.handle({ type: 'tool_end', toolCallId, result: { text: result }, isError });
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

type WorkflowResult<T> = { status: string; result?: T };

function resultOf<T>(outcome: WorkflowResult<T>): T {
  if (outcome.status !== 'success' || !outcome.result) {
    throw new Error(`workflow did not succeed: ${outcome.status}`);
  }
  return outcome.result;
}

beforeEach(() => {
  progressBySessionId.clear();
  setRoutingRuntime(fakeRuntime);
});

afterEach(() => {
  resetRoutingRuntime();
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
    delegate(progressFor(DEFAULT_ROUTING_SESSION_ID), 'weather', 'It is 8 degrees and raining.');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees and raining.' }]);
    expect(outcome.instructions).toContain('Summarize');
  });

  it('reports a finished delegation without waiting for the slow one beside it', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);

    // The calendar lookup is still running. Measured on the old wave scheduler, a weather
    // answer ready at 100ms reached the user at 20s because its wave was a barrier.
    progress.handle({ type: 'tool_start', toolCallId: 'call-calendar', toolName: 'calendar', args: {} });
    delegate(progress, 'weather', 'It is 8 degrees.');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });

  it('never relays the same result twice while the request is still running', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(progress, 'weather', 'It is 8 degrees.');

    const first = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));
    delegate(progress, 'calendar', 'Two meetings today.');
    const second = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(first.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(second.completedTaskResults).toEqual([{ id: 'calendar', result: 'Two meetings today.' }]);
  });

  it('recaps every result at the close, so nothing is lost with a dropped response', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(progress, 'weather', 'It is 8 degrees.');

    // Jarvis is told about the weather, and that response is lost on the way.
    await runWorkflow(getNextInstructionsWorkflow, {});

    delegate(progress, 'calendar', 'Two meetings today.');
    progress.handle(assistantMessage('It is 8 degrees, and you have two meetings.'));
    progress.handle({ type: 'agent_end', reason: 'complete' });

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('All tasks have completed');
    // Including the weather, which an earlier poll already reported.
    expect(closing.completedTaskResults).toEqual([
      { id: 'summary', result: 'It is 8 degrees, and you have two meetings.' },
      { id: 'weather', result: 'It is 8 degrees.' },
      { id: 'calendar', result: 'Two meetings today.' },
    ]);
  });

  it('points a finished request back at routing for whatever the user asks next', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(progress, 'weather', 'It is 8 degrees.');
    progress.handle({ type: 'agent_end', reason: 'complete' });

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('routePromptWorkflow');
  });

  it('keeps going when a delegation fails, and says what could not be found out', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(progress, 'weather', 'the weather service is down', true);
    delegate(progress, 'calendar', 'Two meetings today.');
    progress.handle({ type: 'agent_end', reason: 'complete' });

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.completedTaskResults).toEqual([
      { id: 'weather', result: 'the weather service is down' },
      { id: 'calendar', result: 'Two meetings today.' },
    ]);
  });

  it('reports the failure when the run itself falls over', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    progressFor(DEFAULT_ROUTING_SESSION_ID).fail('the model refused the request');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('the model refused the request');
  });

  it('tells the caller to try again when there is nothing being routed', async () => {
    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).toContain('Still processing');
    expect(outcome.completedTaskResults).toBeUndefined();
  }, 10000);
});

describe('two callers at once', () => {
  it("do not receive each other's results", async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false, sessionId: 'caller-a' });
    await runWorkflow(routePromptWorkflow, {
      userQuery: 'what is on my calendar',
      async: false,
      sessionId: 'caller-b',
    });

    delegate(progressFor('caller-a'), 'weather', 'It is 8 degrees.');
    delegate(progressFor('caller-b'), 'calendar', 'Two meetings today.');

    const forA = resultOf(await runWorkflow(getNextInstructionsWorkflow, { sessionId: 'caller-a' }));
    const forB = resultOf(await runWorkflow(getNextInstructionsWorkflow, { sessionId: 'caller-b' }));

    expect(forA.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(forB.completedTaskResults).toEqual([{ id: 'calendar', result: 'Two meetings today.' }]);
  });

  it("do not end each other's requests", async () => {
    // The old implementation kept one in-flight request in a module-global, so starting a
    // second one left the first unreachable: its poll could only ever be answered from
    // whichever request happened to be last.
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false, sessionId: 'caller-a' });
    await runWorkflow(routePromptWorkflow, {
      userQuery: 'what is on my calendar',
      async: false,
      sessionId: 'caller-b',
    });

    progressFor('caller-b').handle({ type: 'agent_end', reason: 'complete' });
    delegate(progressFor('caller-a'), 'weather', 'It is 8 degrees.');

    const forA = resultOf(await runWorkflow(getNextInstructionsWorkflow, { sessionId: 'caller-a' }));

    expect(forA.instructions).not.toContain('All tasks have completed');
    expect(forA.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });
});
