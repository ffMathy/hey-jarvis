import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, hologramFrameOf, restartArrival } from './frame-clock';
import {
  analyseFrame,
  arrivalOf,
  BODY_TURN_SECONDS,
  bodyTurnRadians,
  CAGE_EDGE_STRIDE,
  createHologramScene,
  EMBER_RISE,
  EMBER_STRIDE,
  type HologramFrame,
  PARTICLE_COUNT,
  ROLL_DEGREES_PER_SECOND,
  SHELL_DEGREES_PER_SECOND,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * The scene he is drawn from and what a frame of him is. What he looks like drawn — golden, moving,
 * arriving without a flash, staying inside his square — needs a GPU, so it is the headset's browser
 * tests' to say, on the very picture the apps draw (`vr/tests/e2e/hologram-picture-behaviour.spec.ts`).
 */

const SEED = 1337;
const SIZE = 256;

describe('the hologram', () => {
  it('builds the same scene from the same seed, so it looks the same every time the app opens', () => {
    expect(JSON.stringify(createHologramScene(SEED))).toBe(JSON.stringify(createHologramScene(SEED)));
  });

  it('turns its body about the vertical axis, once every BODY_TURN_SECONDS', () => {
    // The ball itself turning is what says it is alive, so the rate is pinned rather than left
    // to a constant nobody would notice going to zero. It is a globe spin, not a roll in the
    // screen plane, so it leaves no single angle for the rim check below to find — which is why
    // that check no longer looks at the body at all.
    expect(bodyTurnRadians(0)).toBe(0);
    expect(bodyTurnRadians(BODY_TURN_SECONDS)).toBeCloseTo(2 * Math.PI, 6);
    expect(bodyTurnRadians(BODY_TURN_SECONDS / 4)).toBeCloseTo(Math.PI / 2, 6);
    // and it never stalls or runs backwards
    let previous = -1;
    for (let time = 0; time <= 30; time += 0.25) {
      const turn = bodyTurnRadians(time);
      expect(turn).toBeGreaterThan(previous);
      previous = turn;
    }
  });

  it("turns its inner shells against the core ring's roll, at the rate the film measured", () => {
    // This used to be checked in the pixels, as "the band round the core must not follow the
    // rim". That band is full of the fragment body, and the body now turns about the vertical
    // axis on purpose, so a rotation estimator pointed at it is reading the body rather than the
    // shells and answers differently as the texture changes — it moved from 2.0 to 2.5 when the
    // halo became a ramp, which says nothing about whether anything follows the rim.
    //
    // What the design actually promises is here instead: the shells turn back at the -2 to -6°/s
    // the film measured (section 3), and the core ring's bright stretches roll the other way, at
    // the rate the rim it replaced rolled at.
    expect(SHELL_DEGREES_PER_SECOND).toBeLessThan(0);
    expect(SHELL_DEGREES_PER_SECOND).toBeGreaterThanOrEqual(-6);
    expect(ROLL_DEGREES_PER_SECOND).toBeGreaterThan(0);
  });

  it('can be built with far fewer particles, which is what makes a smaller scene cheaper to mount', () => {
    // The scene is built, put in the share's order and serialised into the worklet runtime at mount,
    // whatever share of it is drawn. That cost cannot be steered away from, which is why the view
    // takes a `particleCount` rather than relying on a lower share.
    const watchSized = createHologramScene(SEED, 1200);

    expect(watchSized.body.length).toBeLessThan(createHologramScene(SEED).body.length);
    // And it is still him: the rim, the stream and the rest do not thin with the body.
    expect(watchSized.stream.length).toBe(createHologramScene(SEED).stream.length);
    expect(watchSized.body.length).toBeGreaterThan(0);
  });

  it('can be built with more particles than any phone is given', () => {
    // Nothing about the scene knows what a phone can hold, so a renderer with no frame to hit can
    // ask for whatever it likes above the apps' ceiling — see `hologram/.scripts/render-showcase.ts`,
    // which does exactly that for its cover. The parameter is the *body*, which is nearly all of
    // him; the rim, the stream and the rest are fixed, so this asks that more were asked for and
    // more arrived, rather than for an exact multiple.
    const asked = PARTICLE_COUNT * 1.3;
    const bigger = createHologramScene(SEED, asked);

    expect(bigger.body.length).toBeGreaterThan(createHologramScene(SEED).body.length);
    // Every fragment is the same number of values wide, so the count is exactly proportional.
    expect(bigger.body.length).toBe(Math.round(createHologramScene(SEED).body.length * 1.3));
  });
});

describe('how much of him shows', () => {
  it('is the arrival analyseFrame works out, all the way through arriving, staying and leaving', () => {
    // A guard against analyseFrame working its arrival out again for itself, which could drift.
    const scene = createHologramScene(SEED);
    const frames = framesFromTheClock();
    const arrivals = frames.map((frame) => arrivalOf(frame.appearance, frame.presence));
    const analysed = frames.map((frame) => analyseFrame(frame, SIZE, scene).arrival);

    expect(arrivals.every((arrival, index) => Object.is(arrival, analysed[index]))).toBe(true);
    // Through all of it: not there, partly there and wholly there.
    expect(arrivals).toContain(0);
    expect(arrivals).toContain(1);
    expect(arrivals.some((arrival) => arrival > 0 && arrival < 1)).toBe(true);
  });

  it('is the arrival as it was before it was taken out of analyseFrame: out of range, not a number, infinite', () => {
    for (const appearance of [-1, 0, 0.05, 0.1, 0.2, 1, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const presence of [-1, 0, 0.3, 1, 2, Number.NaN, Number.NEGATIVE_INFINITY]) {
        expect(Object.is(arrivalOf(appearance, presence), arrivalAsItWas(appearance, presence))).toBe(true);
      }
    }
  });

  it('fades the whole of him in over the first fifth of the vortex, and out with his presence', () => {
    expect(arrivalOf(0, 1)).toBe(0);
    expect(arrivalOf(0.1, 1)).toBe(0.5);
    expect(arrivalOf(0.2, 1)).toBe(1);
    expect(arrivalOf(1, 0.3)).toBe(0.3);
  });
});

describe('the picture round him', () => {
  const scene = createHologramScene(SEED);
  const quiet: HologramFrame = {
    time: 6,
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
  };
  const stateOf = (changes: Partial<HologramFrame>) => analyseFrame({ ...quiet, ...changes }, SIZE, scene);

  it('keeps the cage and the embers well inside his square, which ends about 1.8R out', () => {
    // They are always there, and he swells by up to a fifth while he talks, so neither may come near
    // the square's edge: the cage's tail reaches 1.4R at most, and an ember has gone by 1.45R.
    let farthestNode = 0;
    for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
      for (const end of [offset, offset + 3]) {
        farthestNode = Math.max(farthestNode, Math.hypot(scene.cage[end], scene.cage[end + 1], scene.cage[end + 2]));
      }
    }
    let farthestEmber = 0;
    for (let offset = 0; offset < scene.embers.length; offset += EMBER_STRIDE) {
      farthestEmber = Math.max(farthestEmber, scene.embers[offset + 1] + (1 + EMBER_RISE) * scene.embers[offset + 2]);
    }

    expect(scene.cage.length).toBeGreaterThan(100 * CAGE_EDGE_STRIDE);
    expect(farthestNode).toBeLessThanOrEqual(1.4 + 1e-4);
    expect(farthestEmber).toBeLessThanOrEqual(1.45 + 1e-4);
  });

  it('arrives out of the core: the core first, the aura as the particles leave it, the cage last', () => {
    const early = stateOf({ appearance: 0.12 });
    const halfway = stateOf({ appearance: 0.5 });
    const formed = stateOf({});

    expect(early.coreAlpha).toBeGreaterThan(0);
    expect(early.auraAlpha).toBe(0);
    expect(halfway.auraAlpha).toBeGreaterThan(0);
    expect(halfway.cageAlpha).toBe(0);
    expect([formed.coreAlpha, formed.auraAlpha, formed.cageAlpha]).toEqual([1, 1, 1]);
  });

  it('dims all but the white-hot ring while he thinks, and shows more embers while he talks', () => {
    const calm = stateOf({});
    const thinking = stateOf({ thinking: 1 });
    const talking = stateOf({ agitation: 1, level: 0.7, speaking: true });

    expect(thinking.coreAlpha).toBe(calm.coreAlpha);
    expect(thinking.coreGlow).toBeLessThan(calm.coreGlow);
    expect(thinking.auraAlpha).toBeLessThan(calm.auraAlpha);
    expect(thinking.cageAlpha).toBeLessThan(calm.cageAlpha);
    expect(talking.emberShare).toBeGreaterThan(calm.emberShare);
  });
});

/**
 * The arrival as `analyseFrame` worked it out before `arrivalOf` was taken out of it, with the two
 * helpers it read copied line for line, as the reference `arrivalOf` is held to. It is frozen on
 * purpose: the phone and the watch must not fade him differently because the code moved.
 */
function arrivalAsItWas(appearance: number, presence: number) {
  const clamp01 = (value: number) => (value > 0 ? (value > 1 ? 1 : value) : 0);
  const smooth01 = (value: number) => {
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
    return clamped * clamped * (3 - 2 * clamped);
  };
  const swirl = clamp01(appearance);
  return smooth01(swirl / 0.2) * clamp01(presence);
}

/**
 * The frames the frame clock hands the drawing at 60 a second through two arrivals that stay and two
 * that leave halfway through: each one copied, since the clock's frame is only good until its next step.
 */
function framesFromTheClock(): HologramFrame[] {
  const clock = createFrameClockState();
  const silent = new Array(VOICE_BAND_COUNT).fill(0);
  const frames: HologramFrame[] = [];
  for (const leaving of [false, true, false, true]) {
    restartArrival(clock);
    for (let step = 0; step < 90; step++) {
      advanceFrameClock(clock, 1 / 60, 0, silent, false, false, leaving && step > 45, 0, 0);
      const frame = hologramFrameOf(clock);
      frames.push({ ...frame, bands: [...frame.bands] });
    }
  }
  return frames;
}
