import { describe, expect, it } from 'bun:test';
import { closeRangeFade } from './head';

describe('the close-range fade', () => {
  it('shows him in full from two and a half radii out and not at all inside one and a half', () => {
    expect(closeRangeFade(1.6, 0.22)).toBe(1);
    expect(closeRangeFade(2.5 * 0.22, 0.22)).toBeCloseTo(1, 12);
    expect(closeRangeFade(1.5 * 0.22, 0.22)).toBe(0);
    expect(closeRangeFade(0, 0.22)).toBe(0);
  });

  it('fades smoothly and only one way between', () => {
    let previous = 0;
    for (let share = 1.5; share <= 2.5; share += 0.05) {
      const fade = closeRangeFade(share * 0.22, 0.22);
      expect(fade).toBeGreaterThanOrEqual(previous);
      previous = fade;
    }
    expect(closeRangeFade(2 * 0.22, 0.22)).toBeCloseTo(0.5, 9);
  });
});
