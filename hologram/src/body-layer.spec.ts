import { describe, expect, it } from 'bun:test';
import { bodyStartingShare, GPU_STARTING_SHARE, keepsProvenShare } from './body-layer';
import { createDensityControl, FEWEST_PARTICLES, startFromRemembered, steerDensity } from './density-control';

describe('where the density loop starts for each renderer', () => {
  it("starts Skia's body where it always has: the remembered share, or the floor", () => {
    expect(bodyStartingShare('skia', undefined)).toBeUndefined();
    expect(createDensityControl(bodyStartingShare('skia', undefined)).density).toBe(FEWEST_PARTICLES);
    expect(bodyStartingShare('skia', startFromRemembered(0.6))).toBe(startFromRemembered(0.6));
  });

  it("starts the GPU's body at half, whatever Skia's body was remembered holding", () => {
    expect(bodyStartingShare('gpu', undefined)).toBe(GPU_STARTING_SHARE);
    expect(bodyStartingShare('gpu', startFromRemembered(0.2))).toBe(GPU_STARTING_SHARE);
    expect(bodyStartingShare('gpu', startFromRemembered(1))).toBe(GPU_STARTING_SHARE);
    expect(createDensityControl(bodyStartingShare('gpu', undefined)).density).toBe(GPU_STARTING_SHARE);
  });
});

describe('which proven share is remembered for next time', () => {
  it("keeps Skia's body's, and never what the GPU's held", () => {
    // The GPU's frames build in a millisecond whatever the share, so at sixty frames a second the
    // loop climbs to every particle and proves it — which Skia's body may be nowhere near holding.
    const onTheGpu = createDensityControl(bodyStartingShare('gpu', undefined));
    for (let window = 0; window < 40; window++) {
      steerDensity(onTheGpu, 60, 0.5, 1);
    }
    expect(onTheGpu.proven).toBe(1);
    expect(keepsProvenShare('gpu')).toBe(false);
    expect(keepsProvenShare('pending')).toBe(false);
    expect(keepsProvenShare('skia')).toBe(true);
  });
});
