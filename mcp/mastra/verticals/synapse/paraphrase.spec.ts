import { describe, expect, it } from 'bun:test';
import { cosineSimilarity, embedText } from '../../utils/static-embedder.js';
import { thirdPersonVariant } from './paraphrase.js';
import { describeStateChange } from './state-change.js';

describe('thirdPersonVariant', () => {
  it('rewrites the subject pronoun', () => {
    expect(thirdPersonVariant('I get home from work')).toBe('a person get home from work');
  });

  it('rewrites possessives and objects', () => {
    expect(thirdPersonVariant('I receive an email from my boss')).toBe('a person receive an email from the boss');
    expect(thirdPersonVariant('someone calls me')).toBe('someone calls the person');
  });

  it('expands contractions before the bare pronoun', () => {
    // "I'm" must be handled first, or the rewrite leaves "a person'm" behind.
    expect(thirdPersonVariant("I'm home")).toBe('a person is home');
    expect(thirdPersonVariant("I've arrived")).toBe('a person has arrived');
  });

  it('returns null when there is nothing in the first person', () => {
    expect(thirdPersonVariant('the sun goes down')).toBeNull();
    expect(thirdPersonVariant('the washing machine finishes')).toBeNull();
  });

  it('leaves the letter i inside words alone', () => {
    // The pattern is word-bounded and case-sensitive, so ordinary words survive.
    expect(thirdPersonVariant('it is raining in Italy')).toBeNull();
  });

  it('produces a phrasing that actually reaches a machine-shaped state change', async () => {
    const change = await embedText(
      describeStateChange({
        source: 'internet-of-things',
        stateType: 'device_tracker',
        stateData: { person: 'Mathias', from: 'work', to: 'home' },
      }),
    );

    const original = cosineSimilarity(await embedText('I get home from work'), change);
    const rewritten = cosineSimilarity(await embedText(thirdPersonVariant('I get home from work') ?? ''), change);

    // 0.20 -> 0.32, across the 0.3 floor. This is the whole reason the rewrite is
    // stored: the user's own wording never gets there.
    expect(rewritten).toBeGreaterThan(original);
    expect(rewritten).toBeGreaterThan(0.3);
  });
});
