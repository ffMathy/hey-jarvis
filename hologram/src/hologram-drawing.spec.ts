import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, hologramFrameOf, restartArrival } from './frame-clock';
import {
  analyseFrame,
  arrivalOf,
  BODY_STRIDE,
  BODY_TURN_SECONDS,
  bodyTurnRadians,
  CAGE_EDGE_STRIDE,
  CAGE_LONGEST_SPIKE,
  CAGE_SHELL_OUTER,
  CAGE_WOVEN_REACH,
  CORE_X,
  CORE_Y,
  createHologramScene,
  createRandom,
  EMBER_RISE,
  EMBER_STRIDE,
  FRAGMENT_CODE_GLYPH_STEP,
  FRAGMENT_GROUP_STEP,
  fragmentGroup,
  GYRO_ARCS,
  GYRO_GIMBAL_SPLIT,
  GYRO_GROUP,
  type HologramFrame,
  PARTICLE_COUNT,
  PICTURE_SHELL_EDGE,
  placeFragment,
  pushGyroSpeck,
  RIM_ROLL_DEGREES_PER_SECOND,
  ROLL_DEGREES_PER_SECOND,
  readFragment,
  ringDirection,
  SHELL_DEGREES_PER_SECOND,
  swirlFragment,
  TRUSS_INNER_RAIL,
  TRUSS_OUTER_RAIL,
  TRUSS_PIECE_STRIDE,
  thoughtTurn,
  turnOfGroup,
  WHORL_REACH,
  WHORL_START,
  WHORL_TURNS,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * The scene he is drawn from and what a frame of him is. What he looks like drawn — red-orange, moving,
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
    // to a constant nobody would notice going to zero.
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

  it("turns its inner layer against the core ring's roll, at the rate the film measured", () => {
    // This used to be checked in the pixels, as "the band round the core must not follow the
    // rim". That band is full of the fragment body, and the body now turns about the vertical
    // axis on purpose, so a rotation estimator pointed at it is reading the body rather than the
    // inner layer and answers differently as the texture changes — it moved from 2.0 to 2.5 when
    // the halo became a ramp, which says nothing about whether anything follows the rim.
    //
    // What the design actually promises is here instead: the inner layer turns back at the -2 to
    // -6°/s the Age of Ultron footage measured, and the core ring's bright stretches roll the other
    // way, at the rate the rim it replaced rolled at.
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
    // And it is still him: the stream, the cage and the rest do not thin with the body.
    expect(watchSized.stream.length).toBe(createHologramScene(SEED).stream.length);
    expect(watchSized.body.length).toBeGreaterThan(0);
  });

  it('can be built with more particles than any phone is given', () => {
    // Nothing about the scene knows what a phone can hold, so a renderer with no frame to hit can
    // ask for whatever it likes above the apps' ceiling — see `hologram/.scripts/render-showcase.ts`,
    // which does exactly that for its cover. The parameter is the *body*, which is nearly all of
    // him; the stream, the cage and the rest are fixed, so this asks that more were asked for and
    // more arrived, rather than for an exact multiple.
    const asked = PARTICLE_COUNT * 1.3;
    const bigger = createHologramScene(SEED, asked);

    expect(bigger.body.length).toBeGreaterThan(createHologramScene(SEED).body.length);
    // Every fragment is the same number of values wide, so the count is exactly proportional.
    expect(bigger.body.length).toBe(Math.round(createHologramScene(SEED).body.length * 1.3));
  });
});

/** A body table's rows, each where it rests seen face on, relative to the core, with its class. */
function rowsOf(body: number[]) {
  const rows: {
    x: number;
    y: number;
    fromTheCore: number;
    clockDegrees: number;
    group: number;
    innerLayer: boolean;
    bright: boolean;
    glyph: number;
  }[] = [];
  for (let offset = 0; offset < body.length; offset += BODY_STRIDE) {
    const x = body[offset] - CORE_X;
    const y = body[offset + 1] - CORE_Y;
    const code = body[offset + 7];
    const kind = code % FRAGMENT_CODE_GLYPH_STEP;
    rows.push({
      x,
      y,
      fromTheCore: Math.hypot(x, y),
      // clockwise from 12 o'clock, y down
      clockDegrees: ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360,
      group: fragmentGroup(code),
      // the whorl's and the gyroscope's: round the core, held in the plane of the view
      innerLayer: fragmentGroup(code) === 1 || fragmentGroup(code) === GYRO_GROUP,
      bright: kind % 3 === 2,
      glyph: Math.floor(code / FRAGMENT_CODE_GLYPH_STEP),
    });
  }
  return rows;
}

/** Points along the whorl's two arms' centre curves, relative to the core, each with how far out along its arm it is. */
const WHORL_CURVE = Array.from({ length: 4001 }, (_, step) => step / 4000).flatMap((out) =>
  [0, Math.PI].map((arm) => {
    const reach = WHORL_START + (WHORL_REACH - WHORL_START) * out;
    const angle = arm + WHORL_TURNS * 2 * Math.PI * out;
    return { x: reach * Math.cos(angle), y: reach * Math.sin(angle), out };
  }),
);

/** Where a row lies against the whorl: how far it is from the nearest arm's centre curve, and how far out along that arm. */
function againstTheArm(row: { x: number; y: number }) {
  let distance = Number.POSITIVE_INFINITY;
  let out = 0;
  for (const point of WHORL_CURVE) {
    const apart = Math.hypot(point.x - row.x, point.y - row.y);
    if (apart < distance) {
      distance = apart;
      out = point.out;
    }
  }
  return { distance, out };
}

/** How long an arm is between two steps of `out`, in R. */
function armLength(from: number, to: number) {
  const steps = 1000;
  let length = 0;
  for (let step = 0; step < steps; step++) {
    const out = from + ((to - from) * (step + 0.5)) / steps;
    const reach = WHORL_START + (WHORL_REACH - WHORL_START) * out;
    length += Math.hypot(WHORL_REACH - WHORL_START, reach * WHORL_TURNS * 2 * Math.PI) * ((to - from) / steps);
  }
  return length;
}

describe('his middle: the whorl and the gyroscope', () => {
  const rows = rowsOf(createHologramScene(SEED).body);
  const innerLayer = rows.filter((row) => row.innerLayer);

  it('still has exactly PARTICLE_COUNT specks, however many go to the whorl and the gyroscope', () => {
    // Their rows come out of the fill's and the shell's: ten thousand at most, as the user asked.
    expect(rows.length).toBe(PARTICLE_COUNT);
    // Over four in ten ride the inner layer (measured 43.6%), and the rest still fill the ball.
    expect(innerLayer.length / rows.length).toBeGreaterThan(0.35);
    expect(innerLayer.length / rows.length).toBeLessThan(0.5);
  });

  it("winds the whorl's arms out from just outside the core's eye, with no knot inside it", () => {
    // "The spiral is too sharp": its arms began at 0.04R and knotted into a white S inside the core's
    // ring, 119 specks inside 0.06R. They begin at 0.1R now, so only an arm's spread reaches in.
    const inside = (reach: number) => innerLayer.filter((row) => row.fromTheCore < reach).length;
    // measured 0 inside 0.06R, and 3 inside 0.08R
    expect(inside(0.06)).toBeLessThanOrEqual(5);
    expect(inside(0.08)).toBeLessThanOrEqual(15);
    // and the arms are there just outside it (measured 251 between 0.1R and 0.2R)
    expect(innerLayer.filter((row) => row.fromTheCore >= 0.1 && row.fromTheCore < 0.2).length).toBeGreaterThan(150);
  });

  it("lights few of the whorl's specks, so the swirl is mid-toned and never white", () => {
    // Three in ten of its specks were bright, each with a hot core, and its arms clipped to white.
    // Measured 6.0% of the inner layer, with the gyroscope's brighter strands among them.
    const bright = innerLayer.filter((row) => row.bright).length;
    expect(bright / innerLayer.length).toBeLessThan(0.1);
  });

  it("spreads the whorl's arms broad, with a soft skirt, so the swirl is soft rather than sharp", () => {
    // "The spiral is too sharp": the arm was 0.025R wide at the core and had no skirt. Between 0.3R
    // and 0.5R, clear of the gyroscope, every inner-layer row is the whorl's. Measured a root mean
    // square of 0.048R off the arm's centre curve, and 20% of them more than 0.06R off it; a narrow
    // arm (a spread of 0.01 + 0.065·out, or 0.04 + 0.02·out) or no skirt measured 0.030-0.035R and
    // 6-9%. Not so broad that the spiral is lost at phone size, either.
    const apart = innerLayer
      .filter((row) => row.fromTheCore >= 0.3 && row.fromTheCore < 0.5)
      .map((row) => againstTheArm(row).distance);
    const rootMeanSquare = Math.sqrt(apart.reduce((total, distance) => total + distance * distance, 0) / apart.length);
    expect(rootMeanSquare).toBeGreaterThan(0.042);
    expect(rootMeanSquare).toBeLessThan(0.055);
    expect(apart.filter((distance) => distance > 0.06).length / apart.length).toBeGreaterThan(0.15);
  });

  it("spreads the whorl's specks evenly along its arms, so they do not crowd its start", () => {
    // An even step along the arm crowded its start, where it is shortest per step: per R of arm,
    // the stretch just out of the core's eye was 2.2 times as dense as the arm at 0.37-0.44R. Spread
    // by WHORL_OUT_POWER it measures 1.45.
    const along = innerLayer.filter((row) => row.fromTheCore < 0.5).map((row) => againstTheArm(row).out);
    const density = (from: number, to: number) =>
      along.filter((out) => out >= from && out < to).length / armLength(from, to);
    expect(density(0.05, 0.15) / density(0.4, 0.5)).toBeLessThan(1.8);
  });

  it("draws the gyroscope's arcs in his scene, standing out of the whorl that shares their layer", () => {
    // At each arc's radius, the inner layer's rows inside the arcs' sweeps over what the same
    // stretch of clock off them holds: the whorl's arms cross every radius, so only the arcs make
    // the difference. Measured 584 rows over at 0.53R and 444 at 0.67R; without the arcs, the
    // whorl alone leaves 195 and 42.
    for (const radius of new Set(GYRO_ARCS.map(([arcRadius]) => arcRadius))) {
      const arcs = GYRO_ARCS.filter(([arcRadius]) => arcRadius === radius);
      const onTheArcs = (clock: number) => arcs.some(([, from, sweep]) => (clock - from + 360) % 360 <= sweep);
      const swept = arcs.reduce((total, [, , sweep]) => total + sweep, 0);
      const ring = innerLayer.filter((row) => Math.abs(row.fromTheCore - radius) <= 0.03);
      const on = ring.filter((row) => onTheArcs(row.clockDegrees)).length;
      const off = ring.length - on;
      const over = on - (off * swept) / (360 - swept);
      expect(over).toBeGreaterThan(radius < 0.6 ? 400 : 300);
    }
  });

  it("lays the gyroscope's strands on its arcs round the core, on the inner layer, clear of the core's ring", () => {
    const random = createRandom(SEED);
    const body: number[] = [];
    const shape = [0, 0];
    for (let speck = 0; speck < 3000; speck++) pushGyroSpeck(random, body, shape);
    const specks = rowsOf(body);
    // Within 0.03R of the arc's radius (measured 0.020R at most), and inside its sweep.
    const liesOn = (speck: (typeof specks)[number], [radius, from, sweep]: (typeof GYRO_ARCS)[number]) =>
      Math.abs(speck.fromTheCore - radius) <= 0.03 && (speck.clockDegrees - from + 360) % 360 <= sweep + 0.5;

    for (const speck of specks) {
      // In a group of their own, held in the view plane as the whorl is, so the arcs turn with the
      // swirl, rock with his voice and stay arcs however far the globe turns.
      expect(speck.group).toBe(GYRO_GROUP);
      // A dash: a strand reads as a line.
      expect(speck.glyph).toBe(0);
      expect(GYRO_ARCS.some((arc) => liesOn(speck, arc))).toBe(true);
      // Never inside 0.45R, round the core's ring, which is Vision Quest's (measured 0.51R at the
      // nearest), and never out past the shell's edge.
      expect(speck.fromTheCore).toBeGreaterThan(0.45);
      expect(speck.fromTheCore).toBeLessThan(PICTURE_SHELL_EDGE);
    }
    // Every arc has its strands (measured 936, 575 and 1489 of the 3000).
    for (const arc of GYRO_ARCS) {
      expect(specks.filter((speck) => liesOn(speck, arc)).length).toBeGreaterThan(300);
    }
  });
});

describe('the gyroscope while he talks', () => {
  const frameAt = (time: number, agitation: number): HologramFrame => ({
    time,
    level: agitation * 0.6,
    bands: new Array(VOICE_BAND_COUNT).fill(0.3),
    speaking: agitation > 0,
    agitation,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    presence: 1,
    thinking: 0,
  });
  const inner = GYRO_GIMBAL_SPLIT - 0.07;
  const outer = GYRO_GIMBAL_SPLIT + 0.07;
  /** The smallest angle between two turns, in degrees. */
  const apart = (first: number, second: number) => Math.abs(((first - second + 540) % 360) - 180);

  it('turns the arcs with the whorl while he is silent', () => {
    for (const time of [3, 7.7, 12.1, 40.25]) {
      const state = analyseFrame(frameAt(time, 0), SIZE);
      // no sway at all (a zero of either sign)
      expect(state.gyroSway === 0).toBe(true);
      expect(turnOfGroup(GYRO_GROUP, inner, state)).toBe(state.shellTurn);
      expect(turnOfGroup(GYRO_GROUP, outer, state)).toBe(state.shellTurn);
    }
  });

  it('rocks the arcs with his voice, calmly, the inner ones against the outer like a gimbal', () => {
    // "The arcs around his core need to also move when talking." Analytic in the frame, so nothing
    // is remembered between frames: at full agitation the sway swings 25-45° either way of the
    // whorl's turn and never moves faster than a calm 1.5° a frame at 60 fps.
    const sways: number[] = [];
    for (let frame = 0; frame <= 60 * 20; frame++) {
      const state = analyseFrame(frameAt(10 + frame / 60, 1), SIZE);
      sways.push(state.gyroSway);
      expect(apart(turnOfGroup(GYRO_GROUP, inner, state), state.shellTurn + state.gyroSway)).toBeLessThan(1e-9);
      expect(apart(turnOfGroup(GYRO_GROUP, outer, state), state.shellTurn - state.gyroSway)).toBeLessThan(1e-9);
      // only the arcs rock: the whorl turns as it did
      expect(turnOfGroup(1, inner, state)).toBe(state.shellTurn);
    }
    expect(Math.max(...sways)).toBeGreaterThan(25);
    expect(Math.min(...sways)).toBeLessThan(-25);
    expect(Math.max(...sways.map(Math.abs))).toBeLessThan(45);
    const steps = sways.slice(1).map((sway, index) => Math.abs(sway - (sways[index] ?? 0)));
    expect(Math.max(...steps)).toBeLessThan(1.5);
  });

  it('eases the rocking in with his voice rather than jumping to it', () => {
    // Half as agitated, half the sway, so the eased envelope is what brings it in.
    let largest = 0;
    for (let time = 10; time < 14; time += 0.1) {
      const full = analyseFrame(frameAt(time, 1), SIZE);
      const half = analyseFrame(frameAt(time, 0.5), SIZE);
      expect(half.gyroSway).toBeCloseTo(full.gyroSway / 2, 9);
      largest = Math.max(largest, Math.abs(full.gyroSway));
    }
    expect(largest).toBeGreaterThan(20);
  });
});

describe('his specks while he thinks', () => {
  const frameAt = (thinking: number): HologramFrame => ({
    time: 20,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    presence: 1,
    thinking,
  });
  const hops = Array.from({ length: 2000 }, (_, index) => (index + 0.5) / 2000);

  it('lie as they always do when he is not thinking', () => {
    const state = analyseFrame(frameAt(0), SIZE);
    for (const hop of hops) expect(thoughtTurn(hop, 0, state) === 0).toBe(true);
  });

  it('point every which way while he thinks, dealt afresh each time a speck re-lights', () => {
    // "While thinking, the direction of the glow lines should randomize": each speck is turned by up
    // to a quarter turn either way, by a hash of where its blink re-lights it, so the angle is dealt
    // again on every blink rather than combed once. Spread evenly over ±90°.
    const state = analyseFrame(frameAt(1), SIZE);
    const turns = hops.map((hop) => thoughtTurn(hop, 0, state));
    expect(Math.max(...turns)).toBeLessThanOrEqual(Math.PI / 2);
    expect(Math.min(...turns)).toBeGreaterThanOrEqual(-Math.PI / 2);
    for (let quarter = 0; quarter < 4; quarter++) {
      const from = -Math.PI / 2 + (quarter * Math.PI) / 4;
      const inQuarter = turns.filter((turn) => turn >= from && turn < from + Math.PI / 4).length;
      expect(inQuarter / turns.length).toBeGreaterThan(0.2);
      expect(inQuarter / turns.length).toBeLessThan(0.3);
    }
    // The same speck on its next blinks — the hop steps by the golden ratio — lies some other way.
    const id = 0.4127;
    const blinks = [0, 1, 2, 3].map((cycle) => thoughtTurn((cycle * 0.618034 + id * 9.7) % 1, 0, state));
    for (let blink = 1; blink < blinks.length; blink++) {
      expect(Math.abs((blinks[blink] ?? 0) - (blinks[blink - 1] ?? 0))).toBeGreaterThan(0.05);
    }
    // Half thinking, half as far: it eases in with the thought.
    const half = analyseFrame(frameAt(0.5), SIZE);
    for (const hop of hops.slice(0, 50)) {
      expect(thoughtTurn(hop, 0, half)).toBeCloseTo(thoughtTurn(hop, 0, state) / 2, 12);
    }
  });

  it('turns the way a speck lies, and so its slide, by that angle where it is placed', () => {
    const scene = createHologramScene(SEED);
    const thinking = analyseFrame(frameAt(1), SIZE);
    const out = [0, 0, 0, 0, 0, 0, 0];
    const ring = [0, 0];
    let turned = 0;
    for (let offset = 0; offset < BODY_STRIDE * 400; offset += BODY_STRIDE) {
      const hop = ((offset / BODY_STRIDE) * 0.377) % 1;
      const group = fragmentGroup(scene.body[offset + 7] ?? 0);
      placeFragment(scene.body, offset, hop, thinking, out);
      const restX =
        group > 0
          ? (scene.body[offset] ?? 0)
          : (scene.body[offset] ?? 0) * thinking.bodyCos + (scene.body[offset + 8] ?? 0) * thinking.bodySin;
      ringDirection(
        restX,
        scene.body[offset + 1] ?? 0,
        scene.body[offset + 2] ?? 0,
        scene.body[offset + 3] ?? 0,
        ring,
        0,
      );
      const angle = thoughtTurn(hop, group, thinking);
      const [ringX = 0, ringY = 0] = ring;
      expect(out[5]).toBeCloseTo(ringX * Math.cos(angle) - ringY * Math.sin(angle), 12);
      expect(out[6]).toBeCloseTo(ringX * Math.sin(angle) + ringY * Math.cos(angle), 12);
      if (Math.abs(angle) > 0.3) turned++;
    }
    expect(turned).toBeGreaterThan(200);
  });
});

describe("a body row's class code", () => {
  it('packs brightness, pool, group and glyph so that each comes back out, for every group', () => {
    // brightness 0-2 + 3 × pool + FRAGMENT_GROUP_STEP × group, under the glyph's step
    expect(FRAGMENT_CODE_GLYPH_STEP).toBeGreaterThan(2 + 3 + FRAGMENT_GROUP_STEP * 3);
    // At full agitation both pools light an id of 0.531, whose blink is a fifth of the way through.
    const state = analyseFrame(
      {
        time: 0,
        level: 0,
        bands: [],
        speaking: true,
        agitation: 1,
        burstAge: 10,
        burstStrength: 0,
        burstCount: 0,
        appearance: 1,
        presence: 1,
        thinking: 0,
      },
      SIZE,
    );
    const reading = [0, 0, 0, 0, 0];
    for (let group = 0; group <= 3; group++) {
      for (let pool = 0; pool <= 1; pool++) {
        for (let brightness = 0; brightness <= 2; brightness++) {
          for (let glyph = 0; glyph <= 6; glyph++) {
            const code = brightness + 3 * pool + FRAGMENT_GROUP_STEP * group + FRAGMENT_CODE_GLYPH_STEP * glyph;
            expect(fragmentGroup(code)).toBe(group);
            const row = [0.5, 0.1, 1, 0, 0.05, 1, 0.531, code, 0];
            expect(readFragment(row, 0, state, reading)).toBeGreaterThan(0);
            expect([reading[1], reading[2], reading[4]]).toEqual([glyph, group, brightness]);
          }
        }
      }
    }
  });
});

describe('how much of him shows', () => {
  it('is the arrival analyseFrame works out, all the way through arriving, staying and leaving', () => {
    // A guard against analyseFrame working its arrival out again for itself, which could drift.
    const frames = framesFromTheClock();
    const arrivals = frames.map((frame) => arrivalOf(frame.appearance, frame.presence));
    const analysed = frames.map((frame) => analyseFrame(frame, SIZE).arrival);

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
  const stateOf = (changes: Partial<HologramFrame>) => analyseFrame({ ...quiet, ...changes }, SIZE);

  /** Every edge of the cage as its two ends. */
  const cageEdges = () => {
    const edges: number[][][] = [];
    for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
      edges.push([scene.cage.slice(offset, offset + 3), scene.cage.slice(offset + 3, offset + 6)]);
    }
    return edges;
  };

  it('keeps the truss on his edge: boxes between its rails, short struts hanging inward, nothing standing off him', () => {
    // "I'd also like to still have the weird squares near the edge of the hologram" — and nothing may
    // stand off him, so the rails stay inside 0.93-1.05R and a strut only ever hangs inward, short.
    const { truss } = scene;
    expect(TRUSS_INNER_RAIL).toBeGreaterThanOrEqual(0.93);
    expect(TRUSS_OUTER_RAIL).toBeLessThanOrEqual(1.05);
    let degrees = 0;
    let struts = 0;
    for (let offset = 0; offset < truss.length; offset += TRUSS_PIECE_STRIDE) {
      const [, sweep, trace, strut] = truss.slice(offset, offset + TRUSS_PIECE_STRIDE);
      degrees += sweep;
      // a box is wider than it is deep, as the old truss's were
      expect(sweep).toBeGreaterThan(4);
      expect(sweep).toBeLessThanOrEqual(11);
      expect([0, 1, 2, 3]).toContain(trace);
      if (strut > 0) struts++;
      expect(TRUSS_INNER_RAIL - strut).toBeGreaterThan(PICTURE_SHELL_EDGE - 0.05);
    }
    expect(degrees).toBeGreaterThan(180);
    expect(degrees).toBeLessThan(200);
    expect(struts).toBeGreaterThan(0);
  });

  it('rolls the truss clockwise on a clock of its own, one turn in about 33 s', () => {
    const state = (time: number) => stateOf({ time });
    expect(RIM_ROLL_DEGREES_PER_SECOND).toBeGreaterThan(0);
    expect(state(0).rimRoll).toBe(0);
    expect(state(2).rimRoll).toBeCloseTo(2 * RIM_ROLL_DEGREES_PER_SECOND, 6);
    // wrapped to one turn, as the core ring's roll is, so a sphere left up for hours keeps its step
    expect(state(3600).rimRoll).toBeLessThan(360);
  });

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
