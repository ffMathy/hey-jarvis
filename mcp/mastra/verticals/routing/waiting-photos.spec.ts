/**
 * When a photo nobody has looked at is brought up, and what Jarvis is told to ask about it.
 *
 * The store's half — what counts as waiting, and when a photo stops — is `vision/photos.spec.ts`;
 * how a closing report carries these is `workflows.spec.ts`. This is the part in between: the grace
 * that spares the conversation that just sent a photo, and the reminder that is not repeated after
 * every request — and, at the end, the same through the routing runtime, from what sir says to the
 * report Jarvis is handed, since the wiring between the store and the report is two lines that no
 * test of either half would miss.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { forgetPhotos, KEEP_PHOTO_MS, keepPhoto, markPhotoLookedAt, photosWaiting } from '../vision/photos.js';
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
  getNextInstructionsWorkflow,
  resetPollDeadlineForTest,
  routePromptWorkflow,
  setPollDeadlineForTest,
} from './workflows.js';

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** When the photos in these tests arrive. */
const SENT_AT = 1_000_000;

beforeEach(() => {
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

/**
 * The same, through the routing runtime: what sir says goes in through `routePromptWorkflow`, and
 * what Jarvis is handed comes out of `getNextInstructionsWorkflow`, as it does on a call. Every model
 * is scripted, so what is tested is the plumbing — that the planner is shown the store's waiting
 * photos, and that only a report sir will hear takes a reminder.
 */
describe('a waiting photo, as a request sir makes brings it up', () => {
  const WEATHER_REQUEST = 'What is the weather?';
  const WEATHER = 'It is 8 degrees.';
  const DISMISSAL = "Answer to 'what would you like done with the photo?': nothing, never mind (photo photo1)";

  /** A few bytes stand in for a JPEG: nothing here looks at it. */
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

  /**
   * The planner: a weather task for the weather, the photo dismissed when sir waves it away, and
   * nothing any agent can do otherwise.
   */
  function scriptedPlanner() {
    return createScriptedModel(({ transcript }) => {
      const listedPhotoId = transcript.match(/^- (photo\d+), sent /m)?.[1];

      if (listedPhotoId && transcript.includes(DISMISSAL)) {
        return {
          text: JSON.stringify({
            responseStyle: 'command',
            tasks: [],
            answers: [],
            dismissedPhotoIds: [listedPhotoId],
          }),
        };
      }

      if (transcript.includes(WEATHER_REQUEST)) {
        return {
          text: JSON.stringify({
            responseStyle: 'lookup',
            tasks: [{ id: 'weather', agentId: 'weather', prompt: WEATHER_REQUEST, needs: '' }],
            answers: [],
            dismissedPhotoIds: [],
          }),
        };
      }

      return { text: JSON.stringify({ responseStyle: 'conversation', tasks: [], answers: [], dismissedPhotoIds: [] }) };
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

  /** Registers the routing workflows, the planner and a weather agent, and hands back the planner's calls. */
  async function setUp(weatherAnswersOnceThisSettles: Promise<void> = Promise.resolve()) {
    const planner = scriptedPlanner();
    const weather = createScriptedModel(() => ({ text: WEATHER }));

    new Mastra({
      storage: new InMemoryStore(),
      logger: false,
      workflows: { routePromptWorkflow, getNextInstructionsWorkflow },
      agents: {
        [PLANNER_AGENT_ID]: await createAgent({
          id: PLANNER_AGENT_ID,
          name: PLANNER_AGENT_ID,
          instructions: 'You plan.',
          model: planner.model,
          memory: undefined,
        }),
        weather: await createAgent({
          id: 'weather',
          name: 'weather',
          instructions: 'You tell the weather.',
          model: heldBack(weather.model, weatherAnswersOnceThisSettles),
          memory: undefined,
        }),
      },
    });

    return planner.calls;
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
    return keepPhoto(JPEG, 'image/jpeg', Date.now() - millisecondsAgo);
  }

  async function until(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  beforeEach(() => {
    resetRoutingRuntime();
    setPollDeadlineForTest(1_000);
  });

  afterEach(() => {
    resetCompletionNotifierForTest();
    resetRoutingRuntime();
    resetPollDeadlineForTest();
  });

  it('is shown to the planner however recent, and not asked about inside the grace', async () => {
    const plannerCalls = await setUp();
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
    await setUp(weatherAnswers);
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
