import { describe, expect, it } from 'bun:test';
import { bodyStartingShare, GPU_STARTING_SHARE } from './body-layer';
import { createDensityControl, FEWEST_PARTICLES, startFromRemembered } from './density-control';

describe('where the density loop starts for each renderer', () => {
  it("starts Skia's body where it always has: the remembered share, or the floor", () => {
    expect(bodyStartingShare('skia', undefined)).toBeUndefined();
    expect(createDensityControl(bodyStartingShare('skia', undefined)).density).toBe(FEWEST_PARTICLES);
    expect(bodyStartingShare('skia', startFromRemembered(0.6))).toBe(startFromRemembered(0.6));
  });

  it("starts the GPU's body at half, or higher where more was remembered", () => {
    expect(bodyStartingShare('gpu', undefined)).toBe(GPU_STARTING_SHARE);
    expect(bodyStartingShare('gpu', 0.2)).toBe(GPU_STARTING_SHARE);
    expect(bodyStartingShare('gpu', 0.9)).toBe(0.9);
    expect(createDensityControl(bodyStartingShare('gpu', undefined)).density).toBe(GPU_STARTING_SHARE);
  });
});
