import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, hologramFrameOf } from './frame-clock';
import { SCENE_SEED } from './frame-timing';
import {
  analyseFrame,
  BODY_ID_FIELD,
  BODY_STRIDE,
  createHologramScene,
  type HologramFrame,
  type HologramFrameState,
  readFragment,
  SCAN_FLOOR,
  SCAN_PROMOTED_SHARE,
  SCAN_SECONDS,
  SCAN_SOFTNESS,
  SCAN_STRETCH,
  SCAN_TILT,
  SCAN_TILT_SECONDS,
  SCAN_TRAVEL,
  scanned,
  THOUGHT_PICTURE_DIMMING,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * What he does while he thinks: one soft band of light gliding up through him and back down, at the
 * user's asking ("it is currently too dull. Maybe it's because there are 2 thinking stripes or
 * pulses, when there should be 1 … The stripe also looks very sharp. Maybe it could be more subtly
 * blending in"). Each of those three complaints is pinned here against what a frame really is —
 * `analyseFrame` over the frame clock's frames, and the scene's own specks — and how he looks with it
 * is the headset's browser tests' to say.
 */

const SIZE = 256;
const scene = createHologramScene(SCENE_SEED);

function frameAt(overrides: Partial<HologramFrame>): HologramFrame {
  return {
    time: 0,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    presence: 1,
    thinking: 0,
    ...overrides,
  };
}

/** Where the band's plane is at a height `apart` from its middle (in R, down his height), straight down his middle: x is nought. */
function downTheMiddle(state: HologramFrameState, apart: number) {
  // His frame's height is y·cos + x·sin of the band's tilt, so with x nought it is y·cos.
  return (state.scan + apart) / state.scanTiltCos;
}

/** What a frame clock thinking from the start hands the drawing, analysed, 60 times a second for `seconds`. */
function thinkingFrames(seconds: number): HologramFrameState[] {
  const clock = createFrameClockState();
  const silent = new Array<number>(VOICE_BAND_COUNT).fill(0);
  const states: HologramFrameState[] = [];
  for (let step = 1; step <= Math.round(seconds * 60); step++) {
    advanceFrameClock(clock, 1 / 60, 0, silent, false, true, false, 0, 0);
    states.push(analyseFrame(hologramFrameOf(clock), SIZE));
  }
  return states;
}

/**
 * The hops the scene's lit specks re-light at, at a few moments: the hash of each one's id and the
 * blink it is on, as every renderer works it out (`fraction(cycle · 0.618034 + id · 9.7)`). They are
 * what the band deals its brightest tier from.
 */
function hopsOfTheScene(): number[] {
  const hops: number[] = [];
  const reading = [0, 0, 0, 0, 0];
  for (const time of [41.2, 43.1, 47.9]) {
    const state = analyseFrame(frameAt({ time, thinking: 1 }), SIZE);
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
      if (readFragment(scene.body, offset, state, reading) <= 0) continue;
      const cycles = (reading[3] ?? 0) * 0.618034 + (scene.body[offset + BODY_ID_FIELD] ?? 0) * 9.7;
      hops.push(cycles - Math.floor(cycles));
    }
  }
  return hops;
}

describe('the thinking band', () => {
  it('is the one thing a thought adds: no ring blooms out of his core at the end of a pass', () => {
    // The last stretch of a pass, where the ring used to bloom.
    const state = analyseFrame(frameAt({ time: SCAN_SECONDS - 0.1, thinking: 1 }), SIZE);
    expect(state).not.toHaveProperty('pulse');
  });

  it('starts at the bottom and glides up through him and back down, turning back at SCAN_TRAVEL, never jumping', () => {
    const passes = 4;
    const scans = thinkingFrames(passes * SCAN_SECONDS - 0.5).map((state) => state.scan);
    // y runs down, so the bottom is positive: the first frame is a sixtieth of a second up from it.
    expect(scans[0]).toBeCloseTo(SCAN_TRAVEL, 3);
    expect(scans[0]).toBeLessThanOrEqual(SCAN_TRAVEL);
    // As far as SCAN_TRAVEL either way, and no further.
    expect(Math.max(...scans)).toBeCloseTo(SCAN_TRAVEL, 3);
    expect(Math.min(...scans)).toBeCloseTo(-SCAN_TRAVEL, 3);
    expect(Math.max(...scans.map(Math.abs))).toBeLessThanOrEqual(SCAN_TRAVEL + 1e-12);

    // Never further in a frame than a pendulum swinging that far over SCAN_SECONDS moves at its
    // fastest: a fiftieth of his radius at 60 Hz, where the old plane leapt from top to bottom.
    const steps = scans.slice(1).map((scan, frame) => scan - (scans[frame] ?? Number.NaN));
    const fastest = (SCAN_TRAVEL * Math.PI) / SCAN_SECONDS / 60;
    expect(Math.max(...steps.map(Math.abs))).toBeLessThanOrEqual(fastest + 1e-12);
    expect(fastest).toBeLessThan(0.02);

    // It turns back only at the ends of its travel: once a pass, so three times in four passes.
    const turns = steps.flatMap((step, frame) =>
      Math.sign(step) !== Math.sign(steps[frame + 1] ?? step) ? [frame + 1] : [],
    );
    expect(turns).toHaveLength(passes - 1);
    for (const frame of turns) expect(Math.abs(scans[frame] ?? 0)).toBeGreaterThan(SCAN_TRAVEL - 1e-3);
    // Up first: the first pass climbs, which is y falling.
    expect(steps[0]).toBeLessThan(0);
  });

  it('rocks its plane gently on a clock of its own, so no two passes cross him alike', () => {
    const states = thinkingFrames(4 * SCAN_SECONDS);
    const tilts = states.map((state) => Math.atan2(state.scanTiltSin, state.scanTiltCos));
    expect(Math.max(...tilts.map(Math.abs))).toBeLessThanOrEqual(SCAN_TILT + 1e-12);
    // Both ways, and as far as SCAN_TILT, within these four passes.
    expect(Math.max(...tilts)).toBeGreaterThan(SCAN_TILT * 0.99);
    expect(Math.min(...tilts)).toBeLessThan(-SCAN_TILT * 0.99);
    const fastest = (SCAN_TILT * 2 * Math.PI) / SCAN_TILT_SECONDS / 60;
    for (let frame = 1; frame < tilts.length; frame++) {
      expect(Math.abs((tilts[frame] ?? 0) - (tilts[frame - 1] ?? 0))).toBeLessThanOrEqual(fastest + 1e-12);
    }
    // Where each pass crosses his middle, the plane leans another way from the pass before.
    const crossings = states.flatMap((state, frame) =>
      frame > 0 && Math.sign(state.scan) !== Math.sign(states[frame - 1]?.scan ?? state.scan)
        ? [tilts[frame] ?? 0]
        : [],
    );
    expect(crossings).toHaveLength(4);
    for (let pass = 1; pass < crossings.length; pass++) {
      expect(Math.abs((crossings[pass] ?? 0) - (crossings[pass - 1] ?? 0))).toBeGreaterThan(0.05);
    }
  });

  it('leaves a speck far from the band SCAN_FLOOR of its light, and lights it more the nearer the middle it is', () => {
    const state = analyseFrame(frameAt({ time: 41.2, thinking: 1 }), SIZE);
    const hop = 0.5;
    // Far from the band — four of its softnesses and more, either side — he keeps SCAN_FLOOR of his
    // light: thinking, not dark. It was an eighth, which read as dull; a quarter is the least that
    // answers it.
    for (const apart of [-2, -1.6, -4 * SCAN_SOFTNESS, 4 * SCAN_SOFTNESS, 1.6, 2]) {
      expect(scanned(0, downTheMiddle(state, apart), hop, state)).toBeCloseTo(SCAN_FLOOR, 6);
    }
    expect(SCAN_FLOOR).toBeGreaterThan(0.25);
    // In its very middle, all of it; and between, more the nearer, falling off as a bell — never at
    // an edge.
    expect(scanned(0, downTheMiddle(state, 0), hop, state)).toBeCloseTo(1, 12);
    const light = Array.from({ length: 41 }, (_, step) => scanned(0, downTheMiddle(state, step * 0.03), hop, state));
    for (let step = 1; step < light.length; step++) {
      expect(light[step]).toBeLessThan(light[step - 1] ?? Number.NaN);
      expect((light[step - 1] ?? Number.NaN) - (light[step] ?? Number.NaN)).toBeLessThan(0.1);
    }
    // Half a thought, half the dimming.
    const half = analyseFrame(frameAt({ time: 41.2, thinking: 0.5 }), SIZE);
    expect(scanned(0, downTheMiddle(half, 2), hop, half)).toBeCloseTo(1 - 0.5 * (1 - SCAN_FLOOR), 6);
  });

  it('deals its brightest tier by chance, so the share it promotes falls off smoothly from its middle', () => {
    const hops = hopsOfTheScene();
    expect(hops.length).toBeGreaterThan(10000);
    const state = analyseFrame(frameAt({ time: 41.2, thinking: 1 }), SIZE);
    const step = 0.04;
    const promoted = Array.from({ length: 31 }, (_, index) => {
      const y = downTheMiddle(state, index * step);
      let count = 0;
      for (const hop of hops) {
        scanned(0, y, hop, state);
        count += state.scanBright[0] ?? 0;
      }
      return count / hops.length;
    });

    // As likely as the band's nearness squared, times SCAN_PROMOTED_SHARE: in its middle, not every
    // speck, and the further out, the fewer.
    promoted.forEach((share, index) => {
      const apart = (index * step) / SCAN_SOFTNESS;
      expect(Math.abs(share - SCAN_PROMOTED_SHARE * Math.exp(-2 * apart * apart))).toBeLessThan(0.03);
    });
    expect(promoted[0]).toBeLessThan(0.9);
    expect(promoted[0]).toBeGreaterThan(0.3);
    // No edge: from one step to the next it changes by a fraction of what a threshold would, which
    // took it from every speck to none at once...
    for (let index = 1; index < promoted.length; index++) {
      const change = (promoted[index - 1] ?? Number.NaN) - (promoted[index] ?? Number.NaN);
      expect(change).toBeGreaterThan(-0.02);
      expect(change).toBeLessThan(0.15);
    }
    // ...and it passes through every share between, so the bright specks thin out into him.
    expect(promoted.filter((share) => share > 0.05 && share < 0.5).length).toBeGreaterThanOrEqual(4);
    expect(promoted.at(-1)).toBeLessThan(0.01);
  });

  it('draws the specks in its middle SCAN_STRETCH longer, less the further out, and none longer far from it', () => {
    const state = analyseFrame(frameAt({ time: 41.2, thinking: 1 }), SIZE);
    scanned(0, downTheMiddle(state, 0), 0.5, state);
    expect(state.scanBright[1]).toBeCloseTo(SCAN_STRETCH, 12);
    scanned(0, downTheMiddle(state, SCAN_SOFTNESS), 0.5, state);
    expect(state.scanBright[1]).toBeCloseTo(SCAN_STRETCH / Math.E, 12);
    scanned(0, downTheMiddle(state, 2), 0.5, state);
    expect(state.scanBright[1]).toBeLessThan(1e-12);
  });

  it('promotes nothing and stretches nothing when he is not thinking, even in the middle of where the band would be', () => {
    const hops = hopsOfTheScene();
    for (const time of [0, 41.2, SCAN_SECONDS / 2]) {
      const thinking = analyseFrame(frameAt({ time, thinking: 1 }), SIZE);
      const calm = analyseFrame(frameAt({ time }), SIZE);
      // The calm frame works out the same band, which a thought would light.
      expect(calm.scan).toBe(thinking.scan);
      let promotedWhileThinking = 0;
      for (const hop of hops) {
        for (const apart of [0, 0.1, 0.3]) {
          // Asked of a thought first, so a promotion left behind in the scratch would show.
          scanned(0.1, downTheMiddle(thinking, apart), hop, thinking);
          promotedWhileThinking += thinking.scanBright[0] ?? 0;
          calm.scanBright[0] = thinking.scanBright[0] ?? 0;
          calm.scanBright[1] = thinking.scanBright[1] ?? 0;
          expect(scanned(0.1, downTheMiddle(calm, apart), hop, calm)).toBe(1);
          expect(calm.scanBright).toEqual([0, 0]);
        }
      }
      expect(promotedWhileThinking).toBeGreaterThan(1000);
    }
  });

  it('recedes the aura, the cage and the core’s glow by THOUGHT_PICTURE_DIMMING, and leaves the white-hot ring be', () => {
    const calm = analyseFrame(frameAt({ time: 12 }), SIZE);
    const thinking = analyseFrame(frameAt({ time: 12, thinking: 1 }), SIZE);
    expect(thinking.auraAlpha).toBeCloseTo(calm.auraAlpha * (1 - THOUGHT_PICTURE_DIMMING), 12);
    expect(thinking.cageAlpha).toBeCloseTo(calm.cageAlpha * (1 - THOUGHT_PICTURE_DIMMING), 12);
    expect(thinking.coreGlow).toBeCloseTo(calm.coreGlow * (1 - THOUGHT_PICTURE_DIMMING), 12);
    expect(thinking.coreAlpha).toBe(calm.coreAlpha);
    // By a third or so: by a half, with his specks put out to an eighth, a thought read as dull; and
    // not at all, it would be lit like a calm moment and say nothing.
    expect(THOUGHT_PICTURE_DIMMING).toBeGreaterThan(0.2);
    expect(THOUGHT_PICTURE_DIMMING).toBeLessThan(0.5);
  });
});
