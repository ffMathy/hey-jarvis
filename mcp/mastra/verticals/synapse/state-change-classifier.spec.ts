/**
 * The gate in front of the State Change Reactor: a change wakes it only when something can come
 * of it, and the classifier can add to what wakes it but never decide on its own that a change
 * the policy would not file is filed.
 *
 * The reactor costs money every time it is woken, so a change with no priority, rule or
 * subscription behind it is held back however unsure the classifier is; and a rule, a caller
 * that said high, or a subscription that might fire always gets through.
 */

import { describe, expect, it } from 'bun:test';
import type { ClassifierAnswers, ClassifierQuestions } from '@mastra/core/classifier';
import { Classifier } from '@mastra/core/classifier';
import {
  assessmentFrom,
  assessStateChange,
  type StateChangeAssessment,
  type StateChangeTriage,
  stateChangeQuestions,
  triageStateChange,
} from './state-change-classifier.js';
import { formatSubscriptionMatches, type SubscriptionMatch } from './subscription-matcher.js';
import type { Subscription } from './subscription-store.js';

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

  it('knows neither the attention level nor whether a subscription fires when Jev refused to say', () => {
    const answers: ClassifierAnswers<ClassifierQuestions> = {
      attention: { type: 'refusal' },
      'fires:sunset': { type: 'refusal' },
      'fires:doorbell': { type: 'boolean', probability: 0.97 },
    };

    const refused = assessmentFrom(answers, matches);

    expect(refused).toEqual(assessment(undefined, { doorbell: 0.97 }));
    // A subscription it would not judge is one that might fire, so the change still reaches the reactor.
    expect(triageStateChange({ matches, ruleCount: 0, requestedPriority: 'low', assessment: refused }).file).toBe(true);
  });
});

describe('triageStateChange', () => {
  const base = { matches: [match('sunset')], ruleCount: 0, requestedPriority: 'low' as const };
  const nothingBehindIt = { ...base, matches: [] };
  const filedLow: StateChangeTriage = { file: true, priority: 'low', escalated: false };

  it('holds back a change with nothing behind it, when there is no classifier', () => {
    // What a phone's wattage or the bedroom's air quality looks like: low, no rule, no
    // subscription. Without a classifier this is the whole policy, and it must not wake the reactor.
    expect(triageStateChange({ ...nothingBehindIt, assessment: undefined }).file).toBe(false);
  });

  it('holds back a change with nothing behind it, when the classifier is unsure of it', () => {
    expect(triageStateChange({ ...nothingBehindIt, assessment: assessment(undefined) }).file).toBe(false);
  });

  it('holds back a change with nothing behind it that is only worth knowing about', () => {
    expect(triageStateChange({ ...nothingBehindIt, assessment: assessment('fyi') }).file).toBe(false);
  });

  it('files a change the classifier is sure should reach someone soon', () => {
    expect(triageStateChange({ ...nothingBehindIt, assessment: assessment('soon') })).toEqual(filedLow);
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

  it('never holds back a change the caller marked high, even with nothing else behind it', () => {
    const triage = triageStateChange({
      ...nothingBehindIt,
      requestedPriority: 'high',
      assessment: assessment('ignore'),
    });

    expect(triage).toEqual({ file: true, priority: 'high', escalated: false });
  });

  it('never holds back a change a rule applies to', () => {
    expect(triageStateChange({ ...base, ruleCount: 1, assessment: assessment('ignore', { sunset: 0 }) })).toEqual(
      filedLow,
    );
  });

  it('files a change a subscription might fire for, however little attention it deserves', () => {
    expect(triageStateChange({ ...base, assessment: assessment('ignore', { sunset: 0.4 }) })).toEqual(filedLow);
  });

  it('files a change a candidate subscription was shortlisted for, when there is no classifier', () => {
    expect(triageStateChange({ ...base, assessment: undefined })).toEqual(filedLow);
  });

  it('files a change when a subscription went unanswered', () => {
    expect(triageStateChange({ ...base, assessment: assessment('ignore') })).toEqual(filedLow);
  });

  it('holds back a change when it is sure no candidate subscription fires', () => {
    const triage = triageStateChange({ ...base, assessment: assessment(undefined, { sunset: 0.03 }) });

    expect(triage.file).toBe(false);
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
        doDecide: async ({ state, questions }) => {
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
        state: [{ type: 'text', text: 'device_state_change from internet-of-things: {"entityId":"sensor.power"}' }],
        questionIds: ['attention', 'fires:sunset'],
      },
    ]);
  });
});
