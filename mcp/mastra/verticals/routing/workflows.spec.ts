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
  AFFECTED_ENTITIES_GRACE_MS,
  buildSnapshot,
  DEFAULT_ROUTING_SESSION_ID,
  RoutingProgress,
  type RoutingRuntime,
  resetRoutingRuntime,
  setRoutingRuntime,
} from './controller.js';
import type { OpenQuestion } from './questions.js';
import type { PhotoToBringUp } from './waiting-photos.js';
import {
  askWhatToDoWithPhoto,
  FINISHED_REQUEST_INSTRUCTIONS,
  getNextInstructionsWorkflow,
  inputSchema,
  instructionsOutputSchema,
  MARK_AFFECTED_INSTRUCTIONS,
  MARK_AFFECTED_TOOL,
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

/** A delegation's agent stopping to ask the user something, the way a plan run reports it. */
function suspendDelegation(sessionId: string, delegationId: string, question: string): void {
  progressFor(sessionId).handle({
    type: 'delegation_suspended',
    delegationId,
    suspension: {
      agentRunId: 'agent-run-1',
      toolCallId: 'call-1',
      suspendPayload: { question },
      resumeSchema: JSON.stringify({ type: 'object', properties: { userAnswer: { type: 'string' } } }),
    },
  });
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
  async poll(sessionId, options) {
    return buildSnapshot(progressFor(sessionId), options);
  },
  async waitForChange(_sessionId, deadlineMs) {
    // Nothing in these tests settles on its own — the spec arranges state up front — so a
    // wait here can only ever run out. Consuming the deadline rather than returning at once
    // is what keeps the poll loop from spinning through it in tight iterations.
    await new Promise((resolve) => setTimeout(resolve, deadlineMs));
  },
  async notifyWhenDone(sessionId) {
    const progress = progressFor(sessionId);
    if (progress.isFinished() || progress.isIdle()) {
      return false;
    }
    progress.notifyWhenDone = true;
    return true;
  },
};

/** A delegation's agent starting something marked slow, the way a plan run reports it. */
function startSlowWork(sessionId: string, delegationId: string): void {
  progressFor(sessionId).handle({ type: 'delegation_slow', delegationId });
}

/** A delegation's tool reading or changing things, the way a plan run reports it. */
function touchThings(sessionId: string, delegationId: string, ...entities: { id: string; name?: string }[]): void {
  progressFor(sessionId).handle({ type: 'delegation_affected_entities', delegationId, entities });
}

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

describe('a request made while earlier work is waiting on the user', () => {
  const EARLIER: OpenQuestion = {
    id: 'q7',
    taskId: 'Push reminders for tasks',
    agentId: 'coding',
    question: 'Should the reminder go out by email, or as a push notification?',
    deliverAnswer: async () => 'Passed on.',
  };

  it('answers the request, then brings the earlier question up', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    progress.earlierQuestions = [EARLIER];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(closing.questionsForUser).toEqual([{ id: EARLIER.taskId, question: EARLIER.question }]);
    expect(closing.instructions).toStartWith('This request has finished, but work he started earlier');
    expect(closing.instructions).toContain('Then remind him of it and ask him the question');
    expect(closing.instructions).toContain('send his answer through routePromptWorkflow');
  });

  it('asks this request’s own question last, after the earlier one', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'remind me before tasks are due', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), 'How early?');
    progress.earlierQuestions = [EARLIER];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([
      { id: EARLIER.taskId, question: EARLIER.question },
      { id: 'coding', question: 'How early?' },
    ]);
    expect(closing.instructions).toStartWith('Part of this request cannot go on');
  });

  it('still brings the earlier question up when the request failed', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the meaning of life', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.earlierQuestions = [EARLIER];
    progress.fail('none of the specialized agents can handle this request');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toStartWith('The request could not be completed');
    expect(closing.instructions).toContain('work he started earlier is still waiting on him');
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(closing.questionsForUser).toEqual([{ id: EARLIER.taskId, question: EARLIER.question }]);
  });
});

/**
 * A photo sir sent that nobody has looked at yet, brought up by a later request's closing report the
 * way an earlier question is (see `waiting-photos.ts`). Which photos are due is decided there; this
 * is what Jarvis is handed once they are.
 */
describe('a request made while a photo he sent is waiting on him', () => {
  const PHOTO: PhotoToBringUp = {
    id: 'photo3',
    question:
      'Sir sent you a photo 4 minutes ago (photo3) that nobody has looked at yet: ask him what he would like done with it.',
  };
  const EARLIER: OpenQuestion = {
    id: 'q7',
    taskId: 'Push reminders for tasks',
    agentId: 'coding',
    question: 'Should the reminder go out by email, or as a push notification?',
    deliverAnswer: async () => 'Passed on.',
  };

  it('answers the request, then asks what he would like done with the photo', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    progress.waitingPhotos = [PHOTO];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    // The id is the photo's, which is what his reply has to name it by.
    expect(closing.questionsForUser).toEqual([PHOTO]);
    expect(closing.instructions).toStartWith(
      'This request has finished, but work he started earlier, or a photo he sent, is still waiting on him',
    );
    expect(closing.instructions).toContain('Then remind him of it and ask him the question');
    expect(closing.instructions).toContain('send his answer through routePromptWorkflow');
    expect(closing.instructions).toContain('the photo named by its id');
    expect(closing.instructions).toContain('"(photo photo3)"');
    // "Nothing" goes back too: routed, it dismisses the photo, where left unrouted it would go on
    // waiting.
    expect(closing.instructions).toContain('That includes wanting nothing done with it: routed, it lets the photo go');
    // Still waiting on him, so the call must not hang up under the question.
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(closing.instructions).toContain('end_call');
  });

  it('asks about the photo beside earlier work’s questions, and before this request’s own', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'remind me before tasks are due', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), 'How early?');
    progress.earlierQuestions = [EARLIER];
    progress.waitingPhotos = [PHOTO];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([
      { id: EARLIER.taskId, question: EARLIER.question },
      PHOTO,
      { id: 'coding', question: 'How early?' },
    ]);
    expect(closing.instructions).toStartWith('Part of this request cannot go on');
    expect(closing.instructions).toContain('If there is more than one, ask them together');
    expect(closing.instructions).toContain('"(photo photo3)"');
  });

  it('brings the photo up beside an earlier question when nothing of this request is waiting', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.earlierQuestions = [EARLIER];
    progress.waitingPhotos = [PHOTO];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([{ id: EARLIER.taskId, question: EARLIER.question }, PHOTO]);
    expect(closing.instructions).toStartWith(
      'This request has finished, but work he started earlier, or a photo he sent',
    );
    expect(closing.instructions).toContain('Remind him of it and ask him the question');
  });

  it('still brings the photo up when the request failed', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the meaning of life', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.waitingPhotos = [PHOTO];
    progress.fail('none of the specialized agents can handle this request');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toStartWith('The request could not be completed');
    expect(closing.instructions).toContain('work he started earlier, or a photo he sent, is still waiting on him');
    expect(closing.instructions).toContain('"(photo photo3)"');
    expect(closing.instructions).toContain('That includes wanting nothing done with it');
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(closing.questionsForUser).toEqual([PHOTO]);
  });

  it('brings both up after a failure, the earlier question first', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the meaning of life', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.earlierQuestions = [EARLIER];
    progress.waitingPhotos = [PHOTO];
    progress.fail('none of the specialized agents can handle this request');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([{ id: EARLIER.taskId, question: EARLIER.question }, PHOTO]);
  });

  /**
   * The photo wording is added only when a photo is there, so every report that has none is word for
   * word what it was before photos could wait. The one exception is the hang-up's own, which holds the
   * line while he is getting a photo to Jarvis at all — the camera, not a photo that waits — and so is
   * left out of what is compared here (it is pinned under "how a request is answered").
   */
  it('says nothing of photos when none is waiting', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const answered = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    answered.earlierQuestions = [EARLIER];
    endPlanRun(answered);
    const withEarlierQuestion = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the meaning of life', async: false });
    const failed = progressFor(DEFAULT_ROUTING_SESSION_ID);
    failed.earlierQuestions = [EARLIER];
    failed.fail('none of the specialized agents can handle this request');
    const afterFailure = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    await runWorkflow(routePromptWorkflow, { userQuery: 'what is on my calendar', async: false });
    const plain = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'calendar', 'Dentist at four.');
    endPlanRun(plain);
    const allDone = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    for (const closing of [withEarlierQuestion, afterFailure, allDone]) {
      expect(closing.instructions.replace(FINISHED_REQUEST_INSTRUCTIONS, '')).not.toMatch(/photo/i);
    }
    expect(allDone.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(withEarlierQuestion.instructions).toStartWith(
      'This request has finished, but work he started earlier is still waiting on him to answer a question',
    );
    expect(allDone.instructions).toStartWith('All tasks have completed');
    expect(allDone.questionsForUser).toBeUndefined();
  });
});

/**
 * A photo sir sent with nothing said. The request is the look at it, and once Jarvis has said what it
 * shows he has to ask what sir would like done with it — the one question no work is suspended on —
 * and wait, where every other finished request has him stop and hang up if nothing more is said.
 * Which photos those are is the planner's to say (`photosToAskAbout`); this is what Jarvis is handed.
 */
describe('a request that showed him a photo with nothing said', () => {
  const LOOK = 'A Netto receipt for 36.95 DKK, for milk and rye bread.';
  const EARLIER: OpenQuestion = {
    id: 'q7',
    taskId: 'Push reminders for tasks',
    agentId: 'coding',
    question: 'Should the reminder go out by email, or as a push notification?',
    deliverAnswer: async () => 'Passed on.',
  };
  /** A reminder about a photo that has been waiting, as `waiting-photos.ts` words one. */
  function waitingReminder(photoId: string): PhotoToBringUp {
    return {
      id: photoId,
      question: `Sir sent you a photo 4 minutes ago (${photoId}) that nobody has looked at yet: ask him what he would like done with it.`,
    };
  }

  it('is asked in the words routing gives it, by the photo’s id', () => {
    expect(askWhatToDoWithPhoto('photo3')).toBe(
      'Now that you have told him what photo3 shows, ask him what he would like done with it.',
    );
  });

  it('says what the photo shows, then asks what he would like done with it, and waits for the answer', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'look at the photo he sent', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'vision', LOOK);
    progress.photosToAskAbout = ['photo3'];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.completedTaskResults).toEqual([{ id: 'vision', result: LOOK }]);
    expect(closing.questionsForUser).toEqual([{ id: 'photo3', question: askWhatToDoWithPhoto('photo3') }]);
    // This request's own question: its result first, then the question, asked last.
    expect(closing.instructions).toStartWith('Part of this request cannot go on until the user answers a question');
    expect(closing.instructions).toContain('Tell him whatever he has not heard yet');
    expect(closing.instructions).toContain(
      'ask him the question — briefly, in your own voice, as the last thing you say',
    );
    // And his answer comes back naming the photo, "nothing" included.
    expect(closing.instructions).toContain('"(photo photo3)"');
    expect(closing.instructions).toContain('That includes wanting nothing done with it');
    // Not the hang-up that ends every other finished request, which would close the line under it.
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(closing.instructions).toContain('end_call');
  });

  it('asks it last of all: after earlier work, waiting photos and this request’s own questions', async () => {
    await runWorkflow(routePromptWorkflow, {
      userQuery: 'remind me before tasks are due, and the photo',
      async: false,
    });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), 'How early?');
    delegate(DEFAULT_ROUTING_SESSION_ID, 'vision', LOOK);
    progress.earlierQuestions = [EARLIER];
    progress.waitingPhotos = [waitingReminder('photo2')];
    progress.photosToAskAbout = ['photo3'];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([
      { id: EARLIER.taskId, question: EARLIER.question },
      waitingReminder('photo2'),
      { id: 'coding', question: 'How early?' },
      { id: 'photo3', question: askWhatToDoWithPhoto('photo3') },
    ]);
    expect(closing.instructions).toContain('If there is more than one, ask them together');
  });

  it('asks about a photo once, as this request’s own, when it is also one waiting to be brought up', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'look at the photo he sent', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'vision', LOOK);
    progress.waitingPhotos = [waitingReminder('photo3')];
    progress.photosToAskAbout = ['photo3'];
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([{ id: 'photo3', question: askWhatToDoWithPhoto('photo3') }]);
  });

  it('asks nothing about it when the request failed, and leaves a reminder for it standing', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'look at the photo he sent', async: false });
    const failed = progressFor(DEFAULT_ROUTING_SESSION_ID);
    failed.photosToAskAbout = ['photo3'];
    failed.fail('the plan could not be registered');
    const afterFailure = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(afterFailure.questionsForUser).toBeUndefined();
    expect(afterFailure.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);

    await runWorkflow(routePromptWorkflow, { userQuery: 'look at the photo he sent', async: false });
    const failedWithReminder = progressFor(DEFAULT_ROUTING_SESSION_ID);
    failedWithReminder.photosToAskAbout = ['photo3'];
    failedWithReminder.waitingPhotos = [waitingReminder('photo3')];
    failedWithReminder.fail('the plan could not be registered');
    const withReminder = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(withReminder.questionsForUser).toEqual([waitingReminder('photo3')]);
  });
});

describe('a request that is waiting on the user', () => {
  const QUESTION = 'Should the reminder go out by email, or as a push notification?';

  it('hands Jarvis the question once everything else is done, and tells him to ask it', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'remind me before tasks are due', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), QUESTION);
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.questionsForUser).toEqual([{ id: 'coding', question: QUESTION }]);
    expect(closing.completedTaskResults).toBeUndefined();
    expect(closing.taskIdsInProgress).toEqual([]);
    // "All tasks have completed" would be untrue, and would invite him to close the matter.
    expect(closing.instructions).not.toContain('All tasks have completed');
    // With nothing to recap, the ask is its own sentence. It once read "questionsForUser. ask him".
    expect(closing.instructions).toStartWith(
      'Part of this request cannot go on until the user answers a question, which is in questionsForUser. Ask him ' +
        'the question',
    );
  });

  /**
   * The agent prompt tells Jarvis never to ask sir a clarifying question, and to assume
   * instead. A question from the work is the one exception, so the instruction has to say so
   * outright — and has to say where the answer goes, since nothing else in the loop would.
   */
  it('says the question is to be asked, not answered for him, and where his answer goes', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'remind me before tasks are due', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), QUESTION);
    endPlanRun(progress);

    const { instructions } = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(instructions).toContain('questionsForUser');
    expect(instructions).toContain('ask it even though you otherwise never ask him anything');
    expect(instructions).toContain('never answer it for him');
    expect(instructions).toContain('send his answer through routePromptWorkflow');
    // The hang-up exception travels with every instruction that sends him back to routing.
    expect(instructions).toContain('end_call');
  });

  it('relays the rest of the request’s results before the question', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather, and remind me about tasks', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), QUESTION);
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(closing.questionsForUser).toEqual([{ id: 'coding', question: QUESTION }]);
    expect(closing.instructions).toContain('Tell him whatever he has not heard yet');
  });

  it('holds the question back while other work is still running', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather, and remind me about tasks', async: false });
    startDelegation(DEFAULT_ROUTING_SESSION_ID, 'weather');
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), QUESTION);

    // His answer arrives as a new request, and a new request supersedes this one -- so asking
    // now would cancel the weather the moment he replied.
    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.questionsForUser).toBeUndefined();
    expect(outcome.taskIdsInProgress).toEqual(['weather']);
  });
});

describe('a request that has started something slow', () => {
  it('has Jarvis offer to notify the user, without routing his reply', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'add push reminders for tasks', async: false });
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'));

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.slowTaskIds).toEqual(['coding']);
    expect(outcome.taskIdsInProgress).toEqual(['coding']);
    expect(outcome.instructions).toContain('offer to notify him when it is done');
    expect(outcome.instructions).toContain('notifyWhenDone set to true');
    expect(outcome.instructions).toContain('never send it through routePromptWorkflow');
    expect(outcome.instructions).toContain('end_call');
  });

  it('makes the offer once per task', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'add push reminders for tasks', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding');
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, delegationId);
    await runWorkflow(getNextInstructionsWorkflow, {});

    startSlowWork(DEFAULT_ROUTING_SESSION_ID, delegationId);
    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.slowTaskIds).toBeUndefined();
    expect(outcome.instructions).toContain('Still processing');
  });

  it('relays results that landed alongside the offer', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'weather, and add push reminders', async: false });
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'));

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(outcome.slowTaskIds).toEqual(['coding']);
  });

  it('takes the user up on it, and releases Jarvis from polling', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'add push reminders for tasks', async: false });
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'));
    await runWorkflow(getNextInstructionsWorkflow, {});

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, { notifyWhenDone: true }));

    expect(progressFor(DEFAULT_ROUTING_SESSION_ID).notifyWhenDone).toBe(true);
    expect(outcome.instructions).toContain('will be notified when this request is done');
    expect(outcome.instructions).toContain('stop calling getNextInstructionsWorkflow');
    expect(outcome.taskIdsInProgress).toEqual(['coding']);
  });

  it('reports a request that finished before he accepted, rather than promising a notification', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'add push reminders for tasks', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'coding', 'Started a Claude Code session.');
    endPlanRun(progress);

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, { notifyWhenDone: true }));

    expect(progress.notifyWhenDone).toBe(false);
    expect(outcome.instructions).toStartWith('All tasks have completed');
  });
});

/**
 * What a request has touched, which the voice agent passes to `markAffected` so sir's headset lights
 * it up while the work is still going on.
 */
describe('a request whose tools touch things', () => {
  const SOFA_LAMP = { id: 'light.sofa_lamp', name: 'Sofa lamp' };
  const PORCH = { id: 'light.porch', name: 'Porch' };

  /**
   * Has the polls wait on the request itself, as the real runtime's do, with a deadline long enough
   * that only what the request does ends one: the default fake only ever runs out its deadline.
   */
  function waitOnTheRequest(deadlineMs = 5_000): void {
    setRoutingRuntime({
      ...fakeRuntime,
      async waitForChange(sessionId, remainingMs) {
        await Promise.race([progressFor(sessionId).wait(), new Promise((resolve) => setTimeout(resolve, remainingMs))]);
      },
    });
    setPollDeadlineForTest(deadlineMs);
  }

  /** Polls once, and says how long the poll took to answer. */
  async function timedPoll(input: { notifyWhenDone?: boolean } = {}) {
    const startedAt = Date.now();
    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, input));
    return { outcome, elapsedMs: Date.now() - startedAt };
  }

  it('ends a waiting poll with the first things touched once the grace window has passed', async () => {
    waitOnTheRequest();
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn on the sofa lamp', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');

    const polled = timedPoll();
    setTimeout(() => touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, SOFA_LAMP), 20);
    const { outcome, elapsedMs } = await polled;

    expect(outcome.affectedEntities).toEqual([SOFA_LAMP]);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(outcome.instructions).toContain('call getNextInstructionsWorkflow again at once');
    expect(outcome.instructions).toContain('say nothing to the user');
    expect(outcome.taskIdsInProgress).toEqual(['internetOfThings']);
    expect(outcome.completedTaskResults).toBeUndefined();
    expect(outcome.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    // Held for the window, so the glow is late by that much and no more -- never by the deadline.
    expect(elapsedMs).toBeGreaterThanOrEqual(AFFECTED_ENTITIES_GRACE_MS);
    expect(elapsedMs).toBeLessThan(AFFECTED_ENTITIES_GRACE_MS + 1_000);
  });

  it('sends a result landing inside the window in the same response, sparing a step', async () => {
    waitOnTheRequest();
    await runWorkflow(routePromptWorkflow, { userQuery: 'sofa lamp on, and the weather', async: false });
    const lamp = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');
    startDelegation(DEFAULT_ROUTING_SESSION_ID, 'weather');

    const polled = timedPoll();
    touchThings(DEFAULT_ROUTING_SESSION_ID, lamp, SOFA_LAMP);
    setTimeout(() => finishDelegation(DEFAULT_ROUTING_SESSION_ID, lamp, { text: 'The sofa lamp is on.' }), 100);
    const { outcome, elapsedMs } = await polled;

    expect(outcome.affectedEntities).toEqual([SOFA_LAMP]);
    expect(outcome.completedTaskResults).toEqual([{ id: 'internetOfThings', result: 'The sofa lamp is on.' }]);
    expect(outcome.instructions).toContain('More results have arrived');
    expect(elapsedMs).toBeLessThan(AFFECTED_ENTITIES_GRACE_MS);
  });

  it('sends the closing report landing inside the window in the same response', async () => {
    waitOnTheRequest();
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn on the sofa lamp', async: false });
    const lamp = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');

    const polled = timedPoll();
    touchThings(DEFAULT_ROUTING_SESSION_ID, lamp, SOFA_LAMP);
    setTimeout(() => {
      finishDelegation(DEFAULT_ROUTING_SESSION_ID, lamp, { text: 'The sofa lamp is on.' });
      endPlanRun(progressFor(DEFAULT_ROUTING_SESSION_ID));
    }, 100);
    const { outcome } = await polled;

    expect(outcome.affectedEntities).toEqual([SOFA_LAMP]);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(outcome.instructions).toContain('All tasks have completed');
  });

  it('never ends a poll for things touched after the first batch; they ride on the next report', async () => {
    waitOnTheRequest();
    await runWorkflow(routePromptWorkflow, { userQuery: 'the sofa lamp, then the porch', async: false });
    const lamps = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');
    touchThings(DEFAULT_ROUTING_SESSION_ID, lamps, SOFA_LAMP);
    expect((await timedPoll()).outcome.affectedEntities).toEqual([SOFA_LAMP]);

    const polled = timedPoll();
    touchThings(DEFAULT_ROUTING_SESSION_ID, lamps, PORCH);
    setTimeout(() => finishDelegation(DEFAULT_ROUTING_SESSION_ID, lamps, { text: 'Both are on.' }), 800);
    const { outcome, elapsedMs } = await polled;

    // Woken by the result, well after the window: the porch did not end the poll by itself.
    expect(elapsedMs).toBeGreaterThanOrEqual(700);
    expect(outcome.affectedEntities).toEqual([PORCH]);
    expect(outcome.completedTaskResults).toEqual([{ id: 'internetOfThings', result: 'Both are on.' }]);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
  });

  it('carries later things on the response a poll gives when it runs out its deadline', async () => {
    waitOnTheRequest(AFFECTED_ENTITIES_GRACE_MS + 400);
    await runWorkflow(routePromptWorkflow, { userQuery: 'the sofa lamp, then the porch', async: false });
    const lamps = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');
    touchThings(DEFAULT_ROUTING_SESSION_ID, lamps, SOFA_LAMP);
    await timedPoll();

    touchThings(DEFAULT_ROUTING_SESSION_ID, lamps, PORCH);
    const { outcome, elapsedMs } = await timedPoll();

    expect(elapsedMs).toBeGreaterThanOrEqual(AFFECTED_ENTITIES_GRACE_MS + 350);
    expect(outcome.affectedEntities).toEqual([PORCH]);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(outcome.instructions).toContain('call getNextInstructionsWorkflow again at once');
    expect(outcome.completedTaskResults).toBeUndefined();
  });

  it('puts marking them before the results that landed with them', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'sofa lamp on, and the weather', async: false });
    touchThings(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings'), SOFA_LAMP);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.affectedEntities).toEqual([SOFA_LAMP]);
    expect(outcome.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(outcome.instructions).toContain('More results have arrived');
  });

  it('puts marking them before the offer to notify him about slow work', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'review the repository', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding');
    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, { id: 'ffmathy/hey-jarvis', name: 'hey-jarvis' });
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, delegationId);

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.affectedEntities).toEqual([{ id: 'ffmathy/hey-jarvis', name: 'hey-jarvis' }]);
    expect(outcome.slowTaskIds).toEqual(['coding']);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(outcome.instructions).toContain('offer to notify him when it is done');
  });

  it('reports each thing once', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn on the sofa lamp', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');
    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, SOFA_LAMP);
    await runWorkflow(getNextInstructionsWorkflow, {});

    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, SOFA_LAMP);
    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.affectedEntities).toBeUndefined();
    expect(outcome.instructions).toContain('Still processing');
  });

  it('closes a request with whatever it touched that has not been reported yet', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn on the sofa lamp and the porch', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');
    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, SOFA_LAMP);
    await runWorkflow(getNextInstructionsWorkflow, {});

    // A command can finish in the time it takes to poll, and the headset keeps a record of what was
    // touched as well as lighting it up -- so the closing report carries what is left.
    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, SOFA_LAMP, PORCH);
    finishDelegation(DEFAULT_ROUTING_SESSION_ID, delegationId, { text: 'Both are on.' });
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.affectedEntities).toEqual([PORCH]);
    expect(closing.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(closing.instructions).toContain('All tasks have completed');
    expect(closing.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('still reports what a request touched before it failed', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn on the sofa lamp', async: false });
    touchThings(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings'), SOFA_LAMP);
    progressFor(DEFAULT_ROUTING_SESSION_ID).fail('the house did not answer');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.affectedEntities).toEqual([SOFA_LAMP]);
    expect(closing.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(closing.instructions).toContain('could not be completed');
  });

  it('still reports what a request touched before he stopped it, beside saying it was stopped', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn on the sofa lamp', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    touchThings(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings'), SOFA_LAMP);
    progress.conversationControl = 'cancelled';
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.affectedEntities).toEqual([SOFA_LAMP]);
    expect(closing.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(closing.instructions).toContain('it has been stopped');
    expect(closing.completedTaskResults).toBeUndefined();
  });

  it('carries them on the reply to his accepting the offer, the last response he will hear about it', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'review the repository', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding');
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, delegationId);
    await runWorkflow(getNextInstructionsWorkflow, {});
    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, { id: 'ffmathy/hey-jarvis' });

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, { notifyWhenDone: true }));

    expect(outcome.affectedEntities).toEqual([{ id: 'ffmathy/hey-jarvis' }]);
    expect(outcome.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(outcome.instructions).toContain('will be notified when this request is done');
  });

  it('names the client tool exactly, and asks for it silently, as given and never retried', () => {
    expect(MARK_AFFECTED_TOOL).toBe('markAffected');
    expect(MARK_AFFECTED_INSTRUCTIONS).toContain(`call ${MARK_AFFECTED_TOOL} with exactly those entities`);
    expect(MARK_AFFECTED_INSTRUCTIONS).toContain('every id and name as given');
    expect(MARK_AFFECTED_INSTRUCTIONS).toContain('never announce or mention it');
    expect(MARK_AFFECTED_INSTRUCTIONS).toContain('never call it again if it fails');
  });

  it('keeps only the list itself out of what he hears, since the things are often the answer', async () => {
    // "Which lights are on in the kitchen?" is answered by naming the very lights the lookup touched.
    await runWorkflow(routePromptWorkflow, { userQuery: 'which kitchen lights are on?', async: false });
    const delegationId = startDelegation(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings');
    touchThings(DEFAULT_ROUTING_SESSION_ID, delegationId, SOFA_LAMP, PORCH);
    finishDelegation(DEFAULT_ROUTING_SESSION_ID, delegationId, { text: 'The sofa lamp and the porch light are on.' });
    endPlanRun(progressFor(DEFAULT_ROUTING_SESSION_ID));

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('never read out the affectedEntities list or an id from it');
    expect(closing.instructions).toContain('still names things as it always would');
    expect(closing.instructions).not.toContain('never read an entity aloud');
    expect(closing.instructions).toContain('All tasks have completed');
  });

  it('publishes the field, and tells the voice agent to route what sir points at by its id', () => {
    expect(
      instructionsOutputSchema.shape.affectedEntities.parse([{ id: 'light.sofa_lamp', name: 'Sofa lamp' }]),
    ).toEqual([{ id: 'light.sofa_lamp', name: 'Sofa lamp' }]);
    expect(inputSchema.shape.userQuery.description).toContain(
      'Turn that on (pointing at "Kitchen ceiling", id light.kitchen_ceiling)',
    );
  });
});

/**
 * When a silence is sir busy with a photo, as every statement of the wait words it: the prompt's **When
 * Sir Is Silent** and the `end_call` and `skip_turn` descriptions in `elevenlabs/src/assets/` too, which
 * `agent-config.spec.ts` holds to the same phrases.
 *
 * Only a device that said it has a camera button can be waited on, and only what settles the photo ends
 * the wait. A word from sir about anything else once did too — and the request it was routed as ended
 * on the hang-up, which closed the line on him on his way to the camera.
 */
const WAITING_FOR_A_PHOTO =
  'you are waiting for a photo from him on a device that has told you it has a camera button — he said he ' +
  'would send one, or a note says he has opened the camera on his phone — and since then the photo has not ' +
  'come, nor a message that it did not reach you, nor a note that he closed the camera without one, and he ' +
  'has not said it is not coming';

/**
 * How long Jarvis is told to be, and when the call is allowed to end.
 *
 * The planner labels each request (see `RESPONSE_STYLES`), and every report speaks in that style.
 * A finished request also ends with `FINISHED_REQUEST_INSTRUCTIONS`, which hangs up silently if sir
 * stays quiet -- and nothing that is still waiting on him may carry it, or the call would end
 * under a question he was about to answer.
 */
describe('how a request is answered, and when the call may end', () => {
  it('confirms a command in a few words, and hands over to the hang-up', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn off the living room lights', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.responseStyle = 'command';
    delegate(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings', 'Turned off 3 lights in the living room.');
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('"Done, sir." is enough');
    expect(closing.instructions).not.toContain('in detail');
    expect(closing.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('gives a briefing its detail, and still hands over to the hang-up once it is done', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is on my calendar this week', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.responseStyle = 'briefing';
    delegate(DEFAULT_ROUTING_SESSION_ID, 'calendar', 'Three meetings and a dentist appointment.');
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('Summarize the results in detail');
    expect(closing.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('answers a lookup in one sentence, and conversation in full character', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'is the front door locked', async: false });
    const lookup = progressFor(DEFAULT_ROUTING_SESSION_ID);
    lookup.responseStyle = 'lookup';
    delegate(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings', 'The front door is locked.');
    endPlanRun(lookup);
    const lookupClosing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    await runWorkflow(routePromptWorkflow, { userQuery: 'what do you make of my week', async: false });
    const conversation = progressFor(DEFAULT_ROUTING_SESSION_ID);
    conversation.responseStyle = 'conversation';
    delegate(DEFAULT_ROUTING_SESSION_ID, 'calendar', 'A quiet week.');
    endPlanRun(conversation);
    const conversationClosing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(lookupClosing.instructions).toContain('one short sentence');
    expect(conversationClosing.instructions).toContain('full character');
  });

  it('speaks results that land part way in the request\u2019s style, without ending the call', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'lights off and blinds down', async: false });
    progressFor(DEFAULT_ROUTING_SESSION_ID).responseStyle = 'command';
    delegate(DEFAULT_ROUTING_SESSION_ID, 'internetOfThings', 'Lights off.');
    startDelegation(DEFAULT_ROUTING_SESSION_ID, 'blinds');

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).toContain('"Done, sir." is enough');
    expect(outcome.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('hands over to the hang-up after a request that failed, which is finished too', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'turn off the lights', async: false });
    progressFor(DEFAULT_ROUTING_SESSION_ID).fail('the house did not answer');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('could not be completed');
    expect(closing.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(closing.instructions).toContain('end_call');
  });

  it('never ends the call under a question he has yet to answer', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'remind me before tasks are due', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    suspendDelegation(
      DEFAULT_ROUTING_SESSION_ID,
      startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'),
      'Email, or a push notification?',
    );
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('never ends the call under an offer he has yet to answer', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'add push reminders for tasks', async: false });
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'));

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(outcome.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('hands over to the hang-up once he has agreed to be notified instead', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'add push reminders for tasks', async: false });
    startSlowWork(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'));
    await runWorkflow(getNextInstructionsWorkflow, {});

    const outcome = resultOf(await runWorkflow(getNextInstructionsWorkflow, { notifyWhenDone: true }));

    expect(outcome.instructions).toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('errs on the side of saying enough when the planner never labelled the request', () => {
    expect(new RoutingProgress().responseStyle).toBe('briefing');
  });

  /**
   * The phone's note that sir has opened the camera is not him saying anything, so without this the
   * turn timeout would have Jarvis hang up while he frames the shot. The prompt and the end_call and
   * skip_turn descriptions state the exception in these same words.
   */
  it('holds the line while he is getting a photo to Jarvis, even straight after a finished request', () => {
    const exception = `Unless ${WAITING_FOR_A_PHOTO}: then call skip_turn instead.`;

    expect(FINISHED_REQUEST_INSTRUCTIONS).toContain(exception);
    // Straight after the hang-up it qualifies, which is what makes it an exception to it.
    expect(FINISHED_REQUEST_INSTRUCTIONS).toContain(`call end_call without a word. ${exception}`);
  });
});

/**
 * A request that said a photo is on its way (`awaitsPhoto` in `planner.ts`). Sir is about to go quiet
 * to take it, so the hang-up every other finished request ends on would close the line under him.
 */
describe('a request that said a photo is on its way', () => {
  const WAITS = 'call skip_turn, however many times you are asked — never end_call, since he is taking the photo';
  const GO_AHEAD = 'tell him in a few words to go ahead with the camera button on his phone';

  /**
   * The watch, the Voice speaker and a telephone call share the agent and have no camera button. The
   * photo he sends from his phone goes to the phone's own conversation, so nothing here waits for it.
   */
  const NOT_WAITED_FOR_HERE =
    'But if no note has told you this device has a camera button, it cannot send one: instead, last of all, tell ' +
    'him in a few words to send it from his phone. This conversation is not waiting for that photo, so if you ' +
    'are asked to speak again before he has said anything, call end_call without a word.';

  /** The same, before a question the report asks, which is still asked last. */
  const SENT_TO_HIS_PHONE_BEFORE_ASKING =
    '— or, if no note has told you this device has a camera button, to send it from his phone instead.';

  it('has Jarvis tell him to go ahead, then wait for the photo instead of hanging up', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt", async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.awaitsPhoto = true;
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    // Still the words that tell him to stop polling.
    expect(closing.instructions).toStartWith(
      'All tasks have completed. He said he is about to send you a photo, which has not arrived yet.',
    );
    expect(closing.instructions).toContain(GO_AHEAD);
    // Waited for in the words every statement of the wait shares, so what ends it is the same everywhere.
    expect(closing.instructions).toContain(`While ${WAITING_FOR_A_PHOTO}, if you are asked to speak again, ${WAITS}`);
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    // Nothing to recap, and anything further still goes through routing.
    expect(closing.instructions).not.toContain('These are every result');
    expect(closing.instructions).toContain('send it through routePromptWorkflow');
    // A goodbye still ends the call: it is his word, not the silence.
    expect(closing.instructions).toContain('if he says goodbye');
    expect(closing.questionsForUser).toBeUndefined();
  });

  it('sends him to his phone instead, and hangs up on the silence, where no device has said it has a camera button', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt", async: false });
    const waiting = progressFor(DEFAULT_ROUTING_SESSION_ID);
    waiting.awaitsPhoto = true;
    endPlanRun(waiting);
    const answered = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt, and the weather?", async: false });
    const failed = progressFor(DEFAULT_ROUTING_SESSION_ID);
    failed.awaitsPhoto = true;
    failed.fail('the weather service did not answer');
    const afterFailure = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    // Routing cannot tell which device it is, so both cases go to Jarvis, who can, the wait first.
    for (const closing of [answered, afterFailure]) {
      expect(closing.instructions).toContain(`is taking the photo. ${NOT_WAITED_FOR_HERE}`);
    }
  });

  it('says what the rest of the request found first, then asks for the photo last of all', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt, and the weather?", async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.responseStyle = 'lookup';
    progress.awaitsPhoto = true;
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.completedTaskResults).toEqual([{ id: 'weather', result: 'It is 8 degrees.' }]);
    expect(closing.instructions).toContain('Tell him whatever he has not heard yet');
    expect(closing.instructions).toContain('one short sentence');
    expect(closing.instructions).toContain(`Last of all, ${GO_AHEAD}`);
    expect(closing.instructions).toContain(WAITS);
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('still waits for the photo when the rest of the request failed', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt, and the weather?", async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.awaitsPhoto = true;
    progress.fail('the weather service did not answer');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toStartWith('The request could not be completed');
    expect(closing.instructions).toContain(GO_AHEAD);
    expect(closing.instructions).toContain(WAITS);
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('has him told to go ahead before a question the report asks, which is still asked last', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt, and remind me", async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.awaitsPhoto = true;
    suspendDelegation(DEFAULT_ROUTING_SESSION_ID, startDelegation(DEFAULT_ROUTING_SESSION_ID, 'coding'), 'How early?');
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toStartWith('Part of this request cannot go on');
    expect(closing.instructions).toContain(`before you ask, ${GO_AHEAD}`);
    // Between the question and the call's own exception, a sentence apart from each: it was once
    // appended after the exception with no space, as "…an open line.He also said…".
    expect(closing.instructions).toContain(
      'the question stays open. He also said he is about to send you a photo, which has not arrived yet: ' +
        `before you ask, ${GO_AHEAD} ${SENT_TO_HIS_PHONE_BEFORE_ASKING} One kind of request is never routed`,
    );
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(closing.questionsForUser).toEqual([{ id: 'coding', question: 'How early?' }]);
  });

  it('has him told to go ahead before an earlier question a failed request brings up', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: "I'll send you a receipt, and the weather?", async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.awaitsPhoto = true;
    progress.earlierQuestions = [
      {
        id: 'q7',
        taskId: 'Push reminders for tasks',
        agentId: 'coding',
        question: 'Email, or a push notification?',
        deliverAnswer: async () => 'Passed on.',
      },
    ];
    progress.fail('the weather service did not answer');

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).toContain('work he started earlier is still waiting on him');
    expect(closing.instructions).toContain(
      `in his own words. He also said he is about to send you a photo, which has not arrived yet: before you ask, ` +
        `${GO_AHEAD} ${SENT_TO_HIS_PHONE_BEFORE_ASKING} One kind of request is never routed`,
    );
    expect(closing.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  });

  it('is waited for by nothing else: every other report reads as it did', async () => {
    await runWorkflow(routePromptWorkflow, { userQuery: 'what is the weather', async: false });
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    delegate(DEFAULT_ROUTING_SESSION_ID, 'weather', 'It is 8 degrees.');
    endPlanRun(progress);

    const closing = resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));

    expect(closing.instructions).not.toContain('He said he is about to send you a photo');
    expect(closing.instructions).not.toContain(WAITS);
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

describe('a request about the conversation itself', () => {
  async function closingReportFor(conversationControl: 'endCall' | 'cancelled') {
    const progress = progressFor(DEFAULT_ROUTING_SESSION_ID);
    progress.conversationControl = conversationControl;
    endPlanRun(progress);
    return resultOf(await runWorkflow(getNextInstructionsWorkflow, {}));
  }

  it('hands a goodbye straight back to end_call, rather than reporting that no agent could take it', async () => {
    const report = await closingReportFor('endCall');

    expect(report.instructions).toContain('call end_call');
    expect(report.instructions).not.toContain('could not be completed');
  });

  it('says only that the earlier request was stopped', async () => {
    const report = await closingReportFor('cancelled');

    expect(report.instructions).toContain('stopped');
    expect(report.completedTaskResults).toBeUndefined();
  });
});
