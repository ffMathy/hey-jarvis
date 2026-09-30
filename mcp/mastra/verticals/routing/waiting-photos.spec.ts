/**
 * When a photo nobody has looked at is brought up, and what Jarvis is told to ask about it.
 *
 * The store's half — what counts as waiting, and when a photo stops — is `vision/photos.spec.ts`;
 * how a closing report carries these is `workflows.spec.ts`. This is the part in between: the grace
 * that spares the conversation that just sent a photo, and the reminder that is not repeated after
 * every request — and, at the end, the same through the routing runtime, from what sir says to the
 * report Jarvis is handed, since the wiring between the store and the report is two lines that no
 * test of either half would miss. Last of all, a photo sent with nothing said, from the message the
 * voice agent routes to the report that has Jarvis ask what sir would like done with it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { PHOTO_READER_AGENT_ID } from '../vision/agents.js';
import { forgetPhotos, KEEP_PHOTO_MS, keepPhoto, markPhotoLookedAt, photosWaiting } from '../vision/photos.js';
import { visionTools } from '../vision/tools.js';
import {
  type CompletionNotice,
  resetCompletionNotifierForTest,
  setCompletionNotifierForTest,
} from './completion-notice.js';
import { resetRoutingRuntime } from './controller.js';
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
const DISMISSAL = "Answer to 'what would you like done with the photo?': nothing, never mind (photo photo1)";

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
}) {
  return {
    text: JSON.stringify({ tasks: [], answers: [], dismissedPhotoIds: [], photosToAskAbout: [], ...fields }),
  };
}

/**
 * The planner: a weather task for the weather, the photo dismissed when sir waves it away, a look at
 * a photo he sent with nothing said — and Jarvis to ask about it — or at one he asked the total of,
 * and nothing any agent can do otherwise.
 */
function scriptedPlanner() {
  return createScriptedModel(({ transcript }) => {
    const listedPhotoId = transcript.match(/^- (photo\d+), sent /m)?.[1];

    if (listedPhotoId && transcript.includes(DISMISSAL)) {
      return plan({ responseStyle: 'command', dismissedPhotoIds: [listedPhotoId] });
    }

    if (transcript.includes(WEATHER_REQUEST)) {
      return plan({
        responseStyle: 'lookup',
        tasks: [{ id: 'weather', agentId: 'weather', prompt: WEATHER_REQUEST, needs: '' }],
      });
    }

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

    return plan({ responseStyle: 'conversation' });
  });
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

/** How the stand-ins for the models are set up for one test. */
interface SetUpOptions {
  /** Holds the weather agent's answer back until this settles. */
  weatherAnswersOnceThisSettles?: Promise<void>;
  /** Makes the photo reader fail, as an unreachable model would. */
  readerFails?: boolean;
}

/**
 * Registers the routing workflows, the planner, a weather agent, and the vision agent with the photo
 * reader behind it, and hands back the planner's and the reader's calls.
 */
async function setUp({ weatherAnswersOnceThisSettles = Promise.resolve(), readerFails = false }: SetUpOptions = {}) {
  const planner = scriptedPlanner();
  const weather = createScriptedModel(() => ({ text: WEATHER }));
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
      vision: await scriptedAgent('vision', scriptedVision().model, { tools: visionTools }),
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
];

/** Says something to Jarvis, and does what he does: polls until the request is closed. */
async function say(userQuery: string): Promise<PollResponse> {
  await executeTool(routeTool, { userQuery, async: false });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = (await executeTool(pollTool, {})) as PollResponse;
    if (CLOSING_OPENINGS.some((opening) => response.instructions.startsWith(opening))) {
      return response;
    }
  }

  throw new Error(`"${userQuery}" was never closed`);
}

/** Keeps a photo that arrived this long ago. */
function photoSent(millisecondsAgo: number) {
  return keepPhoto(PHOTO, 'image/jpeg', Date.now() - millisecondsAgo);
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Every test through the runtime starts on a fresh one, and leaves none behind. */
function useFreshRoutingRuntime(): void {
  beforeEach(() => {
    resetRoutingRuntime();
    setPollDeadlineForTest(1_000);
  });

  afterEach(() => {
    resetCompletionNotifierForTest();
    resetRoutingRuntime();
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
});
