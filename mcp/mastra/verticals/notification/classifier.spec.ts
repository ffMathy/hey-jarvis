/**
 * The notification urgency classifier: when it overrides the agent's urgency, and every way the
 * agent's decision stands.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import { getNotificationAgent } from './agent.js';
import {
  ROUTINE_MESSAGES,
  reviewAgentUrgency,
  URGENCY_OVERRIDE_CONFIDENCE,
  URGENT_MESSAGES,
  urgencyOverrideFrom,
  urgencyQuestions,
} from './classifier.js';

/** A classifier on a fake Jev that answers with `probability`, or fails with it. */
function fakeClassifier(probability: number | Error) {
  const evaluatedStates: unknown[] = [];
  const classifier = new Classifier({
    id: 'notificationUrgencyClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['boolean'],
      doEvaluate: async ({ state }) => {
        evaluatedStates.push(state);
        if (probability instanceof Error) {
          throw probability;
        }
        return { answers: { urgent: { type: 'boolean', probability } }, warnings: [] };
      },
    },
  });
  return { classifier, evaluatedStates };
}

function urgent(probability: number) {
  return { urgent: { type: 'boolean' as const, probability } };
}

describe('urgencyQuestions', () => {
  it('judges urgency by the same guidance the agent is given', async () => {
    const { criteria } = urgencyQuestions().urgent;
    const instructions = await (await getNotificationAgent()).getInstructions();

    expect(criteria.true).toContain(URGENT_MESSAGES);
    expect(criteria.false).toContain(ROUTINE_MESSAGES);
    expect(instructions).toContain(`URGENT: ${URGENT_MESSAGES}.`);
    expect(instructions).toContain(`NOT URGENT: ${ROUTINE_MESSAGES}.`);
  });
});

describe('urgencyOverrideFrom', () => {
  it('makes a message urgent only when all but certain the agent was wrong', () => {
    expect(urgencyOverrideFrom(urgent(0.97), false)).toBe(true);
    expect(urgencyOverrideFrom(urgent(URGENCY_OVERRIDE_CONFIDENCE), false)).toBe(true);
    expect(urgencyOverrideFrom(urgent(0.85), false)).toBeUndefined();
  });

  it('makes a message routine only when all but certain the agent was wrong', () => {
    expect(urgencyOverrideFrom(urgent(0.03), true)).toBe(false);
    expect(urgencyOverrideFrom(urgent(1 - URGENCY_OVERRIDE_CONFIDENCE), true)).toBe(false);
    expect(urgencyOverrideFrom(urgent(0.15), true)).toBeUndefined();
  });

  it('never overrides an agent it agrees with', () => {
    expect(urgencyOverrideFrom(urgent(0.99), true)).toBeUndefined();
    expect(urgencyOverrideFrom(urgent(0.01), false)).toBeUndefined();
  });
});

describe('reviewAgentUrgency', () => {
  it('evaluates the title and the message, and overrides an agent it is sure got it wrong', async () => {
    const { classifier, evaluatedStates } = fakeClassifier(0.98);

    expect(
      await reviewAgentUrgency(classifier, {
        message: "There's water on the utility room floor.",
        title: 'Leak',
        isUrgent: false,
      }),
    ).toBe(true);
    expect(evaluatedStates).toEqual(["Leak\n\nThere's water on the utility room floor."]);
  });

  it('turns an urgent laundry reminder routine', async () => {
    const { classifier } = fakeClassifier(0.02);

    expect(await reviewAgentUrgency(classifier, { message: 'The laundry is done.', isUrgent: true })).toBe(false);
  });

  it("keeps the agent's urgency when unsure", async () => {
    const { classifier } = fakeClassifier(0.6);

    expect(await reviewAgentUrgency(classifier, { message: 'The package is delayed.', isUrgent: true })).toBe(true);
    expect(await reviewAgentUrgency(classifier, { message: 'The package is delayed.', isUrgent: false })).toBe(false);
  });

  it("keeps the agent's urgency without a classifier, or when it fails", async () => {
    const { classifier } = fakeClassifier(new Error('Jev is down'));

    expect(await reviewAgentUrgency(undefined, { message: 'Smoke in the kitchen.', isUrgent: false })).toBe(false);
    expect(await reviewAgentUrgency(classifier, { message: 'Smoke in the kitchen.', isUrgent: false })).toBe(false);
  });
});
