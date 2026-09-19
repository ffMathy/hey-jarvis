/**
 * The poll loop, which is the part of routing this vertical still owns.
 *
 * Ordering, parallelism and dependency passing are written into the plan, and running it is
 * Mastra's job. What is left here is the contract with Jarvis: what a poll returns, when it
 * blocks, that a result is relayed exactly once, and that the closing report recaps
 * everything in case a response was lost on the way.
 *
 * Nothing here calls a model or registers a workflow. Delegations are driven by feeding the
 * same events a real plan run folds into — one announced when the plan is built, one closed
 * when its step finishes — so the folding itself is covered rather than stubbed around.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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

function progressFor(sessionId: string): RoutingProgress {
  let progress = progressBySessionId.get(sessionId);
  if (!progress) {
    progress = new RoutingProgress();
    progressBySessionId.set(sessionId, progress);
  }
  return progress;
}

let nextDelegationId = 0;

/**
 * Announces a delegation, the way building a plan announces every one it contains.
 *
 * The id is the plan's agent step id, which is what a step result carries back.
 */
function startDelegation(sessionId: string, agentId: string): string {
  nextDelegationId += 1;
  const delegationId = `plan-chain-0-${nextDelegationId}-${agentId}`;
  progressFor(sessionId).handle({ type: 'delegation_start', delegationId, taskId: agentId, agentId });
  return delegationId;
}

/** Answers a delegation that was announced. */
function finishDelegation(sessionId: string, delegationId: string, result: unknown, isError = false): void {
  progressFor(sessionId).handle({ type: 'delegation_end', delegationId, result, isError });
}

/** One delegation, announced and answered — the common case. */
function delegate(sessionId: string, agentId: string, text: string): void {
  finishDelegation(sessionId, startDelegation(sessionId, agentId), { text });
}

const fakeRuntime: RoutingRuntime = {
  async start(sessionId) {
    // A fresh buffer, the way the real runtime starts one: a superseded run keeps folding
    // into the buffer it was handed, so a new request must not be handed the same object.
    progressBySessionId.set(sessionId, new RoutingProgress());
  },
  async poll(sessionId) {
    return buildSnapshot(progressFor(sessionId));
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

/** The plan run ending, which ends the request: every delegation is a step inside it. */
function endPlanRun(progress: RoutingProgress): void {
  progress.handle({ type: 'finished' });
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
  // A poll with nothing to report blocks until its deadline by design. That is five seconds
  // in production, which every such case here would otherwise sit through.
  setPollDeadlineForTest(50);
});

afterEach(() => {
  resetRoutingRuntime();
  resetPollDeadlineForTest();
});

describe('routePromptWorkflow', () => {
  it('sends Jarvis straight to the poll rather than asking him to speak first', async () => {
    const outcome = resultOf(
      await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false }),
    );

    expect(outcome.instructions).toContain('getNextInstructionsWorkflow');

    // The "I'm on it" line is ElevenLabs' now: `routePromptWorkflow` has pre-tool speech set to
    // Force in its tool settings, so the agent speaks *before* the call rather than after it
    // returns. Asking for it here as well is how he came to say it twice, and the second one
    // would now land after the silence it was meant to cover. See the note on `INSTRUCTIONS`.
    expect(outcome.instructions).not.toContain('in your own voice');
    expect(outcome.instructions).not.toContain('under six words');
  });

  it('carries the loop and its failure handling, so the prompt does not have to', async () => {
    const outcome = resultOf(
      await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false }),
    );

    // A failed poll is a lost answer, not a delayed one, so the instruction to retry has to
    // travel with the loop rather than living in the agent prompt.
    expect(outcome.instructions).toContain('call it again straight away');
    expect(outcome.instructions).toContain('never the end of the request');

    // And the one request the loop must not claim: asked to hang up while the plan still had
    // the floor, Jarvis routed it, was told no agent could handle it, and said he was unable
    // to end the call — on a line that stayed open. Only his own end_call can hang up.
    expect(outcome.instructions).toContain('end_call');
    expect(outcome.instructions).toContain('never routed');
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
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(outcome.instructions).toContain('not finished yet');
  });

  it('hands a result over exactly once while the request is still running', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    startDelegation(DEFAULT_ROUTING_SESSION_ID, 'calendar');

    const first = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));
    const second = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(first.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    // Nothing new settled, and the weather result has already been relayed.
    expect(second.completedTaskResults).toBeUndefined();
    expect(second.instructions).toContain('Still processing');
  });

  it('names what is still running, so the caller knows the request is not stalled', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    startDelegation(DEFAULT_ROUTING_SESSION_ID, 'calendar');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.taskIdsInProgress).toEqual(['calendar']);
  });

  it('closes the request when the turn ends, reporting a delegation that never answered', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    startDelegation(DEFAULT_ROUTING_SESSION_ID, 'calendar');

    // Every delegation is a step of the plan run, so one still outstanding when that run
    // ends has no later event coming. Waiting for it is what left a live request polling
    // "Still processing" until the caller gave up.
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('All tasks have completed');
    // The closing instruction sends anything further back through routing, so it carries the
    // hang-up exception too — a request to end the call arriving here must reach end_call.
    expect(closing.instructions).toContain('end_call');
    expect(closing.taskIdsInProgress).toEqual([]);
    // The unanswered one is reported rather than dropped: the caller should hear that the
    // calendar was asked and did not answer, not simply never hear of it.
    const calendar = closing.completedTaskResults?.find((entry) => entry.id === 'calendar');
    expect(calendar?.result).toContain('did not report a result');
  });

  it('does not pass off an empty answer as a result', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is on my calendar', async: false });
    // What a subagent that stopped on a tool-calls step returns. Relayed as-is it reads to
    // the caller as a delegation that worked and had nothing to say.
    finishDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'calendar'), {
      text: '',
    });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'calendar', result: 'finished without answering' }]);
  });

  it('still hands over the results that landed before a failure', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');

    progress.fail('the plan could not be registered');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).toContain('could not be completed');
    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });

  it('recaps every result once the request is done, including ones already relayed', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');

    const first = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));
    expect(first.completedTaskResults).toHaveLength(1);

    delegate(DEFAULT_ROUTING_SESSION_ID, 'calendar', 'Dentist at four.');
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('All tasks have completed');
    // A response lost on the way must not take a result with it, so the last word carries
    // everything the request produced rather than only what is new.
    const ids = closing.completedTaskResults?.map((entry) => entry.id);
    expect(ids).toContain('weather');
    expect(ids).toContain('calendar');
    expect(closing.taskIdsInProgress).toEqual([]);
  });

  it('reports a request that failed outright rather than going quiet', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    progressFor(DEFAULT_ROUTING_SESSION_ID).fail('the plan could not be registered');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).toContain('could not be completed');
    expect(outcome.instructions).toContain('the plan could not be registered');
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

    delegate('caller-a', 'weather', 'It is 8 degrees.');
    delegate('caller-b', 'calendar', 'Dentist at four.');

    const forA = resultOf(await runWorkflow(getNextInstructionsWorkflow, { sessionId: 'caller-a' }));

    expect(forA.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });
});

describe('a result that arrives twice', () => {
  /**
   * A chain reports a result of its own — its last step's answer — alongside that step's.
   * Relaying both would have Jarvis say the same thing twice, so the first event to close a
   * delegation reports it and the rest are dropped.
   */
  it('relays it once', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'weather');
    finishDelegation(DEFAULT_ROUTING_SESSION_ID, delegationId, { text: 'It is 8 degrees.' });
    finishDelegation(DEFAULT_ROUTING_SESSION_ID, delegationId, { text: 'It is 8 degrees.' });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });
});

describe('scoping a request\u2019s delegations', () => {
  it('claims a delegation the session announced', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
  });

  it('stops claiming the previous request\u2019s delegations once a new one starts', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');

    // A second request supersedes the first, so the first request's answers are no longer
    // this request's to report.
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is on my calendar', async: false });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toBeUndefined();
  });
});

describe('failed delegations', () => {
  it('reports why a delegation failed, not just that it did', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    finishDelegation(
      DEFAULT_ROUTING_SESSION_ID,
      startDelegation(DEFAULT_ROUTING_SESSION_ID, 'weather'),
      { text: 'OpenWeather rejected the API key' },
      true,
    );

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    // A failed delegation still reports what went wrong rather than only that it did.
    expect(outcome.completedTaskResults?.[0].result).toContain('OpenWeather rejected the API key');
  });

  it('reads a result that is not the usual shape', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    finishDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'weather'), 'plain text');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    // A result that is not the usual `{ text }` still has to read as something.
    expect(outcome.completedTaskResults?.[0].result).toBe('plain text');
  });

  it('carries on reporting the rest of the request when one delegation fails', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather and calendar', async: false });
    finishDelegation(
      DEFAULT_ROUTING_SESSION_ID,
      startDelegation(DEFAULT_ROUTING_SESSION_ID, 'weather'),
      { text: 'no' },
      true,
    );
    delegate(DEFAULT_ROUTING_SESSION_ID, 'calendar', 'Dentist at four.');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    const ids = outcome.completedTaskResults?.map((entry) => entry.id);
    expect(ids).toEqual(['weather', 'calendar']);
  });
});
