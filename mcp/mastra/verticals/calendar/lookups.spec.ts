import { describe, expect, it } from 'bun:test';
import { householdDays } from './lookups.js';

describe('householdDays', () => {
  it('counts days in Copenhagen, not on the server clock', () => {
    // 23:30 UTC on 1 October is already 2 October in Copenhagen, two hours ahead in summer time.
    const now = new Date('2026-10-01T23:30:00Z');

    expect(householdDays(0, 1, now)).toEqual({
      timeMin: '2026-10-01T22:00:00.000Z',
      timeMax: '2026-10-02T22:00:00.000Z',
    });
    expect(householdDays(1, 1, now).timeMin).toBe('2026-10-02T22:00:00.000Z');
  });

  it('covers a week from the start of today', () => {
    const { timeMin, timeMax } = householdDays(0, 7, new Date('2026-10-01T10:00:00Z'));

    expect(timeMin).toBe('2026-09-30T22:00:00.000Z');
    expect(timeMax).toBe('2026-10-07T22:00:00.000Z');
  });
});
