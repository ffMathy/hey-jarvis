/**
 * The planner's labelling of how a request should be answered, and what it is shown of the photos
 * nobody has looked at yet.
 *
 * What the model does with the instructions is the LLM eval's to judge; what is pinned here is the
 * contract around it: that every plan must carry a style, that only the four known ones are
 * accepted, and that the instructions describe each of them — and that waiting photos reach the
 * planner by id, with the rules for what to do about them, including letting one be.
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
    expect(planSchema.safeParse({ tasks: [], answers: [], dismissedPhotoIds: [] }).success).toBe(false);
    expect(
      planSchema.safeParse({ responseStyle: 'command', tasks: [], answers: [], dismissedPhotoIds: [] }).success,
    ).toBe(true);
  });

  it('accepts only the styles the closing instructions know how to speak', () => {
    expect(
      planSchema.safeParse({ responseStyle: 'monologue', tasks: [], answers: [], dismissedPhotoIds: [] }).success,
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

    expect(instructions).toContain('# Photos nobody has looked at yet');
    expect(instructions).toContain('plan it as ordinary tasks');
    expect(instructions).toContain('"(photo photo3)"');
    expect(instructions).toContain('Any task that acts on what the photo shows needs that task');
    expect(instructions).toContain('the one sent last when there are several');
    expect(instructions).toContain('never put one in `answers`');
    expect(instructions).toContain('write no task for a photo the request does not mention');
  });
});

/**
 * "Nothing, never mind" about a waiting photo. It is not work, and it is not an answer — nothing is
 * suspended on a photo — so without a place of its own in the plan it came back empty, and an empty
 * plan is reported to sir as a request no agent could handle.
 */
describe('a reply that he wants nothing done with a photo', () => {
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

  it('has a place in every plan, empty when there is none, so the model never leaves it out', () => {
    expect(planSchema.safeParse({ responseStyle: 'command', tasks: [], answers: [] }).success).toBe(false);
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
    });

    expect((await planDelegations(planner, 'Never mind.')).dismissedPhotoIds).toEqual([]);
  });
});
