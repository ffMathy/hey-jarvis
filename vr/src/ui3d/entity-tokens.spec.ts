import { describe, expect, it } from 'bun:test';
import { MARKER_MIN_DEGREES, markerScaleAt } from './entity-tokens';

describe('markerScaleAt', () => {
  it('is a small dot near to', () => {
    expect(markerScaleAt(0.5)).toBe(0.5);
  });

  it('never shrinks below its least angle, so a far thing still has one', () => {
    const far = markerScaleAt(6);
    expect(far).toBeGreaterThan(0.5);
    expect(markerScaleAt(12)).toBeCloseTo(far * 2, 6);
    // Its radius at 6 m subtends the least angle.
    const radius = far * 0.7 * 0.02;
    expect((Math.atan(radius / 6) * 180) / Math.PI).toBeCloseTo(MARKER_MIN_DEGREES, 4);
  });
});
