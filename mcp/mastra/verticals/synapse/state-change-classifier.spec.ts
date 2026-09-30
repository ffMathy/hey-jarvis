/**
 * The gate in front of the State Change Reactor: when a change is escalated, when it is held
 * back, and every way it falls back to being filed exactly as before.
 *
 * Holding a change back is the one decision here that can lose something the user wanted, so
 * most of what is pinned is the ways it declines to: a rule, a caller that said high, an unsure
 * attention level, or any subscription that might fire.
 */

import { describe, expect, it } from 'bun:test';
import type { ClassifierAnswers, ClassifierQuestions } from '@mastra/core/classifier';
import { Classifier } from '@mastra/core/classifier';
import type { Subscription } from '../../storage/subscriptions.js';
import {
  assessmentFrom,
  assessStateChange,
  type StateChangeAssessment,
  stateChangeQuestions,
  triageStateChange,
} from './state-change-classifier.js';
import { formatSubscriptionMatches, type SubscriptionMatch } from './subscription-matcher.js';

function match(id: string, overrides: Partial<Subscription> = {}): SubscriptionMatch {
  const subscription: Subscription = {
    id,
    source: 'user',
    whenEvent: 'the sun goes down',
    thenAction: 'close the blinds',
    oneShot: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastTriggeredAt: null,
    triggerCount: 0,
    maxTriggerCount: null,
    expiresAt: null,
    ...overrides,
  };

  return { subscription, whenScore: 0.5, givenScore: null, score: 0.5 };
}

function assessment(
  attention: StateChangeAssessment['attention'],
  fireProbabilities: Record<string, number> = {},
): StateChangeAssessment {
  return { attention, fireProbabilities: new Map(Object.entries(fireProbabilities)) };
}

describe('stateChangeQuestions', () => {
  it('asks for the attention level, and one yes-or-no per shortlisted subscription', () => {
    const questions = stateChangeQuestions([
      match('sunset', { givenCondition: 'the lights are on' }),
      match('doorbell', { whenEvent: 'the doorbell rings' }),
    ]);

    expect(Object.keys(questions)).toEqual(['attention', 'fires:sunset', 'fires:doorbell']);
    expect(questions.attention.type).toBe('score');
    expect(questions['fires:sunset'].instructions).toContain('WHEN the sun goes down, GIVEN the lights are on');
    expect(questions['fires:doorbell'].instructions).toContain('WHEN the doorbell rings. ');
  });

  it('asks only for the attention level when nothing was shortlisted', () => {
    expect(Object.keys(stateChangeQuestions([]))).toEqual(['attention']);
  });
});

describe('assessmentFrom', () => {
  const matches = [match('sunset'), match('doorbell')];

  it('reads a sure attention level and every subscription answer', () => {
    const answers: ClassifierAnswers<ClassifierQuestions> = {
      attention: { type: 'score', score: 2.95, probabilities: { '0': 0, '1': 0, '2': 0.05, '3': 0.95 } },
      'fires:sunset': { type: 'boolean', probability: 0.02 },
      'fires:doorbell': { type: 'boolean', probability: 0.97 },
    };

    expect(assessmentFrom(answers, matches)).toEqual(assessment('now', { sunset: 0.02, doorbell: 0.97 }));
  });

  it('leaves the attention level unknown when the model is not sure of one', () => {
    const answers: ClassifierAnswers<ClassifierQuestions> = {
      attention: { type: 'score', score: 0.5, probabilities: { '0': 0.5, '1': 0.5, '2': 0, '3': 0 } },
    };

    expect(assessmentFrom(answers, []).attention).toBeUndefined();
  });

  it('leaves the attention level unknown when it came without a distribution', () => {
    const answers: ClassifierAnswers<ClassifierQuestions> = { attention: { type: 'score', score: 0 } };

    expect(assessmentFrom(answers, []).attention).toBeUndefined();
  });

  it('leaves out a subscription it has no answer for', () => {
    const answers: ClassifierAnswers<ClassifierQuestions> = {
      attention: { type: 'score', score: 0 },
      'fires:sunset': { type: 'boolean', probability: 0.02 },
    };

    expect(assessmentFrom(answers, matches).fireProbabilities).toEqual(new Map([['sunset', 0.02]]));
  });
});

describe('triageStateChange', () => {
  const base = { matches: [match('sunset')], ruleCount: 0, requestedPriority: 'low' as const };

  it('files as requested when there is no assessment', () => {
    expect(triageStateChange({ ...base, assessment: undefined })).toEqual({
      file: true,
      priority: 'low',
      escalated: false,
    });
  });

  it('escalates a change it is sure needs attention now', () => {
    expect(triageStateChange({ ...base, assessment: assessment('now', { sunset: 0 }) })).toEqual({
      file: true,
      priority: 'high',
      escalated: true,
    });
  });

  it('never lowers what the caller asked for', () => {
    expect(
      triageStateChange({ ...base, requestedPriority: 'high', assessment: assessment('fyi', { sunset: 0.5 }) }),
    ).toEqual({ file: true, priority: 'high', escalated: false });
  });

  it('holds back a change it is sure deserves nothing, when no subscription fires', () => {
    const triage = triageStateChange({ ...base, assessment: assessment('ignore', { sunset: 0.03 }) });

    expect(triage.file).toBe(false);
  });

  it('holds back a change with no candidates at all, when it is sure it deserves nothing', () => {
    expect(triageStateChange({ ...base, matches: [], assessment: assessment('ignore') }).file).toBe(false);
  });

  it('files a change a subscription might fire for, however little attention it deserves', () => {
    expect(triageStateChange({ ...base, assessment: assessment('ignore', { sunset: 0.4 }) }).file).toBe(true);
  });

  it('files a change when a subscription went unanswered', () => {
    expect(triageStateChange({ ...base, assessment: assessment('ignore') }).file).toBe(true);
  });

  it('never holds back a change a rule applies to', () => {
    expect(triageStateChange({ ...base, ruleCount: 1, assessment: assessment('ignore', { sunset: 0 }) })).toEqual({
      file: true,
      priority: 'low',
      escalated: false,
    });
  });

  it('never holds back a change the caller marked high', () => {
    const triage = triageStateChange({
      ...base,
      requestedPriority: 'high',
      assessment: assessment('ignore', { sunset: 0 }),
    });

    expect(triage).toEqual({ file: true, priority: 'high', escalated: false });
  });

  it('files as before when it is unsure of the attention level', () => {
    expect(triageStateChange({ ...base, assessment: assessment(undefined, { sunset: 0 }) })).toEqual({
      file: true,
      priority: 'low',
      escalated: false,
    });
  });
});

describe('formatSubscriptionMatches with the classifier', () => {
  it('writes the probability that a candidate fires under it', () => {
    const formatted = formatSubscriptionMatches([match('sunset')], new Map([['sunset', 0.91]]));

    expect(formatted).toContain('Classifier: fires with probability 0.91');
  });

  it('writes nothing extra when the classifier did not judge it', () => {
    expect(formatSubscriptionMatches([match('sunset')])).not.toContain('Classifier');
  });
});

describe('assessStateChange', () => {
  it('evaluates the change against its questions and reads the answers', async () => {
    const evaluated: { state: unknown; questionIds: string[] }[] = [];
    const classifier = new Classifier({
      id: 'stateChangeClassifier',
      model: {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId: 'jev-fake',
        supportedQuestionTypes: ['score', 'boolean'],
        doEvaluate: async ({ state, questions }) => {
          evaluated.push({ state, questionIds: Object.keys(questions) });
          return {
            answers: {
              attention: { type: 'score', score: 0.05, probabilities: { '0': 0.95, '1': 0.05, '2': 0, '3': 0 } },
              'fires:sunset': { type: 'boolean', probability: 0.04 },
            },
            warnings: [],
          };
        },
      },
    });

    const result = await assessStateChange(
      classifier,
      { source: 'internet-of-things', stateType: 'device_state_change', stateData: { entityId: 'sensor.power' } },
      [match('sunset')],
    );

    expect(result).toEqual(assessment('ignore', { sunset: 0.04 }));
    expect(evaluated).toEqual([
      {
        state: 'device_state_change from internet-of-things: {"entityId":"sensor.power"}',
        questionIds: ['attention', 'fires:sunset'],
      },
    ]);
  });
});
