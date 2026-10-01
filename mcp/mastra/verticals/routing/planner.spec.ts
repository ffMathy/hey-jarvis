/**
 * The planner's labelling of how a request should be answered, and what it is shown of the photos
 * nobody has looked at yet.
 *
 * What the model does with the instructions is the LLM eval's to judge; what is pinned here is the
 * contract around it: that every plan must carry a style, that only the four known ones are
 * accepted, and that the instructions describe each of them — and that waiting photos reach the
 * planner by id, with the rules for what to do about them, including letting one be, asking sir
 * about one he sent with nothing said, and waiting for one he says is on its way.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { forgetPhotos, keepPhoto, markPhotoLookedAt, photosWaiting } from '../vision/photos.js';
import { routingQuestions } from './classifier.js';
import {
  decisionFromClassification,
  getRoutableAgentIds,
  PLANNER_AGENT_ID,
  planDelegations,
  plannerInstructions,
  plannerPrompt,
  planSchema,
  preferFastPlan,
  RESPONSE_STYLES,
  type RoutingDecision,
} from './planner.js';
import type { OpenQuestion } from './questions.js';

/** Everything a plan leaves empty, as the planner has to write it out. */
const NOTHING_PLANNED = { tasks: [], answers: [], dismissedPhotoIds: [], photosToAskAbout: [], awaitsPhoto: false };

describe('responseStyle', () => {
  it('is required on every plan, so a request is never answered in no particular way', () => {
    expect(planSchema.safeParse(NOTHING_PLANNED).success).toBe(false);
    expect(planSchema.safeParse({ responseStyle: 'command', ...NOTHING_PLANNED }).success).toBe(true);
  });

  it('accepts only the styles the closing instructions know how to speak', () => {
    expect(planSchema.safeParse({ responseStyle: 'monologue', ...NOTHING_PLANNED }).success).toBe(false);
  });

  it('is explained to the planner, one style at a time', () => {
    const instructions = plannerInstructions([]);

    for (const style of RESPONSE_STYLES) {
      expect(instructions).toContain(`\`${style}\``);
    }
    expect(instructions).toContain('where the value of the request lands');
  });
});

/**
 * Photos sir sent that nobody has looked at yet (see `waiting-photos.ts`). A reply about one — "add
 * everything on it to the shopping list" — is a request, and the planner can only plan it as work on
 * that photo if it is told the photo is there, and by which id.
 */
describe('photos nobody has looked at yet', () => {
  const NOW = 10_000_000;
  const WAITING_QUESTION: OpenQuestion = {
    id: 'q1',
    taskId: 'feature',
    agentId: 'coding',
    question: 'Email, or a push notification?',
    deliverAnswer: async () => 'Passed on.',
  };

  it('are listed after the request, each by id and how long ago it was sent', () => {
    const prompt = plannerPrompt(
      'Add everything on it to the shopping list.',
      [],
      [
        { photoId: 'photo2', keptAt: NOW - 12 * 60_000 },
        { photoId: 'photo3', keptAt: NOW - 4 * 60_000 },
      ],
      [],
      NOW,
    );

    expect(prompt).toBe(
      'The request:\nAdd everything on it to the shopping list.\n\n' +
        'Photos the user has sent that nobody has looked at yet:\n' +
        '- photo2, sent 12 minutes ago\n' +
        '- photo3, sent 4 minutes ago',
    );
  });

  it('are listed after the waiting questions when there are both', () => {
    const prompt = plannerPrompt(
      'Push, please.',
      [WAITING_QUESTION],
      [{ photoId: 'photo3', keptAt: NOW - 30_000 }],
      [],
      NOW,
    );

    expect(prompt).toBe(
      'The request:\nPush, please.\n\n' +
        "Questions waiting for the user's answer:\n" +
        '- id "q1", asked by coding: Email, or a push notification?\n\n' +
        'Photos the user has sent that nobody has looked at yet:\n' +
        '- photo3, sent just now',
    );
  });

  it('leave the prompt as the request alone when there are none', () => {
    expect(plannerPrompt('What is the weather?', [], [], [], NOW)).toBe('What is the weather?');
  });

  it('are explained to the planner: work on the photo, never an answer, and left alone otherwise', () => {
    const instructions = plannerInstructions([]);

    expect(instructions).toContain('# Photos');
    expect(instructions).toContain('including one he has only just sent');
    expect(instructions).toContain('plan it as ordinary tasks');
    expect(instructions).toContain('"(photo photo3)"');
    expect(instructions).toContain('Any task that acts on what the photo shows needs that task');
    expect(instructions).toContain('the one sent last when there are several');
    expect(instructions).toContain('never put one in `answers`');
    expect(instructions).toContain('write no task for a photo the request does not mention');
  });
});

/** A planner on a scripted model that replies with this plan whatever it is asked, and what it was asked. */
async function plannerHearing(plan: object) {
  const scripted = createScriptedModel(() => ({ text: JSON.stringify(plan) }));
  const planner = await createAgent({
    id: PLANNER_AGENT_ID,
    name: PLANNER_AGENT_ID,
    instructions: 'You plan.',
    model: scripted.model,
    memory: undefined,
  });
  return { planner, calls: scripted.calls };
}

/** A planner on a scripted model that replies with this plan, whatever it is asked. */
async function plannerReplying(plan: object) {
  return (await plannerHearing(plan)).planner;
}

/**
 * "Nothing, never mind" about a waiting photo. It is not work, and it is not an answer — nothing is
 * suspended on a photo — so without a place of its own in the plan it came back empty, and an empty
 * plan is reported to sir as a request no agent could handle.
 */
describe('a reply that he wants nothing done with a photo', () => {
  it('has a place in every plan, empty when there is none, so the model never leaves it out', () => {
    expect(
      planSchema.safeParse({
        responseStyle: 'command',
        tasks: [],
        answers: [],
        photosToAskAbout: [],
        awaitsPhoto: false,
      }).success,
    ).toBe(false);
  });

  it('is explained to the planner: dismiss the photo, write no task for it, and answer as a command', () => {
    const instructions = plannerInstructions([]);

    expect(instructions).toContain('put its id in `dismissedPhotoIds` and write no task for it');
    expect(instructions).toContain('he is not asked about it again');
    expect(instructions).toContain('A request that only dismisses photos is a `command`');
  });

  it('comes back for the photos the planner was shown, once each, and never as an answer', async () => {
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'command',
      answers: [{ questionId: 'photo3', answer: 'Nothing, never mind.' }],
      dismissedPhotoIds: ['photo3', 'photo3', 'photo9'],
    });

    const plan = await planDelegations(
      planner,
      "Answer to 'what would you like done with the photo?': nothing, never mind (photo photo3)",
      [],
      [{ photoId: 'photo3', keptAt: Date.now() - 4 * 60_000 }],
    );

    expect(plan.dismissedPhotoIds).toEqual(['photo3']);
    expect(plan.answers).toEqual([]);
    expect(plan.chains).toEqual([]);
    expect(plan.responseStyle).toBe('command');
  });

  it('dismisses nothing when no photo was shown', async () => {
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'conversation',
      dismissedPhotoIds: ['photo1'],
    });

    expect((await planDelegations(planner, 'Never mind.')).dismissedPhotoIds).toEqual([]);
  });
});

/**
 * The photo Jarvis has just described and asked about. The look that let him describe it marked it
 * as looked at, so it is no longer waiting — and without being shown it, the planner could not dismiss
 * it when sir said he wants nothing done with it, and his "nothing" was reported to him as a request no
 * agent could handle.
 */
describe('a photo the request names that has been looked at already', () => {
  const NOW = 10_000_000;
  const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const NOTHING = "Answer to 'what would you like done with it?': nothing, never mind (photo photo1)";
  const HEADING = 'Photos the request names, which have been looked at or dismissed already:';

  /** Photo1, looked at a moment after it arrived, as the look Jarvis described leaves it. */
  function lookedAtPhoto(): void {
    keepPhoto(PHOTO, 'image/jpeg');
    markPhotoLookedAt('photo1');
  }

  beforeEach(() => {
    forgetPhotos();
  });

  // The store is the process's: a photo left behind would be listed in another file's requests.
  afterEach(() => {
    forgetPhotos();
  });

  it('is listed apart from the waiting ones, by id and how long ago it was sent', () => {
    expect(plannerPrompt(NOTHING, [], [], [{ photoId: 'photo1', keptAt: NOW - 2 * 60_000 }], NOW)).toBe(
      `The request:\n${NOTHING}\n\n${HEADING}\n- photo1, sent 2 minutes ago`,
    );
  });

  it('is listed after the waiting ones when there are both', () => {
    expect(
      plannerPrompt(
        NOTHING,
        [],
        [{ photoId: 'photo2', keptAt: NOW - 30_000 }],
        [{ photoId: 'photo1', keptAt: NOW - 2 * 60_000 }],
        NOW,
      ),
    ).toBe(
      `The request:\n${NOTHING}\n\n` +
        'Photos the user has sent that nobody has looked at yet:\n- photo2, sent just now\n\n' +
        `${HEADING}\n- photo1, sent 2 minutes ago`,
    );
  });

  it('is explained to the planner: his wanting nothing done with it dismisses it too', () => {
    const instructions = plannerInstructions([]);

    expect(instructions).toContain('A photo the request names by its tag that has been looked at or dismissed');
    expect(instructions).toContain(
      'That includes his reply about the photo the request names when he was just asked what to do with it — "Answer to \'what would you like done with it?\': nothing (photo photo3)"',
    );
    expect(planSchema.shape.dismissedPhotoIds.description).toContain(
      'one the request names that he was just asked about',
    );
  });

  it('is shown to the planner, and dismissed when he wants nothing done with it', async () => {
    lookedAtPhoto();
    const { planner, calls } = await plannerHearing({
      ...NOTHING_PLANNED,
      responseStyle: 'command',
      dismissedPhotoIds: ['photo1'],
    });

    const plan = await planDelegations(planner, NOTHING, [], photosWaiting());

    expect(calls[0]?.transcript).toContain(`${HEADING}\n- photo1, sent just now`);
    expect(plan.dismissedPhotoIds).toEqual(['photo1']);
    expect(plan.chains).toEqual([]);
  });

  it('is found however the tag writes its id, and listed once however often it is named', async () => {
    lookedAtPhoto();
    const { planner, calls } = await plannerHearing({ ...NOTHING_PLANNED, responseStyle: 'command' });

    await planDelegations(planner, 'Nothing for (photo Photo1), and nothing for (photo photo1) either');

    expect(calls[0]?.transcript).toContain(`${HEADING}\n- photo1, sent just now`);
    expect(calls[0]?.transcript.match(/- photo1, sent/g)).toHaveLength(1);
  });

  it('is not listed twice when it is still waiting', async () => {
    keepPhoto(PHOTO, 'image/jpeg');
    const { planner, calls } = await plannerHearing({ ...NOTHING_PLANNED, responseStyle: 'command' });

    await planDelegations(planner, NOTHING, [], photosWaiting());

    expect(calls[0]?.transcript).not.toContain(HEADING);
    expect(calls[0]?.transcript).toContain('Photos the user has sent that nobody has looked at yet:\n- photo1');
  });

  it('is never asked about as one sent with nothing said: he has been told what it shows', async () => {
    lookedAtPhoto();
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'lookup',
      photosToAskAbout: ['photo1'],
    });

    expect((await planDelegations(planner, NOTHING)).photosToAskAbout).toEqual([]);
  });

  it('is not one the store has let go of', async () => {
    const { planner, calls } = await plannerHearing({
      ...NOTHING_PLANNED,
      responseStyle: 'command',
      dismissedPhotoIds: ['photo1'],
    });

    const plan = await planDelegations(planner, NOTHING);

    expect(calls[0]?.transcript).not.toContain(HEADING);
    expect(plan.dismissedPhotoIds).toEqual([]);
  });

  it('is never the latest photo standing in for a tag that names none', async () => {
    lookedAtPhoto();
    const { planner, calls } = await plannerHearing({
      ...NOTHING_PLANNED,
      responseStyle: 'command',
      dismissedPhotoIds: ['photo1'],
    });

    const plan = await planDelegations(planner, 'Nothing, never mind (photo __)');

    expect(calls[0]?.transcript).not.toContain(HEADING);
    expect(plan.dismissedPhotoIds).toEqual([]);
  });
});

/**
 * A photo sir sent with nothing said. The phone tells the voice agent a photo has arrived, and with
 * nothing to go on the agent routes a look at it; Jarvis then says what it shows and asks sir what
 * he would like done with it — which a finished request otherwise forbids — so the plan has to say
 * which photos he is to ask about (see `buildClosingReport` in `workflows.ts`).
 */
describe('a photo he sent without saying what he wants', () => {
  const BARE_PHOTO = 'He sent a photo without saying what he wants: look at it and say what it shows (photo photo3)';

  /** A look at the photo, as the planner is told to plan one. */
  const LOOK = {
    id: 'look',
    agentId: 'vision',
    prompt: 'Say what photo3 shows and what could be done with it (photo photo3).',
    needs: '',
  };

  it('has a place in every plan, empty when there is none, so the model never leaves it out', () => {
    expect(
      planSchema.safeParse({
        responseStyle: 'lookup',
        tasks: [],
        answers: [],
        dismissedPhotoIds: [],
        awaitsPhoto: false,
      }).success,
    ).toBe(false);
  });

  it('is explained to the planner: look at it, say what could be done with it, and let Jarvis ask', () => {
    const instructions = plannerInstructions([]);

    expect(instructions).toContain('the camera button on his phone');
    expect(instructions).toContain(`"${BARE_PHOTO}"`);
    expect(instructions).toContain(
      'plan one `vision` task that looks at it and says what it shows and what could be done with it',
    );
    expect(instructions).toContain('Put its id in `photosToAskAbout`');
    expect(instructions).toContain('Plan nothing else for it: what to do with it is his to say');
    // A photo he has said what to do with needs no question afterwards.
    expect(instructions).toContain('Leave `photosToAskAbout` empty: he has said what he wants');
    expect(instructions).toContain('a photo he sent without saying what he wants is a `lookup`');
  });

  it('comes back for the photos the planner was shown, once each, beside the look', async () => {
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'lookup',
      tasks: [LOOK],
      photosToAskAbout: ['photo3', 'photo3', 'photo9'],
    });

    const plan = await planDelegations(planner, BARE_PHOTO, [], [{ photoId: 'photo3', keptAt: Date.now() - 2_000 }]);

    expect(plan.photosToAskAbout).toEqual(['photo3']);
    expect(plan.chains.flatMap((chain) => chain.delegations.map((delegation) => delegation.agentId))).toEqual([
      'vision',
    ]);
    expect(plan.responseStyle).toBe('lookup');
  });

  it('is never one he has just said he wants nothing done with', async () => {
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'command',
      dismissedPhotoIds: ['photo3'],
      photosToAskAbout: ['photo3'],
    });

    const plan = await planDelegations(
      planner,
      'Never mind that photo (photo photo3)',
      [],
      [{ photoId: 'photo3', keptAt: Date.now() - 2_000 }],
    );

    expect(plan.dismissedPhotoIds).toEqual(['photo3']);
    expect(plan.photosToAskAbout).toEqual([]);
  });

  it('asks about nothing when no photo was shown', async () => {
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'lookup',
      tasks: [LOOK],
      photosToAskAbout: ['photo3'],
    });

    expect((await planDelegations(planner, BARE_PHOTO)).photosToAskAbout).toEqual([]);
  });
});

/**
 * A photo he says is on its way — "I'll send you a receipt" — that has not arrived. The voice agent is
 * told to route nothing until it does, but a request that slips through planned nothing, and an empty
 * plan was reported to sir as a request no agent could handle, closing on the hang-up just as he went
 * quiet to take the shot. The plan says so instead, and the closing report has Jarvis wait for it (see
 * `buildClosingReport` in `workflows.ts`).
 */
describe('a photo he says he is about to send', () => {
  const ANNOUNCED = "I'll send you a photo of a receipt in a moment";

  it('has a place in every plan, false when there is none, so the model never leaves it out', () => {
    expect(
      planSchema.safeParse({
        responseStyle: 'command',
        tasks: [],
        answers: [],
        dismissedPhotoIds: [],
        photosToAskAbout: [],
      }).success,
    ).toBe(false);
    expect(planSchema.shape.awaitsPhoto.description).toBe(
      'True only when the request says he is about to send or show a photo that has not arrived yet',
    );
  });

  it('is explained to the planner: plan nothing for it, say it is coming, and plan the rest as usual', () => {
    const instructions = plannerInstructions([]);

    expect(instructions).toContain(
      'A photo he says he is about to send — "I\'ll send you a receipt" — has not arrived: plan nothing for it',
    );
    expect(instructions).toContain('nothing for what he wants done with it, which comes back with the photo');
    expect(instructions).toContain('Set `awaitsPhoto`, and Jarvis tells him to go ahead with the camera button');
    expect(instructions).toContain('Plan anything else the request asks for as usual');
    expect(instructions).toContain('always for a photo that has already arrived');
    expect(instructions).toContain('and so is one that only says a photo is on its way');
  });

  it('comes back on the decision, with nothing planned for it', async () => {
    const planner = await plannerReplying({ ...NOTHING_PLANNED, responseStyle: 'command', awaitsPhoto: true });

    const plan = await planDelegations(planner, ANNOUNCED);

    expect(plan.awaitsPhoto).toBe(true);
    expect(plan.chains).toEqual([]);
  });

  it('comes back beside the rest of the request', async () => {
    const planner = await plannerReplying({
      ...NOTHING_PLANNED,
      responseStyle: 'lookup',
      tasks: [{ id: 'weather', agentId: 'weather', prompt: 'What is the weather?', needs: '' }],
      awaitsPhoto: true,
    });

    const plan = await planDelegations(planner, `${ANNOUNCED} — and what is the weather?`);

    expect(plan.awaitsPhoto).toBe(true);
    expect(plan.chains.flatMap((chain) => chain.delegations.map((delegation) => delegation.agentId))).toEqual([
      'weather',
    ]);
  });

  it('is left off a decision that awaits nothing', async () => {
    const planner = await plannerReplying({ ...NOTHING_PLANNED, responseStyle: 'conversation' });

    expect(await planDelegations(planner, 'Never mind.')).not.toHaveProperty('awaitsPhoto');
  });
});

/**
 * The routing classifier is never shown the photos, so a request about one is the planner's to
 * decide: a fast route would hand an agent sir's words with no photo to go with them.
 *
 * The planner here fails, which makes the race decided: a fast plan wins even over a planner that
 * has failed (see `preferFastPlan`), so a failure that stands means the classifier's route was
 * never taken.
 */
describe('a photo, with the routing classifier sure of a fast route', () => {
  const WAITING = [{ photoId: 'photo3', keptAt: Date.now() - 2_000 }];
  const PLANNER_ERROR = 'Structured output validation failed';

  /** A distribution over every choice, as a provider has to answer one, all but sure of `sureOf`. */
  function sureDistribution(sureOf: string, choices: readonly string[]): Record<string, number> {
    const rest = 0.03 / (choices.length - 1);
    return Object.fromEntries(choices.map((choice) => [choice, choice === sureOf ? 0.97 : rest]));
  }

  /**
   * A classifier sure of the one route it was told to be sure of, and how often it was asked. Its
   * route is the only answer it gives, so it is sure of nothing else a request could settle on.
   */
  async function classifierSureOf(route: string) {
    const agents = [...(await getRoutableAgentIds())].map((id) => ({ id, description: '' }));
    const routes = Object.keys(
      routingQuestions({ agents, openQuestions: [], services: [], domains: [], lookups: [] }).route.criteria,
    );
    let evaluations = 0;
    const classifier = new Classifier({
      id: 'routingClassifier',
      model: {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId: 'jev-fake',
        supportedQuestionTypes: ['choice', 'boolean'],
        doEvaluate: async () => {
          evaluations += 1;
          return {
            answers: {
              route: { type: 'choice', choice: route, probabilities: sureDistribution(route, routes) },
              responseStyle: {
                type: 'choice',
                choice: 'command',
                probabilities: sureDistribution('command', RESPONSE_STYLES),
              },
            },
            warnings: [],
          };
        },
      },
    });
    return { classifier, evaluations: () => evaluations };
  }

  it('takes the fast route when no photo is in play, even over a planner that failed', async () => {
    const { classifier } = await classifierSureOf('weather');

    const decision = await planDelegations(
      await plannerReplying({ nothing: 'like a plan' }),
      'What is the weather like?',
      [],
      [],
      undefined,
      classifier,
    );

    expect(decision.chains.flatMap((chain) => chain.delegations.map((delegation) => delegation.agentId))).toEqual([
      'weather',
    ]);
  });

  it('leaves the request to the planner while a photo is waiting', async () => {
    const { classifier, evaluations } = await classifierSureOf('weather');

    await expect(
      planDelegations(
        await plannerReplying({ nothing: 'like a plan' }),
        'Add everything on it to the shopping list.',
        [],
        WAITING,
        undefined,
        classifier,
      ),
    ).rejects.toThrow(PLANNER_ERROR);
    // It was asked, and was as sure as in the request above: its route was passed over, not missing.
    expect(evaluations()).toBe(1);
  });

  it('leaves the request to the planner when it names a photo, even one no longer waiting', async () => {
    const { classifier, evaluations } = await classifierSureOf('weather');

    await expect(
      planDelegations(
        await plannerReplying({ nothing: 'like a plan' }),
        'What was the total on it? (photo photo3)',
        [],
        [],
        undefined,
        classifier,
      ),
    ).rejects.toThrow(PLANNER_ERROR);
    expect(evaluations()).toBe(1);
  });

  it('still lets a goodbye end the call, leaving the photo waiting for next time', async () => {
    const { classifier } = await classifierSureOf('endCall');

    const decision = await planDelegations(
      await plannerReplying({ nothing: 'like a plan' }),
      'That will be all.',
      [],
      WAITING,
      undefined,
      classifier,
    );

    expect(decision.endsCall).toBe(true);
    expect(decision.dismissedPhotoIds).toBeUndefined();
  });
});

describe('preferFastPlan', () => {
  const fromPlanner: RoutingDecision = { chains: [], answers: [], responseStyle: 'briefing' };
  const fromClassifier: RoutingDecision = { chains: [], answers: [], responseStyle: 'command' };

  /** A promise that never settles, standing in for a call still in flight. */
  function pending<T>(): Promise<T> {
    return new Promise<T>(() => {});
  }

  it('takes the fast plan without waiting for the planner', async () => {
    expect(await preferFastPlan(pending(), Promise.resolve(fromClassifier))).toBe(fromClassifier);
  });

  it('waits for the planner when the classifier declines', async () => {
    expect(await preferFastPlan(Promise.resolve(fromPlanner), Promise.resolve(undefined))).toBe(fromPlanner);
  });

  it('takes a planner that answers first without waiting for the classifier', async () => {
    expect(await preferFastPlan(Promise.resolve(fromPlanner), pending())).toBe(fromPlanner);
  });

  it('survives a failed planner when the classifier is sure', async () => {
    expect(await preferFastPlan(Promise.reject(new Error('planner down')), Promise.resolve(fromClassifier))).toBe(
      fromClassifier,
    );
  });

  it('fails with the planner when the classifier declines too', async () => {
    await expect(preferFastPlan(Promise.reject(new Error('planner down')), Promise.resolve(undefined))).rejects.toThrow(
      'planner down',
    );
  });
});

describe('decisionFromClassification', () => {
  it("carries an answer back in the user's own words, with nothing else to run", async () => {
    expect(
      await decisionFromClassification({ responseStyle: 'command', answeredQuestionId: 'q1' }, 'push, please'),
    ).toEqual({ chains: [], answers: [{ questionId: 'q1', answer: 'push, please' }], responseStyle: 'command' });
  });

  it('runs nothing for a goodbye', async () => {
    expect(
      await decisionFromClassification({ responseStyle: 'conversation', endsCall: true }, 'that will be all'),
    ).toEqual({ chains: [], answers: [], responseStyle: 'conversation', endsCall: true });
  });

  it('runs nothing for a request that only stops the running one', async () => {
    expect(
      await decisionFromClassification(
        { responseStyle: 'conversation', relationToRunningRequest: 'cancels' },
        'never mind',
      ),
    ).toEqual({ chains: [], answers: [], responseStyle: 'command', relationToRunningRequest: 'cancels' });
  });

  it('leaves the request to the planner when the classifier settled nothing', async () => {
    expect(
      await decisionFromClassification({ responseStyle: 'briefing', relationToRunningRequest: 'adds' }, 'and the news'),
    ).toBeUndefined();
  });
});
