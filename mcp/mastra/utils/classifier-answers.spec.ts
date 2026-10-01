import { describe, expect, it } from 'bun:test';
import { confidentChoice, confidentScoreLevel } from './classifier-answers.js';

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
});
