import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, hologramFrameOf, restartArrival } from './frame-clock';
import {
  analyseFrame,
  arrivalOf,
  BODY_TURN_SECONDS,
  bodyTurnRadians,
  CAGE_EDGE_STRIDE,
  CAGE_LONGEST_SPIKE,
  CAGE_SHELL_OUTER,
  CAGE_WOVEN_REACH,
  createHologramScene,
  EMBER_RISE,
  EMBER_STRIDE,
  type HologramFrame,
  PARTICLE_COUNT,
  PICTURE_SHELL_EDGE,
  ROLL_DEGREES_PER_SECOND,
  SHELL_DEGREES_PER_SECOND,
  swirlFragment,
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

  /** Every edge of the cage as its two ends. */
  const cageEdges = () => {
    const edges: number[][][] = [];
    for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
      edges.push([scene.cage.slice(offset, offset + 3), scene.cage.slice(offset + 3, offset + 6)]);
    }
    return edges;
  };

  it('keeps the cage and the embers well inside his square, which ends about 1.8R out', () => {
    // They are always there, and he swells by up to a fifth while he talks, so neither may come near
    // the square's edge: the cage reaches 1.4R at most, and an ember has gone by 1.45R.
    const farthestNode = Math.max(...cageEdges().flatMap((ends) => ends.map((end) => Math.hypot(...end))));
    let farthestEmber = 0;
    for (let offset = 0; offset < scene.embers.length; offset += EMBER_STRIDE) {
      farthestEmber = Math.max(farthestEmber, scene.embers[offset + 1] + (1 + EMBER_RISE) * scene.embers[offset + 2]);
    }

    expect(farthestNode).toBeLessThanOrEqual(1.4 + 1e-4);
    expect(farthestEmber).toBeLessThanOrEqual(1.45 + 1e-4);
  });

  it("weaves the cage densely round the shell of specks, as the film's wireframe hugs it", () => {
    const edges = cageEdges();
    const middles = edges.map(([from = [], to = []]) =>
      Math.hypot(...from.map((value, axis) => (value + (to[axis] ?? 0)) / 2)),
    );
    const hugging = middles.filter((middle) => middle >= 0.85 && middle <= 1.2);

    // Twice the 132 edges it had when it first replaced the Age of Ultron rim, which read as sparse.
    expect(edges.length).toBeGreaterThan(250);
    expect(hugging.length / edges.length).toBeGreaterThan(0.75);
  });

  it('trails nothing below him that could read as a limb: the lines there are single strokes', () => {
    // The tail it used to trail was a chain with a branch off it, which read as legs. Below the
    // cage's shell, which hugs the specks to 1.2R, no point is now the end of more than one edge.
    const below = cageEdges()
      .flat()
      .filter((end) => (end[1] ?? 0) > 1.2);
    const keys = below.map((end) => end.join(','));

    expect(below.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /** Every edge of the cage as its two ends, its far end as written, and how lit that far end is. */
  const cageStrokes = () => {
    const strokes: { from: number[]; to: number[]; farLight: number }[] = [];
    for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
      strokes.push({
        from: scene.cage.slice(offset, offset + 3),
        to: scene.cage.slice(offset + 3, offset + 6),
        farLight: scene.cage[offset + 9] ?? 1,
      });
    }
    return strokes;
  };
  /** How many of the cage's edges end at each of its points. */
  const endsAt = () => {
    const counts = new Map<string, number>();
    for (const { from, to } of cageStrokes()) {
      for (const end of [from, to]) counts.set(end.join(','), (counts.get(end.join(',')) ?? 0) + 1);
    }
    return counts;
  };

  it('stands nothing off him past its weave but single strokes: short spikes, and the trails fading away', () => {
    // The cage turns with his body. It used to run long chords out to 1.4R as well, joined into
    // polylines held to the shell at one end, and turning with him they swung round him as hooks
    // and arms — what the user had had taken away once already. Past the nodes woven over its shell
    // there is now nothing but single strokes, each running out to a tip of its own that it fades
    // towards: a spike, never long, or a trail, faded to nothing.
    const counts = endsAt();
    const outside = cageStrokes().filter(
      ({ from, to }) => Math.max(Math.hypot(...from), Math.hypot(...to)) > CAGE_WOVEN_REACH,
    );

    expect(outside.length).toBeGreaterThan(0);
    for (const { from, to, farLight } of outside) {
      const length = Math.hypot(...to.map((value, axis) => value - (from[axis] ?? 0)));
      expect(Math.hypot(...from)).toBeLessThanOrEqual(CAGE_WOVEN_REACH);
      expect(counts.get(to.join(','))).toBe(1);
      expect(farLight).toBeLessThan(1);
      expect(farLight === 0 || length <= CAGE_LONGEST_SPIKE + 1e-4).toBe(true);
    }
  });

  it('ties every node woven over its shell back down to it twice, so nothing round him has a loose end', () => {
    // A chain of lines out past the shell held at one end only is a hook. Every point of the cage
    // between its shell's nodes and the end of its weave — but the tip of a trail fading away — is
    // held by at least two lines to points nearer him.
    const nearer = new Map<string, number>();
    const strokes = cageStrokes();
    for (const { from, to } of strokes) {
      if (Math.hypot(...from) > Math.hypot(...to)) nearer.set(from.join(','), (nearer.get(from.join(',')) ?? 0) + 1);
      if (Math.hypot(...to) > Math.hypot(...from)) nearer.set(to.join(','), (nearer.get(to.join(',')) ?? 0) + 1);
    }
    const fadingTips = new Set(strokes.filter(({ farLight }) => farLight < 1).map(({ to }) => to.join(',')));
    const woven = [...endsAt().keys()].filter((key) => {
      const radius = Math.hypot(...key.split(',').map(Number));
      return radius > CAGE_SHELL_OUTER + 1e-4 && radius <= CAGE_WOVEN_REACH && !fadingTips.has(key);
    });

    expect(woven.length).toBeGreaterThan(20);
    for (const key of woven) expect(nearer.get(key) ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('draws the cage and the embers from generators of their own, so the rest of the scene never moves them', () => {
    // They used to be drawn from the scene's main generator after everything else, so taking
    // anything out of the scene before them — the slow script, which the picture no longer reads —
    // would have reshuffled every edge and ember. Seeded apart, as the body is, the same seed builds
    // the same cage and embers whatever the main generator is asked for: these are their first rows
    // for this seed, and they move only when the cage or the embers themselves are redrawn.
    expect(scene.cage.slice(0, CAGE_EDGE_STRIDE)).toEqual([
      0.85967, -0.38543, -0.36993, 0.73579, -0.42982, -0.39446, 0.1043, 0.86953, 0.76642, 1,
    ]);
    expect(scene.embers.slice(0, EMBER_STRIDE)).toEqual([0.45383, 0.80972, 0.225, 4.10875, 0.14711, 0.00652, 0.97971]);
  });

  it('arrives out of the core: the core first, on its own, the aura with his body, the cage last', () => {
    const early = stateOf({ appearance: 0.12 });
    // the vortex has yet to carry any of the specks out of the core: nothing to glow round
    const gathered = stateOf({ appearance: 0.35 });
    const halfway = stateOf({ appearance: 0.6 });
    const formed = stateOf({});

    expect(early.coreAlpha).toBeGreaterThan(0);
    expect([early.auraAlpha, early.cageAlpha, gathered.auraAlpha, gathered.cageAlpha]).toEqual([0, 0, 0, 0]);
    expect(gathered.coreAlpha).toBeGreaterThan(0.9);
    expect(halfway.auraAlpha).toBeGreaterThan(0);
    expect(halfway.cageAlpha).toBeGreaterThan(0);
    expect(halfway.cageAlpha).toBeLessThan(halfway.auraAlpha);
    expect([formed.coreAlpha, formed.auraAlpha, formed.cageAlpha, formed.shellReach]).toEqual([1, 1, 1, 1]);
  });

  it('carries the aura, the cage and the embers out of the core with his shell of specks', () => {
    // The aura is brightest on the shell's edge at rest. While he arrives it is carried out with the
    // specks, lying among those the vortex has brought out so far: between where it has brought one
    // from the middle of the shell and one from its edge, give or take 0.07R. An id whose share of
    // the vortex's order is the middle one, as most of the shell's is.
    const id = 0.5 / 3.91;
    const reachOf = (state: ReturnType<typeof stateOf>, x: number) => {
      swirlFragment(x, 0, 1, 0, id, state);
      return Math.hypot(state.swirled[0] ?? 0, state.swirled[1] ?? 0);
    };
    for (let appearance = 0.3; appearance <= 1; appearance += 0.025) {
      const state = stateOf({ appearance });
      const edge = reachOf(state, PICTURE_SHELL_EDGE);
      const middle = reachOf(state, 0.6);
      const aura = PICTURE_SHELL_EDGE * state.shellReach;

      expect(aura).toBeGreaterThan(Math.min(edge, middle) - 0.07);
      expect(aura).toBeLessThan(Math.max(edge, middle) + 0.07);
    }
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
