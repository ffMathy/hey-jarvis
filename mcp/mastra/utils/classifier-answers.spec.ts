import { describe, expect, it } from 'bun:test';
import {
  booleanAnswerIn,
  choiceAnswerIn,
  confidentBoolean,
  confidentChoice,
  confidentScoreLevel,
  probabilityOfYes,
} from './classifier-answers.js';

/** How a decision model answers a question it declines, whatever kind of question it was. */
const REFUSAL = { type: 'refusal' } as const;

describe('confidentChoice', () => {
  it('takes the choice when it is sure enough', () => {
    expect(confidentChoice({ type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 } }, 0.85)).toBe('a');
  });

  it('declines a choice below the bar', () => {
    expect(confidentChoice({ type: 'choice', choice: 'a', probabilities: { a: 0.6, b: 0.4 } }, 0.85)).toBeUndefined();
  });

  it('declines a choice that came without a distribution', () => {
    expect(confidentChoice({ type: 'choice', choice: 'a' }, 0.85)).toBeUndefined();
  });

  it('declines a question the model refused to answer', () => {
    expect(confidentChoice(REFUSAL, 0.85)).toBeUndefined();
  });
});

describe('confidentScoreLevel', () => {
  const LEVELS = ['low', 'middle', 'high'] as const;

  it('names the level whose probability reaches the bar', () => {
    const answer = { type: 'score' as const, score: 1.9, probabilities: { '0': 0, '1': 0.1, '2': 0.9 } };

    expect(confidentScoreLevel(answer, LEVELS, 0.85)).toBe('high');
  });

  it('declines when the model is torn between levels', () => {
    const answer = { type: 'score' as const, score: 1.5, probabilities: { '0': 0, '1': 0.5, '2': 0.5 } };

    expect(confidentScoreLevel(answer, LEVELS, 0.85)).toBeUndefined();
  });

  it('declines a score that came without a distribution', () => {
    expect(confidentScoreLevel({ type: 'score', score: 2 }, LEVELS, 0.85)).toBeUndefined();
  });

  it('declines a question the model refused to answer', () => {
    expect(confidentScoreLevel(REFUSAL, LEVELS, 0.85)).toBeUndefined();
  });
});

describe('probabilityOfYes', () => {
  it('is the probability a yes/no question was answered with', () => {
    expect(probabilityOfYes({ type: 'boolean', probability: 0.3 })).toBe(0.3);
  });

  it('is nothing for a question the model refused, or one that was not asked', () => {
    expect(probabilityOfYes(REFUSAL)).toBeUndefined();
    expect(probabilityOfYes(undefined)).toBeUndefined();
  });
});

describe('confidentBoolean', () => {
  it('is yes at or above the bar, and no at or below its complement', () => {
    expect(confidentBoolean({ type: 'boolean', probability: 0.97 }, 0.9)).toBe(true);
    expect(confidentBoolean({ type: 'boolean', probability: 0.9 }, 0.9)).toBe(true);
    expect(confidentBoolean({ type: 'boolean', probability: 0.03 }, 0.9)).toBe(false);
    expect(confidentBoolean({ type: 'boolean', probability: 1 - 0.9 }, 0.9)).toBe(false);
  });

  it('is nothing in between', () => {
    expect(confidentBoolean({ type: 'boolean', probability: 0.5 }, 0.9)).toBeUndefined();
    expect(confidentBoolean({ type: 'boolean', probability: 0.85 }, 0.9)).toBeUndefined();
    expect(confidentBoolean({ type: 'boolean', probability: 0.15 }, 0.9)).toBeUndefined();
  });

  it('is neither yes nor no for a question the model refused, or one that was not asked', () => {
    expect(confidentBoolean(REFUSAL, 0.9)).toBeUndefined();
    expect(confidentBoolean(undefined, 0.9)).toBeUndefined();
  });
});

describe('choiceAnswerIn and booleanAnswerIn', () => {
  const answers = {
    chosen: { type: 'choice' as const, choice: 'a' },
    answered: { type: 'boolean' as const, probability: 0.9 },
    refusedChoice: REFUSAL,
    refusedBoolean: REFUSAL,
  };

  it('find an answer of the kind asked for', () => {
    expect(choiceAnswerIn(answers, 'chosen')).toEqual(answers.chosen);
    expect(booleanAnswerIn(answers, 'answered')).toEqual(answers.answered);
  });

  it('find nothing for a question the model refused, or that was asked as another kind', () => {
    expect(choiceAnswerIn(answers, 'refusedChoice')).toBeUndefined();
    expect(booleanAnswerIn(answers, 'refusedBoolean')).toBeUndefined();
    expect(choiceAnswerIn(answers, 'answered')).toBeUndefined();
    expect(booleanAnswerIn(answers, 'chosen')).toBeUndefined();
  });
});
