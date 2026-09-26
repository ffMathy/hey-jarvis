import { describe, expect, it } from 'bun:test';
import { inTurn } from './in-turn';

/**
 * Two hooks wanting the same session event — the listening lattice and the hang-up both read
 * `onVadScore` — and a spread that would quietly keep only one of them.
 */
describe('handing one event to two handlers', () => {
  it('gives the event to both, the first first', () => {
    const heard: string[] = [];
    const both = inTurn(
      (score: number) => heard.push(`lattice ${score}`),
      (score: number) => heard.push(`hang-up ${score}`),
    );

    both(0.7);

    expect(heard).toEqual(['lattice 0.7', 'hang-up 0.7']);
  });
});
