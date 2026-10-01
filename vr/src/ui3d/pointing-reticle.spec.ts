import { describe, expect, it } from 'bun:test';
import { LABEL_TRUE_SIZE_METRES, labelScaleAt } from './entity-labels';
import {
  landingScale,
  RETICLE_LANDING_SECONDS,
  RETICLE_MIN_DEGREES,
  RETICLE_RADIUS_METRES,
  reticleRadiusAt,
} from './pointing-reticle';

describe('the pointing reticle', () => {
  it('rings a near target at its own size, and a far one no smaller than its least angle', () => {
    expect(reticleRadiusAt(0.5)).toBe(RETICLE_RADIUS_METRES);
    const far = 6;
    const degrees = (Math.atan(reticleRadiusAt(far) / far) * 180) / Math.PI;
    expect(degrees).toBeCloseTo(RETICLE_MIN_DEGREES, 2);
  });

  it('lands on a new target from bigger, and rests once it has', () => {
    expect(landingScale(0)).toBeGreaterThan(1.5);
    expect(landingScale(RETICLE_LANDING_SECONDS / 2)).toBeGreaterThan(1);
    expect(landingScale(RETICLE_LANDING_SECONDS / 2)).toBeLessThan(landingScale(0));
    expect(landingScale(RETICLE_LANDING_SECONDS)).toBe(1);
    expect(landingScale(10)).toBe(1);
  });
});

describe('names over placed things', () => {
  it('are their own size within arm’s length, and keep their apparent size beyond it', () => {
    expect(labelScaleAt(0.4)).toBe(1);
    expect(labelScaleAt(LABEL_TRUE_SIZE_METRES)).toBe(1);
    expect(labelScaleAt(LABEL_TRUE_SIZE_METRES * 3)).toBeCloseTo(3, 9);
  });
});
