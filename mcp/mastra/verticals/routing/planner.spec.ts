/**
 * The planner's labelling of how a request should be answered.
 *
 * What the model does with the instructions is the LLM eval's to judge; what is pinned here is the
 * contract around it: that every plan must carry a style, that only the four known ones are
 * accepted, and that the instructions describe each of them.
 */

import { describe, expect, it } from 'bun:test';
import {
  decisionFromClassification,
  plannerInstructions,
  planSchema,
  preferFastPlan,
  RESPONSE_STYLES,
  type RoutingDecision,
} from './planner.js';

describe('responseStyle', () => {
  it('is required on every plan, so a request is never answered in no particular way', () => {
    expect(planSchema.safeParse({ tasks: [], answers: [] }).success).toBe(false);
    expect(planSchema.safeParse({ responseStyle: 'command', tasks: [], answers: [] }).success).toBe(true);
  });

  it('accepts only the styles the closing instructions know how to speak', () => {
    expect(planSchema.safeParse({ responseStyle: 'monologue', tasks: [], answers: [] }).success).toBe(false);
  });

  it('is explained to the planner, one style at a time', () => {
    const instructions = plannerInstructions([]);

    for (const style of RESPONSE_STYLES) {
      expect(instructions).toContain(`\`${style}\``);
    }
    expect(instructions).toContain('where the value of the request lands');
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
