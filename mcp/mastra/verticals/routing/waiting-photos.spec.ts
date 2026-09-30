/**
 * When a photo nobody has looked at is brought up, and what Jarvis is told to ask about it.
 *
 * The store's half — what counts as waiting, and when a photo stops — is `vision/photos.spec.ts`;
 * how a closing report carries these is `workflows.spec.ts`. This is the part in between: the grace
 * that spares the conversation that just sent a photo, and the reminder that is not repeated after
 * every request — and, at the end, the same through the routing runtime, from what sir says to the
 * report Jarvis is handed, since the wiring between the store and the report is two lines that no
 * test of either half would miss. Then a photo sent with nothing said, from the message the voice agent
 * routes to the report that has Jarvis ask what sir would like done with it, and his answer to that; a
 * photo he says is on its way; a look he talks over; and, last of all, requests that join one still
 * running, as the routing classifier says they relate to it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { Classifier } from '@mastra/core/classifier';
import { InMemoryStore } from '@mastra/core/storage';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { PHOTO_READER_AGENT_ID } from '../vision/agents.js';
import {
  findPhoto,
  forgetPhotos,
  KEEP_PHOTO_MS,
  keepPhoto,
  markPhotoLookedAt,
  photosWaiting,
} from '../vision/photos.js';
import { visionTools } from '../vision/tools.js';
import { type RelationToRunningRequest, setRoutingClassifierForTest } from './classifier.js';
import {
  type CompletionNotice,
  resetCompletionNotifierForTest,
  setCompletionNotifierForTest,
} from './completion-notice.js';
import { DEFAULT_ROUTING_SESSION_ID, getRoutingRuntime, resetRoutingRuntime } from './controller.js';
import { PLANNER_AGENT_ID } from './planner.js';
import { QUESTION_REMINDER_INTERVAL_MS } from './questions.js';
import { forgetWaitingPhotoReminders, PHOTO_WAITING_GRACE_MS, takePhotosToBringUp } from './waiting-photos.js';
import {
  FINISHED_REQUEST_INSTRUCTIONS,
  getNextInstructionsWorkflow,
  resetPollDeadlineForTest,
  routePromptWorkflow,
  setPollDeadlineForTest,
} from './workflows.js';

/** A few bytes stand in for a JPEG: the photo reader is scripted, and only its being shown one matters. */
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** When the photos in these tests arrive. */
const SENT_AT = 1_000_000;

beforeEach(() => {
  forgetPhotos();
  forgetWaitingPhotoReminders();
});

// And after, since the store is the process's and every spec file shares it: a photo these tests
// leave waiting past its grace was brought up in the next file's routing requests, whose closing
// report then asked sir about it instead of closing (`coding-interview.spec.ts`, in CI's order).
afterEach(() => {
  forgetPhotos();
  forgetWaitingPhotoReminders();
});

describe('a photo nobody has looked at yet', () => {
  it('is left alone while the conversation that sent it is still getting round to it', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);

    expect(takePhotosToBringUp(SENT_AT + PHOTO_WAITING_GRACE_MS - 1)).toEqual([]);
  });

  it('is brought up once it has waited past that, by its id and how long it has waited', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);

    expect(takePhotosToBringUp(SENT_AT + 4 * 60_000)).toEqual([
      {
        id: 'photo1',
        question:
          'Sir sent you a photo 4 minutes ago (photo1) that nobody has looked at yet: ask him what he would like done with it.',
      },
    ]);
  });

  it('says how long in words, from the moment the grace runs out', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);

    const [broughtUp] = takePhotosToBringUp(SENT_AT + PHOTO_WAITING_GRACE_MS);

    expect(broughtUp?.question).toContain('Sir sent you a photo a minute ago (photo1)');
  });

  it('is left alone for a while once it has been brought up', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);
    const firstAskedAt = SENT_AT + PHOTO_WAITING_GRACE_MS;
    takePhotosToBringUp(firstAskedAt);

    expect(takePhotosToBringUp(firstAskedAt + QUESTION_REMINDER_INTERVAL_MS - 1)).toEqual([]);
  });

  it('is brought up once, in practice: it is let go of before the reminder would come round again', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);
    const firstAskedAt = SENT_AT + PHOTO_WAITING_GRACE_MS;
    takePhotosToBringUp(firstAskedAt);

    expect(firstAskedAt + QUESTION_REMINDER_INTERVAL_MS - SENT_AT).toBeGreaterThanOrEqual(KEEP_PHOTO_MS);
    expect(photosWaiting(firstAskedAt + QUESTION_REMINDER_INTERVAL_MS)).toEqual([]);
    expect(takePhotosToBringUp(firstAskedAt + QUESTION_REMINDER_INTERVAL_MS)).toEqual([]);
  });

  it('is never brought up again once it has been looked at', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);
    markPhotoLookedAt('photo1', SENT_AT + 10_000);

    expect(takePhotosToBringUp(SENT_AT + 4 * 60_000)).toEqual([]);
  });

  it('brings up each waiting photo, oldest first, and only those past the grace', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT + 60_000);
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT + 3 * 60_000);
    markPhotoLookedAt('photo2', SENT_AT + 90_000);

    const now = SENT_AT + 3 * 60_000 + 30_000;

    expect(takePhotosToBringUp(now).map((photo) => photo.id)).toEqual(['photo1']);
    // The newest has now waited long enough; the oldest was brought up a moment ago.
    expect(takePhotosToBringUp(SENT_AT + 4 * 60_000).map((photo) => photo.id)).toEqual(['photo3']);
  });

  it('is brought up afresh once the reminders are forgotten', () => {
    keepPhoto(PHOTO, 'image/jpeg', SENT_AT);
    const askedAt = SENT_AT + PHOTO_WAITING_GRACE_MS;
    takePhotosToBringUp(askedAt);

    forgetWaitingPhotoReminders();

    expect(takePhotosToBringUp(askedAt).map((photo) => photo.id)).toEqual(['photo1']);
  });
});

/*
 * The same, through the routing runtime: what sir says goes in through `routePromptWorkflow`, and
 * what Jarvis is handed comes out of `getNextInstructionsWorkflow`, as it does on a call. Every model
 * is scripted — the planner, a weather agent, and the vision agent with the photo reader behind its
 * real `lookAtPhoto` — so what is tested is the plumbing.
 */

const WEATHER_REQUEST = 'What is the weather?';
const WEATHER = 'It is 8 degrees.';
const LIGHTS_REQUEST = 'And turn on the kitchen lights.';
const LIGHTS = 'The kitchen lights are on.';
const DISMISSAL = "Answer to 'what would you like done with the photo?': nothing, never mind (photo photo1)";
/** What he says before he sends a photo, which the voice agent is told to hold, and routes anyway. */
const ANNOUNCEMENT = "I'll send you a receipt in a moment.";

/** The weather, as the planner plans it. */
const WEATHER_TASK = { id: 'weather', agentId: 'weather', prompt: WEATHER_REQUEST, needs: '' };

/** What the voice agent routes when the phone says a photo has arrived and sir has said nothing. */
function barePhoto(photoId: string): string {
  return `He sent a photo without saying what he wants: look at it and say what it shows (photo ${photoId})`;
}

/** What it routes when sir said what he wanted before the photo arrived. */
function totalOfPhoto(photoId: string): string {
  return `What is the total on this receipt? (photo ${photoId})`;
}

/** What the photo reader sees on the receipt. */
const READING = 'A receipt from Netto dated 30 September: milk 12.95 DKK, rye bread 24.00 DKK, total 36.95 DKK.';

/** What the vision agent makes of that reading. */
const LOOK = 'A Netto receipt for 36.95 DKK, for milk and rye bread; the items could go on the shopping list.';

/** A plan, as the planner writes one, with everything it leaves empty left empty. */
function plan(fields: {
  responseStyle: string;
  tasks?: { id: string; agentId: string; prompt: string; needs: string }[];
  dismissedPhotoIds?: string[];
  photosToAskAbout?: string[];
  awaitsPhoto?: boolean;
}) {
  return {
    text: JSON.stringify({
      tasks: [],
      answers: [],
      dismissedPhotoIds: [],
      photosToAskAbout: [],
      awaitsPhoto: false,
      ...fields,
    }),
  };
}

/**
 * The planner: whatever a request about a photo asks for, then the errands, and nothing any agent can
 * do otherwise.
 */
function scriptedPlanner() {
  return createScriptedModel(
    ({ transcript }) => photoPlan(transcript) ?? errandPlan(transcript) ?? plan({ responseStyle: 'conversation' }),
  );
}

/**
 * What the planner makes of a request about a photo: the photo dismissed when sir waves it away, a
 * photo on its way waited for — beside the weather, if he asked for that too — a look at a photo he
 * sent with nothing said, and Jarvis to ask about it, or at one he asked the total of.
 */
function photoPlan(transcript: string) {
  // By the tag in what he said rather than by a listed photo: one Jarvis has just asked him about
  // has been looked at, and the planner is shown it only because the request names it.
  const wavedAwayPhotoId = transcript.match(/never mind[^(]*\(photo (photo\d+)\)/i)?.[1];
  if (wavedAwayPhotoId) {
    return plan({ responseStyle: 'command', dismissedPhotoIds: [wavedAwayPhotoId] });
  }

  if (transcript.includes(ANNOUNCEMENT)) {
    const andTheWeather = transcript.includes(WEATHER_REQUEST);
    return plan({
      responseStyle: andTheWeather ? 'lookup' : 'command',
      tasks: andTheWeather ? [WEATHER_TASK] : [],
      awaitsPhoto: true,
    });
  }

  const listedPhotoId = transcript.match(/^- (photo\d+), sent /m)?.[1];
  if (listedPhotoId && transcript.includes(barePhoto(listedPhotoId))) {
    return plan({
      responseStyle: 'lookup',
      tasks: [
        {
          id: 'look',
          agentId: 'vision',
          prompt: `Say what the photo shows and what could be done with it (photo ${listedPhotoId}).`,
          needs: '',
        },
      ],
      photosToAskAbout: [listedPhotoId],
    });
  }

  if (listedPhotoId && transcript.includes(totalOfPhoto(listedPhotoId))) {
    return plan({
      responseStyle: 'lookup',
      tasks: [{ id: 'total', agentId: 'vision', prompt: totalOfPhoto(listedPhotoId), needs: '' }],
    });
  }

  return undefined;
}

/** What the planner makes of the errands: a weather task for the weather, and a lights task for the lights. */
function errandPlan(transcript: string) {
  if (transcript.includes(WEATHER_REQUEST)) {
    return plan({ responseStyle: 'lookup', tasks: [WEATHER_TASK] });
  }

  if (transcript.includes(LIGHTS_REQUEST)) {
    return plan({
      responseStyle: 'command',
      tasks: [{ id: 'lights', agentId: 'internetOfThings', prompt: LIGHTS_REQUEST, needs: '' }],
    });
  }

  return undefined;
}

/**
 * The vision agent: it calls `lookAtPhoto` for the photo its prompt names, then answers from what
 * came back — or says it could not, when the reader failed.
 */
function scriptedVision() {
  return createScriptedModel(({ transcript }) => {
    if (transcript.includes('"type":"tool-result"')) {
      return { text: transcript.includes('shows: «') ? LOOK : 'I could not look at the photo.' };
    }

    const photoId = transcript.match(/\(photo (photo\d+)\)/)?.[1];
    return {
      toolCalls: [
        { toolName: 'lookAtPhoto', input: { photoId, question: 'What does it show, and what could be acted on?' } },
      ],
    };
  });
}

/** A model that holds every reply back until `until` settles, so a request stays in flight. */
function heldBack(model: ReturnType<typeof createScriptedModel>['model'], until: Promise<void>) {
  return {
    ...model,
    doStream: async (options: Parameters<typeof model.doStream>[0]) => {
      await until;
      return model.doStream(options);
    },
    doGenerate: async (options: Parameters<typeof model.doGenerate>[0]) => {
      await until;
      return model.doGenerate(options);
    },
  };
}

/**
 * A model that holds back only the reply it writes once its look has come back, so the look itself —
 * and the photo marked looked at with it — is done while the request is still in flight.
 */
function heldBackAfterItsLook(model: ReturnType<typeof createScriptedModel>['model'], until: Promise<void>) {
  const hasLooked = (options: Parameters<typeof model.doStream>[0]) =>
    JSON.stringify(options.prompt).includes('"tool-result"');
  return {
    ...model,
    doStream: async (options: Parameters<typeof model.doStream>[0]) => {
      if (hasLooked(options)) {
        await until;
      }
      return model.doStream(options);
    },
    doGenerate: async (options: Parameters<typeof model.doGenerate>[0]) => {
      if (hasLooked(options)) {
        await until;
      }
      return model.doGenerate(options);
    },
  };
}

/** How the stand-ins for the models are set up for one test. */
interface SetUpOptions {
  /** Holds the weather agent's answer back until this settles. */
  weatherAnswersOnceThisSettles?: Promise<void>;
  /** Holds the vision agent's answer back, once it has looked, until this settles. */
  visionAnswersAfterItsLookOnceThisSettles?: Promise<void>;
  /** Makes the photo reader fail, as an unreachable model would. */
  readerFails?: boolean;
}

/**
 * Registers the routing workflows, the planner, a weather agent, a smart home agent, and the vision
 * agent with the photo reader behind it, and hands back the planner's and the reader's calls.
 */
async function setUp({
  weatherAnswersOnceThisSettles = Promise.resolve(),
  visionAnswersAfterItsLookOnceThisSettles = Promise.resolve(),
  readerFails = false,
}: SetUpOptions = {}) {
  const planner = scriptedPlanner();
  const weather = createScriptedModel(() => ({ text: WEATHER }));
  const lights = createScriptedModel(() => ({ text: LIGHTS }));
  const reader = createScriptedModel(() => {
    if (readerFails) {
      throw new Error('The photo reader could not be reached.');
    }
    return { text: READING };
  });

  new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { routePromptWorkflow, getNextInstructionsWorkflow },
    agents: {
      [PLANNER_AGENT_ID]: await scriptedAgent(PLANNER_AGENT_ID, planner.model),
      weather: await scriptedAgent('weather', heldBack(weather.model, weatherAnswersOnceThisSettles)),
      internetOfThings: await scriptedAgent('internetOfThings', lights.model),
      vision: await scriptedAgent(
        'vision',
        heldBackAfterItsLook(scriptedVision().model, visionAnswersAfterItsLookOnceThisSettles),
        { tools: visionTools },
      ),
      [PHOTO_READER_AGENT_ID]: await scriptedAgent(PHOTO_READER_AGENT_ID, reader.model),
    },
  });

  return { plannerCalls: planner.calls, readerCalls: reader.calls };
}

/** An agent on a scripted model, without the shared memory that would want real credentials. */
async function scriptedAgent(
  id: string,
  model: ReturnType<typeof createScriptedModel>['model'],
  extra: { tools?: typeof visionTools } = {},
) {
  return createAgent({ id, name: id, instructions: `You are ${id}.`, model, memory: undefined, ...extra });
}

const routeTool = createInstructionsWorkflowTool(routePromptWorkflow);
const pollTool = createSimplifiedWorkflowTool(getNextInstructionsWorkflow);

/** What the poll answers with, as far as these tests read it. */
interface PollResponse {
  instructions: string;
  completedTaskResults?: { id: string; result: unknown }[];
  questionsForUser?: { id: string; question: string }[];
}

/** The openings a response has when it closes a request, and only then. */
const CLOSING_OPENINGS = [
  'All tasks have completed',
  'The request could not be completed',
  'Part of this request',
  'This request has finished',
  'He asked you to stop',
];

/** Says something to Jarvis, and does what he does with it: routes it. */
async function route(userQuery: string): Promise<void> {
  await executeTool(routeTool, { userQuery, async: false });
}

/** Polls, as Jarvis does, until the request is closed. */
async function closingReport(): Promise<PollResponse> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = (await executeTool(pollTool, {})) as PollResponse;
    if (CLOSING_OPENINGS.some((opening) => response.instructions.startsWith(opening))) {
      return response;
    }
  }

  throw new Error('The request was never closed');
}

/** Says something to Jarvis, and does what he does: routes it, then polls until the request is closed. */
async function say(userQuery: string): Promise<PollResponse> {
  await route(userQuery);
  return closingReport();
}

/** Keeps a photo that arrived this long ago. */
function photoSent(millisecondsAgo: number) {
  return keepPhoto(PHOTO, 'image/jpeg', Date.now() - millisecondsAgo);
}

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200 && !(await condition()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** What a poll of the session would say right now — which hands over whatever has landed. */
function pollNow() {
  return getRoutingRuntime().poll(DEFAULT_ROUTING_SESSION_ID);
}

/** Waits until the request has work outstanding, which a plan marks as soon as it is built. */
async function untilWorkIsUnderWay(): Promise<void> {
  await until(async () => (await pollNow()).inProgress.length > 0);
}

/** A promise that settles only when told to, and the way to tell it. */
function heldUntilReleased(): { held: Promise<void>; release: () => void } {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/** Every test through the runtime starts on a fresh one, and leaves none behind. */
function useFreshRoutingRuntime(): void {
  beforeEach(() => {
    resetRoutingRuntime();
    setRoutingClassifierForTest(undefined);
    setPollDeadlineForTest(1_000);
  });

  afterEach(() => {
    resetCompletionNotifierForTest();
    resetRoutingRuntime();
    setRoutingClassifierForTest(undefined);
    resetPollDeadlineForTest();
  });
}

describe('a waiting photo, as a request sir makes brings it up', () => {
  useFreshRoutingRuntime();

  it('is shown to the planner however recent, and not asked about inside the grace', async () => {
    const { plannerCalls } = await setUp();
    photoSent(0);

    const response = await say(WEATHER_REQUEST);

    expect(plannerCalls[plannerCalls.length - 1]?.transcript).toContain(
      'Photos the user has sent that nobody has looked at yet:\n- photo1, sent just now',
    );
    expect(response.instructions).toStartWith('All tasks have completed');
    expect(response.questionsForUser).toBeUndefined();
  }, 60_000);

  it('is brought up the next time sir talks to Jarvis once the grace is over, and only once', async () => {
    await setUp();
    photoSent(2 * 60_000);

    const next = await say(WEATHER_REQUEST);
    expect(next.completedTaskResults).toEqual([{ id: 'weather', result: WEATHER }]);
    expect(next.questionsForUser).toEqual([
      {
        id: 'photo1',
        question:
          'Sir sent you a photo 2 minutes ago (photo1) that nobody has looked at yet: ask him what he would like done with it.',
      },
    ]);
    expect(next.instructions).toStartWith('This request has finished, but work he started earlier, or a photo he sent');

    // Not after every request of the same conversation.
    const after = await say(WEATHER_REQUEST);
    expect(after.questionsForUser).toBeUndefined();
  }, 60_000);

  it('is let go of when sir wants nothing done with it, and that is not reported as a failure', async () => {
    await setUp();
    photoSent(2 * 60_000);
    await say(WEATHER_REQUEST);

    const reply = await say(DISMISSAL);

    expect(reply.instructions).toStartWith('All tasks have completed');
    expect(reply.questionsForUser).toBeUndefined();
    expect(photosWaiting()).toEqual([]);
  }, 60_000);

  it('is not asked about in the very reply that waves it away', async () => {
    // Dismissed before the reminders are taken, so a photo past its grace that sir waves away
    // before Jarvis ever asked is not brought up in the report on his waving it away.
    await setUp();
    photoSent(2 * 60_000);

    const reply = await say(DISMISSAL);

    expect(reply.instructions).toStartWith('All tasks have completed');
    expect(reply.questionsForUser).toBeUndefined();
    expect(photosWaiting()).toEqual([]);
  }, 60_000);

  it('keeps its reminder through a request sir is notified about, since nobody hears that report', async () => {
    let letTheWeatherAnswer = () => {};
    const weatherAnswers = new Promise<void>((resolve) => {
      letTheWeatherAnswer = resolve;
    });
    await setUp({ weatherAnswersOnceThisSettles: weatherAnswers });
    const notices: CompletionNotice[] = [];
    setCompletionNotifierForTest(async (notice) => {
      notices.push(notice);
    });
    photoSent(2 * 60_000);

    await executeTool(routeTool, { userQuery: WEATHER_REQUEST, async: false });
    let accepted: PollResponse | undefined;
    for (
      let attempt = 0;
      attempt < 10 && !accepted?.instructions.startsWith('The user will be notified');
      attempt += 1
    ) {
      accepted = (await executeTool(pollTool, { notifyWhenDone: true })) as PollResponse;
    }
    expect(accepted?.instructions).toStartWith('The user will be notified');

    letTheWeatherAnswer();
    await until(() => notices.length > 0);
    expect(notices).toHaveLength(1);
    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo1']);

    // The reminder was not spent on the notice, so the next request he hears brings it up.
    const next = await say(WEATHER_REQUEST);
    expect(next.questionsForUser?.map((question) => question.id)).toEqual(['photo1']);
  }, 60_000);
});

/**
 * A photo sir sent with nothing said: the phone tells the voice agent it has arrived, the agent
 * routes a look at it, and Jarvis says what it shows — and then, unlike at the end of any other
 * request, asks what sir would like done with it and waits for the answer.
 */
describe('a photo sent with nothing said, as the phone reports it', () => {
  useFreshRoutingRuntime();

  it('is looked at straight away, and Jarvis asks what sir would like done with it', async () => {
    const { readerCalls } = await setUp();
    photoSent(0);

    const reply = await say(barePhoto('photo1'));

    // The reader was shown the photo itself, and what the vision agent made of it is spoken first.
    expect(readerCalls).toHaveLength(1);
    expect(reply.completedTaskResults).toEqual([{ id: 'look', result: LOOK }]);
    expect(reply.questionsForUser).toEqual([
      {
        id: 'photo1',
        question: 'Now that you have told him what photo1 shows, ask him what he would like done with it.',
      },
    ]);
    // Asked last, and waited for: not the hang-up every other finished request ends on.
    expect(reply.instructions).toStartWith('Part of this request cannot go on until the user answers a question');
    expect(reply.instructions).toContain('as the last thing you say — and stop there to let him answer');
    expect(reply.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    // His answer names the photo, so it is done with that one.
    expect(reply.instructions).toContain('"(photo photo3)"');
    // Looked at, so it is not brought up again as a photo nobody has looked at.
    expect(photosWaiting()).toEqual([]);
  }, 60_000);

  it('is not asked about when its look failed, and waits to be brought up later instead', async () => {
    await setUp({ readerFails: true });
    photoSent(0);

    const reply = await say(barePhoto('photo1'));

    expect(reply.questionsForUser).toBeUndefined();
    expect(reply.instructions).not.toContain('what photo1 shows');
    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo1']);
  }, 60_000);

  it('is looked at without a question afterwards when sir said what he wanted before sending it', async () => {
    const { readerCalls } = await setUp();
    photoSent(0);

    const reply = await say(totalOfPhoto('photo1'));

    expect(readerCalls).toHaveLength(1);
    expect(reply.completedTaskResults).toEqual([{ id: 'total', result: LOOK }]);
    expect(reply.instructions).toStartWith('All tasks have completed');
    expect(reply.questionsForUser).toBeUndefined();
    expect(photosWaiting()).toEqual([]);
  }, 60_000);

  /**
   * "Nothing" is the likeliest answer to being asked about a photo. The look that let Jarvis describe
   * it marked it as looked at, so it is no longer waiting — and the reply that asked for nothing used
   * to plan nothing, and be reported to sir as a request no agent could handle.
   */
  it('is let go of when sir answers that he wants nothing done with it, which is not a failure', async () => {
    const { plannerCalls } = await setUp();
    photoSent(0);
    const asked = await say(barePhoto('photo1'));
    expect(asked.questionsForUser?.map((question) => question.id)).toEqual(['photo1']);

    const reply = await say("Answer to 'what would you like done with it?': nothing, never mind (photo photo1)");

    expect(plannerCalls[plannerCalls.length - 1]?.transcript).toContain(
      'Photos the request names, which have been looked at or dismissed already:\n- photo1, sent just now',
    );
    expect(reply.instructions).toStartWith('All tasks have completed');
    expect(reply.instructions).not.toContain('none of the specialized agents');
    expect(reply.questionsForUser).toBeUndefined();
    expect(findPhoto('photo1')?.dismissedAt).toBeNumber();
  }, 60_000);
});

/**
 * A photo he says is on its way. The voice agent is told to route nothing until it arrives, but one
 * that slips through planned nothing, and was reported to sir as a request no agent could handle —
 * closing on the hang-up just as he went quiet to take the shot.
 */
describe('a photo he says he is about to send, when the request reaches routing anyway', () => {
  useFreshRoutingRuntime();

  it('is waited for: Jarvis tells him to go ahead, and holds the line instead of hanging up', async () => {
    await setUp();

    const reply = await say(ANNOUNCEMENT);

    expect(reply.instructions).toStartWith('All tasks have completed');
    expect(reply.instructions).not.toContain('none of the specialized agents');
    expect(reply.instructions).toContain('go ahead with the camera button on his phone');
    expect(reply.instructions).toContain('call skip_turn');
    expect(reply.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
    expect(reply.questionsForUser).toBeUndefined();
  }, 60_000);

  it('is waited for once the rest of the request has been answered', async () => {
    await setUp();

    const reply = await say(`${ANNOUNCEMENT} ${WEATHER_REQUEST}`);

    expect(reply.completedTaskResults).toEqual([{ id: 'weather', result: WEATHER }]);
    expect(reply.instructions).toContain('Last of all, tell him in a few words to go ahead with the camera button');
    expect(reply.instructions).not.toContain(FINISHED_REQUEST_INSTRUCTIONS);
  }, 60_000);
});

/**
 * A look sir talks over. Its reading marked the photo as looked at, but what it read only reaches him
 * in the closing report of the request that looked — and a request he talks over is superseded, and
 * its report never read. Counted as looked at, the photo was never brought up either.
 */
describe('a look at a photo that sir talks over', () => {
  useFreshRoutingRuntime();

  it('is taken back, so the photo is brought up later instead of being lost', async () => {
    const vision = heldUntilReleased();
    const weather = heldUntilReleased();
    await setUp({
      visionAnswersAfterItsLookOnceThisSettles: vision.held,
      weatherAnswersOnceThisSettles: weather.held,
    });
    photoSent(2 * 60_000);

    await route(barePhoto('photo1'));
    await until(() => findPhoto('photo1')?.lookedAt !== undefined);
    expect(findPhoto('photo1')?.lookedAt).toBeNumber();

    // He speaks before Jarvis has said what it shows, and the new request supersedes the look's.
    await route(WEATHER_REQUEST);
    vision.release();
    await until(() => photosWaiting().length > 0);
    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo1']);

    weather.release();
    const reply = await closingReport();
    expect(reply.completedTaskResults).toEqual([{ id: 'weather', result: WEATHER }]);
    expect(reply.questionsForUser?.map((question) => question.id)).toEqual(['photo1']);
  }, 60_000);
});

/**
 * A stand-in for Jev, sure that every request relates to the one still running as `relation`, and of
 * nothing else a request could be settled on — so the planner decides everything but that.
 */
function classifierRelating(relation: RelationToRunningRequest): Classifier {
  const sureOf: Record<string, string> = { route: 'several', relationToRunningRequest: relation };
  return new Classifier({
    id: 'routingClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['choice', 'boolean'],
      doEvaluate: async ({ questions }) => ({
        answers: Object.fromEntries(
          Object.entries(questions).map(([questionId, question]) => [
            questionId,
            question.type === 'choice'
              ? sureChoice(Object.keys(question.criteria), sureOf[questionId])
              : { type: 'boolean' as const, probability: 0 },
          ]),
        ),
        warnings: [],
      }),
    },
  });
}

/** A choice all but certain of `wanted` when it is one of the choices, and of the first otherwise. */
function sureChoice(choices: string[], wanted: string | undefined) {
  const choice = wanted !== undefined && choices.includes(wanted) ? wanted : (choices[0] ?? '');
  const others = choices.length - 1;
  const sure = others === 0 ? 1 : 0.97;
  const probabilities = Object.fromEntries(
    choices.map((option) => [option, option === choice ? sure : (1 - sure) / others]),
  );
  return { type: 'choice' as const, choice, probabilities };
}

/**
 * Requests made while another is still running, which join it until the routing classifier says how
 * they relate to it (see `runJoinedRequest` in `controller.ts`). The weather is held back, so the
 * first request is still running when the second arrives.
 */
describe('a waiting photo, and a request joined to a running one', () => {
  useFreshRoutingRuntime();

  it('is let go of when he waves it away in words the classifier takes for stopping the running request', async () => {
    const weather = heldUntilReleased();
    await setUp({ weatherAnswersOnceThisSettles: weather.held });
    setRoutingClassifierForTest(classifierRelating('cancels'));
    photoSent(0);

    await route(WEATHER_REQUEST);
    await untilWorkIsUnderWay();
    await route('Never mind that photo, I was only testing (photo photo1)');
    await until(() => photosWaiting().length === 0);
    weather.release();
    const reply = await closingReport();

    expect(reply.instructions).toStartWith('He asked you to stop');
    expect(photosWaiting()).toEqual([]);
    expect(findPhoto('photo1')?.dismissedAt).toBeNumber();
  }, 60_000);

  it('keeps its reminder through a request he stopped, whose report says only that it was stopped', async () => {
    const weather = heldUntilReleased();
    await setUp({ weatherAnswersOnceThisSettles: weather.held });
    setRoutingClassifierForTest(classifierRelating('cancels'));
    photoSent(2 * 60_000);

    await route(WEATHER_REQUEST);
    await untilWorkIsUnderWay();
    await route('Stop, never mind.');
    await until(async () => (await pollNow()).conversationControl === 'cancelled');
    weather.release();
    const stopped = await closingReport();
    expect(stopped.instructions).toStartWith('He asked you to stop');
    expect(stopped.questionsForUser).toBeUndefined();

    // Not spent on a report that never mentioned it, so the next request he hears brings it up.
    const next = await say(WEATHER_REQUEST);
    expect(next.questionsForUser?.map((question) => question.id)).toEqual(['photo1']);
  }, 60_000);

  it('is still brought up when the other of two joined requests took its reminder first', async () => {
    const weather = heldUntilReleased();
    await setUp({ weatherAnswersOnceThisSettles: weather.held });
    setRoutingClassifierForTest(classifierRelating('adds'));
    photoSent(2 * 60_000);

    await route(WEATHER_REQUEST);
    await untilWorkIsUnderWay();
    await route(LIGHTS_REQUEST);
    // The lights finish first, and take the reminder as they do; the weather finishes after.
    await until(async () => (await pollNow()).landed.some((outcome) => outcome.taskId === 'lights'));
    weather.release();
    const reply = await closingReport();

    expect(reply.completedTaskResults).toEqual(
      expect.arrayContaining([
        { id: 'weather', result: WEATHER },
        { id: 'lights', result: LIGHTS },
      ]),
    );
    expect(reply.questionsForUser?.map((question) => question.id)).toEqual(['photo1']);
  }, 60_000);

  it('is let go of beside a running request, without changing how that request is answered', async () => {
    const weather = heldUntilReleased();
    await setUp({ weatherAnswersOnceThisSettles: weather.held });
    setRoutingClassifierForTest(classifierRelating('adds'));
    photoSent(0);

    await route(WEATHER_REQUEST);
    await untilWorkIsUnderWay();
    await route('And never mind that photo (photo photo1)');
    await until(() => photosWaiting().length === 0);
    weather.release();
    const reply = await closingReport();

    expect(reply.instructions).toStartWith('All tasks have completed');
    expect(reply.completedTaskResults).toEqual([{ id: 'weather', result: WEATHER }]);
    // The weather's own style — a lookup — not the command a dismissal is planned as.
    expect(reply.instructions).toContain('Give him the answer in one short sentence');
    expect(reply.instructions).not.toContain('"Done, sir." is enough');
    expect(photosWaiting()).toEqual([]);
  }, 60_000);
});
