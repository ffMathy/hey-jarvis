/**
 * Reading a plan run's event stream.
 *
 * This is the join between Mastra's chunks and what a poll reports, and it is the one part
 * of routing whose failure mode is silence: a mapping that matches nothing produces a
 * request that runs correctly, answers nothing, and closes with every delegation marked
 * unanswered. That is exactly how the previous implementation failed, so it is pinned here
 * rather than left to an integration run to discover.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { markAsSlow } from '../../utils/slow-tasks.js';
import {
  asRoutingEvents,
  buildSnapshot,
  getRoutingRuntime,
  RoutingProgress,
  resetRoutingRuntime,
} from './controller.js';
import { buildRoutingPlan } from './plan.js';
import { forgetOpenQuestions } from './questions.js';

const PLAN = buildRoutingPlan('plan-under-test', [
  { delegations: [{ taskId: 'diary', agentId: 'calendar', prompt: 'What is on my calendar?' }] },
  {
    delegations: [
      { taskId: 'location', agentId: 'internetOfThings', prompt: 'Where is the user?' },
      { taskId: 'forecast', agentId: 'weather', prompt: 'What is the weather there?' },
    ],
  },
]);

const CALENDAR_STEP = 'plan-under-test-chain-0-0-calendar';
const LOCATION_STEP = 'plan-under-test-chain-1-0-internetOfThings';
const WEATHER_STEP = 'plan-under-test-chain-1-1-weather';

/** A step result, the way a run emits one. */
function stepResult(id: string, output: unknown, status = 'success') {
  return { type: 'workflow-step-result', payload: { id, status, output } };
}

/** The resume schema Mastra reports for a step that resumes with `{ userAnswer }`. */
const USER_ANSWER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { userAnswer: { type: 'string' } },
  required: ['userAnswer'],
});

/**
 * An agent step's tool call suspending, the way it reaches a plan run: the agent's own
 * `tool-call-suspended` chunk, forwarded by its step as streamed output.
 */
function suspendedOutput(
  stepName: string,
  suspendPayload: unknown = { question: 'Email, or a push notification?' },
  resumeSchema = USER_ANSWER_SCHEMA,
) {
  return {
    type: 'workflow-step-output',
    payload: {
      stepName,
      output: {
        type: 'tool-call-suspended',
        runId: 'agent-run-1',
        from: 'AGENT',
        payload: { toolCallId: 'call-1', toolName: 'workflow-implementFeatureWorkflow', suspendPayload, resumeSchema },
      },
    },
  };
}

/** A plan run that has announced everything it intends to do, and done none of it yet. */
function startedPlan(): RoutingProgress {
  const progress = new RoutingProgress();
  for (const [delegationId, agentId] of PLAN.agentByStepId) {
    const taskId = PLAN.taskIdByStepId.get(delegationId) ?? agentId;
    progress.handle({ type: 'delegation_start', delegationId, taskId, agentId });
  }
  return progress;
}

describe('reading a chunk off a plan run', () => {
  it('closes the delegation an agent step is', () => {
    expect(asRoutingEvents(stepResult(CALENDAR_STEP, { text: 'Dentist at four.' }), PLAN)).toEqual([
      {
        type: 'delegation_end',
        delegationId: CALENDAR_STEP,
        result: { text: 'Dentist at four.' },
        isError: false,
      },
    ]);
  });

  it('marks a step that did not succeed as a failed delegation', () => {
    const events = asRoutingEvents(stepResult(CALENDAR_STEP, { error: 'no' }, 'failed'), PLAN);

    expect(events).toMatchObject([{ type: 'delegation_end', isError: true }]);
  });

  it('attributes a chain’s own result to the delegation that produced it', () => {
    // A chain's output is its last agent step's text, and it arrives whether or not the
    // chain's inner steps reach the parent stream.
    expect(asRoutingEvents(stepResult('chain-1', { text: 'It is 8 degrees.' }), PLAN)).toMatchObject([
      { delegationId: LOCATION_STEP },
      { type: 'delegation_end', delegationId: WEATHER_STEP, result: { text: 'It is 8 degrees.' } },
    ]);
  });

  /**
   * The regression that made a chain of two report as half a failure: only the chain's own
   * result reaches this stream, so the steps before the last were left outstanding and the
   * end of the run called them unanswered -- while the answer they produced was already in
   * the result the chain reported.
   */
  it('closes the earlier steps of a chain that succeeded', () => {
    const events = asRoutingEvents(stepResult('chain-1', { text: 'It is 8 degrees.' }), PLAN);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ delegationId: LOCATION_STEP, isError: false });
  });

  it('leaves the earlier steps of a failed chain alone, since it cannot say which one failed', () => {
    const events = asRoutingEvents(stepResult('chain-1', { error: 'no' }, 'failed'), PLAN);

    expect(events).toMatchObject([{ delegationId: WEATHER_STEP, isError: true }]);
  });

  it('ignores the plumbing steps, which are not delegations', () => {
    expect(asRoutingEvents(stepResult(`${CALENDAR_STEP}-prompt`, { prompt: 'hi' }), PLAN)).toEqual([]);
  });

  it('ignores anything that is not a step result', () => {
    // `workflow-finish` in particular: a chain is a nested workflow sharing the root's
    // pubsub, so taking its finish for the request's would close the request the moment the
    // fastest chain was done.
    expect(asRoutingEvents({ type: 'workflow-finish', payload: { workflowStatus: 'success' } }, PLAN)).toEqual([]);
    expect(asRoutingEvents({ type: 'workflow-start', payload: { workflowId: 'chain-0' } }, PLAN)).toEqual([]);
    expect(asRoutingEvents('not a chunk at all', PLAN)).toEqual([]);
  });
});

describe('a delegation that stops to ask the user something', () => {
  beforeEach(() => {
    forgetOpenQuestions();
  });

  it('is read off the step’s streamed output, since the step itself never reports a result', () => {
    expect(asRoutingEvents(suspendedOutput(CALENDAR_STEP), PLAN)).toEqual([
      {
        type: 'delegation_suspended',
        delegationId: CALENDAR_STEP,
        suspension: {
          agentRunId: 'agent-run-1',
          toolCallId: 'call-1',
          suspendPayload: { question: 'Email, or a push notification?' },
          resumeSchema: USER_ANSWER_SCHEMA,
        },
      },
    ]);
  });

  it('ignores everything else a step streams', () => {
    const textDelta = {
      type: 'workflow-step-output',
      payload: { stepName: CALENDAR_STEP, output: { type: 'text-delta', runId: 'agent-run-1', payload: {} } },
    };

    expect(asRoutingEvents(textDelta, PLAN)).toEqual([]);
  });

  it('closes the rest of its chain, which was waiting for an answer that will now come later', () => {
    const events = asRoutingEvents(suspendedOutput(LOCATION_STEP), PLAN);

    expect(events).toMatchObject([
      { type: 'delegation_suspended', delegationId: LOCATION_STEP },
      { type: 'delegation_end', delegationId: WEATHER_STEP, isError: true },
    ]);
  });

  it('becomes a question for the user rather than a result or something still running', () => {
    const progress = startedPlan();
    for (const event of asRoutingEvents(suspendedOutput(CALENDAR_STEP), PLAN)) {
      progress.handle(event);
    }

    const snapshot = buildSnapshot(progress);
    expect(snapshot.inProgress).not.toContain('diary');
    expect(snapshot.all).toEqual([]);
    expect(snapshot.questions).toMatchObject([
      {
        taskId: 'diary',
        agentId: 'calendar',
        question: 'Email, or a push notification?',
        answerField: 'userAnswer',
        agentRunId: 'agent-run-1',
        toolCallId: 'call-1',
      },
    ]);
  });

  it('is reported as a failure when there is nothing to ask', () => {
    const progress = startedPlan();
    for (const event of asRoutingEvents(suspendedOutput(CALENDAR_STEP, { context: 'no question here' }), PLAN)) {
      progress.handle(event);
    }

    const snapshot = buildSnapshot(progress);
    expect(snapshot.questions).toEqual([]);
    expect(snapshot.landed).toMatchObject([{ taskId: 'diary', failed: true }]);
  });

  it('is reported as a failure when the answer it wants is more than a spoken sentence', () => {
    const progress = startedPlan();
    const structuredAnswer = JSON.stringify({
      type: 'object',
      properties: { approved: { type: 'boolean' }, comments: { type: 'string' } },
    });
    for (const event of asRoutingEvents(
      suspendedOutput(CALENDAR_STEP, { question: 'Approve?' }, structuredAnswer),
      PLAN,
    )) {
      progress.handle(event);
    }

    const snapshot = buildSnapshot(progress);
    expect(snapshot.questions).toEqual([]);
    expect(snapshot.landed[0].result).toContain('cannot be given out loud');
  });
});

describe('a delegation that starts something slow', () => {
  function toolCallOutput(stepName: string, toolName: string) {
    return {
      type: 'workflow-step-output',
      payload: {
        stepName,
        output: { type: 'tool-call', runId: 'agent-run-1', from: 'AGENT', payload: { toolCallId: 'call-1', toolName } },
      },
    };
  }

  it('is read off the agent calling a tool marked slow', () => {
    markAsSlow({ id: 'readTheWholeCodebase' });

    expect(asRoutingEvents(toolCallOutput(CALENDAR_STEP, 'readTheWholeCodebase'), PLAN)).toEqual([
      { type: 'delegation_slow', delegationId: CALENDAR_STEP },
    ]);
  });

  it('is read off the agent starting a workflow marked slow', () => {
    markAsSlow({ id: 'buildTheWholeFeature' });

    expect(asRoutingEvents(toolCallOutput(CALENDAR_STEP, 'workflow-buildTheWholeFeature'), PLAN)).toEqual([
      { type: 'delegation_slow', delegationId: CALENDAR_STEP },
    ]);
  });

  it('ignores a tool that answers quickly', () => {
    expect(asRoutingEvents(toolCallOutput(CALENDAR_STEP, 'listCalendarEvents'), PLAN)).toEqual([]);
  });

  it('is announced once, and not at all once the user has asked to be notified', () => {
    const progress = startedPlan();
    progress.handle({ type: 'delegation_slow', delegationId: CALENDAR_STEP });
    progress.handle({ type: 'delegation_slow', delegationId: CALENDAR_STEP });
    expect(buildSnapshot(progress).newlySlow).toEqual(['diary']);

    progress.notifyWhenDone = true;
    progress.handle({ type: 'delegation_slow', delegationId: WEATHER_STEP });
    expect(buildSnapshot(progress).newlySlow).toEqual([]);
  });
});

describe('a plan run, folded', () => {
  it('names every delegation as outstanding before a single step has run', () => {
    const snapshot = buildSnapshot(startedPlan());

    expect(snapshot.inProgress).toEqual(['diary', 'location', 'forecast']);
    expect(snapshot.landed).toEqual([]);
    expect(snapshot.finished).toBe(false);
  });

  it('reports a delegation once, whichever event closes it first', () => {
    const progress = startedPlan();

    // The weather step's own result, then the chain's — the same answer, twice.
    for (const chunk of [
      stepResult(WEATHER_STEP, { text: 'It is 8 degrees.' }),
      stepResult('chain-1', { text: 'It is 8 degrees.' }),
    ]) {
      for (const event of asRoutingEvents(chunk, PLAN)) {
        progress.handle(event);
      }
    }

    expect(buildSnapshot(progress).landed).toContainEqual({
      taskId: 'forecast',
      agentId: 'weather',
      result: 'It is 8 degrees.',
      failed: false,
    });
  });

  it('closes out what the run never got to, rather than leaving the request unfinishable', () => {
    const progress = startedPlan();
    for (const event of asRoutingEvents(stepResult(CALENDAR_STEP, { text: 'Dentist at four.' }), PLAN)) {
      progress.handle(event);
    }

    progress.handle({ type: 'finished' });

    const snapshot = buildSnapshot(progress);
    expect(snapshot.finished).toBe(true);
    expect(snapshot.inProgress).toEqual([]);
    expect(snapshot.all.map((outcome) => `${outcome.taskId}:${outcome.failed}`)).toEqual([
      'diary:false',
      'location:true',
      'forecast:true',
    ]);
  });

  it('is idle until something is planned, so a poll on a fresh session says nothing', () => {
    expect(new RoutingProgress().isIdle()).toBe(true);
    expect(startedPlan().isIdle()).toBe(false);
  });

  it('reports the location step separately when a chain’s inner results do reach the stream', () => {
    const progress = startedPlan();
    for (const chunk of [
      stepResult(LOCATION_STEP, { text: 'Aarhus.' }),
      stepResult(WEATHER_STEP, { text: 'It is 8 degrees.' }),
    ]) {
      for (const event of asRoutingEvents(chunk, PLAN)) {
        progress.handle(event);
      }
    }

    expect(buildSnapshot(progress).landed.map((outcome) => outcome.agentId)).toEqual(['internetOfThings', 'weather']);
  });
});

/**
 * The real runtime, with no Mastra instance registered: a request started this way fails at
 * once ("routing has no Mastra instance to plan against"), which is exactly the shape of the
 * request that went unheard -- one that ended before the first poll arrived.
 */
describe('a poll that names a session no request was started in', () => {
  // Before as well as after: another spec in the same process may have left a Mastra instance
  // registered, and with one the request would really be planned instead of failing at once.
  beforeEach(() => {
    resetRoutingRuntime();
  });

  afterEach(() => {
    resetRoutingRuntime();
  });

  it('reads the latest request, so a failure the caller polls for under another id is still heard', async () => {
    const runtime = getRoutingRuntime();
    await runtime.start('the-id-the-route-call-made-up', 'I need help with something');

    const snapshot = await runtime.poll('a-different-id-the-poll-made-up');

    expect(snapshot.finished).toBe(true);
    expect(snapshot.error).toBe('routing has no Mastra instance to plan against');
  });

  it('reads the latest request when the route call named a session and the poll named none', async () => {
    const runtime = getRoutingRuntime();
    await runtime.start('mathias', 'What is on my calendar?');

    expect((await runtime.poll('jarvis-voice')).finished).toBe(true);
  });

  it('keeps a session that was started to itself, so callers that keep their ids stay isolated', async () => {
    const runtime = getRoutingRuntime();
    await runtime.start('first-caller', 'What is on my calendar?');
    await runtime.poll('first-caller');
    await runtime.start('second-caller', 'What is the weather?');

    // Taken by the first poll above, and not handed the second caller's request instead.
    expect((await runtime.poll('first-caller')).landed).toEqual([]);
    expect((await runtime.poll('first-caller')).error).toBe('routing has no Mastra instance to plan against');
    expect((await runtime.poll('second-caller')).finished).toBe(true);
  });

  it('still reports nothing in flight when no request has been started at all', async () => {
    const snapshot = await getRoutingRuntime().poll('nobody-routed-anything');

    expect(snapshot.finished).toBe(false);
    expect(snapshot.inProgress).toEqual([]);
  });
});
