/**
 * The planner's labelling of how a request should be answered, and what it is shown of the photos
 * nobody has looked at yet.
 *
 * What the model does with the instructions is the LLM eval's to judge; what is pinned here is the
 * contract around it: that every plan must carry a style, that only the four known ones are
 * accepted, and that the instructions describe each of them — and that waiting photos reach the
 * planner by id, with the rules for what to do about them, including letting one be, and asking sir
 * about one he sent with nothing said.
 */

import { describe, expect, it } from 'bun:test';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import {
  PLANNER_AGENT_ID,
  planDelegations,
  plannerInstructions,
  plannerPrompt,
  planSchema,
  RESPONSE_STYLES,
} from './planner.js';
import type { OpenQuestion } from './questions.js';

describe('responseStyle', () => {
  it('is required on every plan, so a request is never answered in no particular way', () => {
    expect(planSchema.safeParse({ tasks: [], answers: [], dismissedPhotoIds: [], photosToAskAbout: [] }).success).toBe(
      false,
    );
    expect(
      planSchema.safeParse({
        responseStyle: 'command',
        tasks: [],
        answers: [],
        dismissedPhotoIds: [],
        photosToAskAbout: [],
      }).success,
    ).toBe(true);
  });

  it('accepts only the styles the closing instructions know how to speak', () => {
    expect(
      planSchema.safeParse({
        responseStyle: 'monologue',
        tasks: [],
        answers: [],
        dismissedPhotoIds: [],
        photosToAskAbout: [],
      }).success,
    ).toBe(false);
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
    expect(plannerPrompt('What is the weather?', [], [], NOW)).toBe('What is the weather?');
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

/** A planner on a scripted model that replies with this plan, whatever it is asked. */
async function plannerReplying(plan: object) {
  const scripted = createScriptedModel(() => ({ text: JSON.stringify(plan) }));
  return createAgent({
    id: PLANNER_AGENT_ID,
    name: PLANNER_AGENT_ID,
    instructions: 'You plan.',
    model: scripted.model,
    memory: undefined,
  });
}

/**
 * "Nothing, never mind" about a waiting photo. It is not work, and it is not an answer — nothing is
 * suspended on a photo — so without a place of its own in the plan it came back empty, and an empty
 * plan is reported to sir as a request no agent could handle.
 */
describe('a reply that he wants nothing done with a photo', () => {
  it('has a place in every plan, empty when there is none, so the model never leaves it out', () => {
    expect(
      planSchema.safeParse({ responseStyle: 'command', tasks: [], answers: [], photosToAskAbout: [] }).success,
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
      responseStyle: 'command',
      tasks: [],
      answers: [{ questionId: 'photo3', answer: 'Nothing, never mind.' }],
      dismissedPhotoIds: ['photo3', 'photo3', 'photo9'],
      photosToAskAbout: [],
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
      responseStyle: 'conversation',
      tasks: [],
      answers: [],
      dismissedPhotoIds: ['photo1'],
      photosToAskAbout: [],
    });

    expect((await planDelegations(planner, 'Never mind.')).dismissedPhotoIds).toEqual([]);
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
      planSchema.safeParse({ responseStyle: 'lookup', tasks: [], answers: [], dismissedPhotoIds: [] }).success,
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

  it('is not planned for before it arrives', () => {
    expect(plannerInstructions([])).toContain(
      'A photo he says he is about to send — "I\'ll send you a receipt" — has not arrived: plan nothing for it',
    );
  });

  it('comes back for the photos the planner was shown, once each, beside the look', async () => {
    const planner = await plannerReplying({
      responseStyle: 'lookup',
      tasks: [LOOK],
      answers: [],
      dismissedPhotoIds: [],
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
      responseStyle: 'command',
      tasks: [],
      answers: [],
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
      responseStyle: 'lookup',
      tasks: [LOOK],
      answers: [],
      dismissedPhotoIds: [],
      photosToAskAbout: ['photo3'],
    });

    expect((await planDelegations(planner, BARE_PHOTO)).photosToAskAbout).toEqual([]);
  });
});
