import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, hologramFrameOf } from '../frame-clock';
import { MATERIALISE_SECONDS, READ_INTERVAL_MS, SCENE_SEED, VOICE_WAVE_SLOTS } from '../frame-timing';
import {
  analyseFrame,
  BACK_OF_THE_SHELL,
  BODY_ID_FIELD,
  BODY_STRIDE,
  BODY_TURN_SECONDS,
  CORE_X,
  CORE_Y,
  createHologramScene,
  FRAGMENT_FAINTEST,
  fragmentGroup,
  fragmentTier,
  GYRO_GROUP,
  type HologramFrame,
  type HologramFrameState,
  LATTICE_STROKE_SHRINK,
  latticeFragment,
  latticeTarget,
  placeFragment,
  readFragment,
  readShellFragment,
  STREAM_STRIDE,
  scanned,
  swirlFragment,
  TRUSS_GROUP,
  TRUSS_INNER_RAIL,
  TRUSS_OUTER_RAIL,
  TRUSS_THINKING_DIM,
  turnOfGroup,
  VOICE_WAVE_ALONG,
  VOICE_WAVE_GONE,
  voiceWavePush,
  voiceWaveTurn,
} from '../hologram-drawing';
import { createSimulatedSpectrum, fillSimulatedSpectrum } from '../simulated-voice';
import { simulatedVolume } from '../voice-analysis';
import { foldSpectrum, perceivedLevel, VOICE_BAND_COUNT } from '../voice-levels';
import {
  FRONT_VIEW,
  type PlacedFragment,
  placeBodyFragment,
  placeStreamFragment,
  seenLarger,
  type Vector3Tuple,
  type ViewBasis,
} from './fragment-3d';

const scene = createHologramScene(SCENE_SEED);

/**
 * His recent syllables and the talk envelope as the real frame clock leaves them `seconds` into the
 * greeting sample mode speaks, read every READ_INTERVAL_MS as the app reads it: the shape the clock
 * really hands the drawing, copied, since its arrays are only good until its next step.
 */
function spokenAt(seconds: number): Partial<HologramFrame> {
  const clock = createFrameClockState();
  const spectrum = createSimulatedSpectrum();
  let level = 0;
  let bands: number[] = new Array(VOICE_BAND_COUNT).fill(0);
  let lastReading = -1;
  for (let step = 1; step / 60 <= seconds; step++) {
    const reading = Math.floor(step / 60 / (READ_INTERVAL_MS / 1000));
    if (reading !== lastReading) {
      lastReading = reading;
      fillSimulatedSpectrum('greeting', step / 60, spectrum);
      level = perceivedLevel(simulatedVolume(spectrum));
      bands = foldSpectrum(spectrum);
    }
    advanceFrameClock(clock, 1 / 60, level, bands, true, false, false, 0, 0);
  }
  const frame = hologramFrameOf(clock);
  return { talk: frame.talk, voiceWave: [...(frame.voiceWave ?? [])], voiceWavePhase: frame.voiceWavePhase };
}

/** About 0.13 s after "help" starts: one ring just out of the core, and the ones before it further out. */
const SPOKEN = spokenAt(1.2);

/** The moments the drawing is checked at: every phase the body does something different in. */
const MOMENTS: Record<string, Partial<HologramFrame>> = {
  idle: { time: 10 },
  arriving: { time: 0.5, appearance: 0.5 / MATERIALISE_SECONDS },
  speaking: {
    time: 23.7,
    level: 0.7,
    agitation: 0.85,
    burstAge: 0.05,
    burstStrength: 0.8,
    burstCount: 7,
    ...SPOKEN,
  },
  thinking: { time: 41.2, thinking: 1 },
  listening: { time: 12.3, hearing: 1, hearingLevel: 0.6 },
  leaving: { time: 30, presence: 0.5 },
};

function stateAt(moment: Partial<HologramFrame>): HologramFrameState {
  const frame: HologramFrame = {
    time: 0,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0.3),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    presence: 1,
    thinking: 0,
    ...moment,
  };
  return analyseFrame(frame, 1);
}

function fraction(value: number) {
  return value - Math.floor(value);
}

interface PhoneFragment {
  x: number;
  y: number;
  depth: number;
  /** Half the stroke along it: the direction times the half-length. */
  alongX: number;
  alongY: number;
  tier: number;
  light: number;
  glyph: number;
  group: number;
  /** How far its row rests from the core: which way a gyroscope's arc rocks. */
  fromCore: number;
  /** How much of its outward lean a ring of his voice takes away: none for the arcs and the stream. */
  alongWave: number;
}

/**
 * One body row as the per-fragment helpers in the drawing compose it, in the plane of the screen:
 * where it is, which way it lies, its tier and glyph. Composed from the helpers and nothing else,
 * which is what makes it the flat projection the 3D placement is held to.
 */
function phoneBody(offset: number, state: HologramFrameState): PhoneFragment | null {
  const body = scene.body;
  const reading = state.reading;
  const placed = state.scratch;
  const strength = readFragment(body, offset, state, reading);
  if (strength <= 0) return null;
  const id = body[offset + BODY_ID_FIELD];
  const length = body[offset + 4];
  const hop = fraction(reading[3] * 0.618034 + id * 9.7);
  placeFragment(body, offset, hop, state, placed);
  const lit = strength * placed[3];
  if (lit < FRAGMENT_FAINTEST) return null;
  // It settles lying along the ring through where it is seen, which placeFragment worked out.
  swirlFragment(placed[0], placed[1], placed[5], placed[6], id, state);
  const drawn = state.swirled[4];
  if (drawn <= 0) return null;
  // The truss keeps its squares: never snapped onto the lattice nor put out by the thinking plane.
  const truss = reading[2] === TRUSS_GROUP;
  if (truss) {
    state.listened[0] = state.swirled[0];
    state.listened[1] = state.swirled[1];
  } else {
    latticeFragment(state.swirled[0], state.swirled[1], id, state);
  }
  const y = state.listened[1];
  const litHere = truss ? lit : lit * scanned(y, state);
  if (litHere < FRAGMENT_FAINTEST) return null;
  const facing = placed[2] >= -BACK_OF_THE_SHELL;
  // The shell it is seen through dims its paint, not its length: the light picks its tier, except
  // where the thinking plane lights it to the brightest at full light.
  const promoted = !truss && state.scanBright[0] > 0 && facing;
  const plain = facing ? fragmentTier(reading[4], litHere * placed[4], id, state.hotShare) : 0;
  const half = length * 0.5 * litHere * drawn * (1 - LATTICE_STROKE_SHRINK * state.hearing);
  return {
    x: state.listened[0],
    y,
    depth: placed[2],
    alongX: state.swirled[2] * half,
    alongY: state.swirled[3] * half,
    tier: promoted ? 2 : plain,
    light: promoted ? 1 : placed[4],
    glyph: reading[1],
    group: reading[2],
    fromCore: Math.hypot(body[offset] - CORE_X, body[offset + 1] - CORE_Y),
    alongWave: reading[2] === GYRO_GROUP ? 0 : VOICE_WAVE_ALONG,
  };
}

/** One stream row, likewise. */
function phoneStream(offset: number, state: HologramFrameState): PhoneFragment | null {
  const stream = scene.stream;
  const strength = readShellFragment(stream, offset, state);
  if (strength <= 0) return null;
  const restX = stream[offset];
  const restZ = stream[offset + 2];
  const x = restX * state.streamCos + restZ * state.streamSin;
  const depth = restZ * state.streamCos - restX * state.streamSin;
  const y = stream[offset + 1];
  const lit = strength * Math.min(1, Math.max(0, (0.86 - x * x - y * y) * 8));
  if (lit < FRAGMENT_FAINTEST) return null;
  const halfX = stream[offset + 3] * state.streamCos + stream[offset + 4] * state.streamSin;
  const plain = stream[offset + 8] - 3 * state.reading[0];
  const id = stream[offset + 7];
  const tier = depth < -BACK_OF_THE_SHELL ? 0 : fragmentTier(plain, lit, id, state.hotShare);
  swirlFragment(x, y, 1, 0, id, state);
  const drawn = state.swirled[4];
  if (drawn <= 0) return null;
  latticeFragment(state.swirled[0], state.swirled[1], id, state);
  const half = Math.abs(halfX) * lit * drawn * (1 - LATTICE_STROKE_SHRINK * state.hearing);
  return {
    x: state.listened[0],
    y: state.listened[1],
    depth,
    alongX: state.swirled[2] * half,
    alongY: state.swirled[3] * half,
    tier,
    light: 1,
    glyph: stream[offset + 9],
    group: 0,
    fromCore: 0,
    alongWave: 0,
  };
}

function length3(vector: Vector3Tuple) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Where the phone draws a fragment and which way, once the rings of his voice have pushed it and
 * turned its stroke (all but the truss's) and its group has been turned in the view plane: the
 * helpers, composed as the phone composes them. The phone turns the canvas under a group instead.
 */
function phoneDrawn(phone: PhoneFragment, state: HologramFrameState) {
  let { x, y, alongX, alongY } = phone;
  if (state.voiceWaveLargest > 0 && phone.group !== TRUSS_GROUP) {
    voiceWavePush(x, y, state);
    voiceWaveTurn(alongX, alongY, x, y, state.waved[2] ?? 0, phone.alongWave, state);
    [x = 0, y = 0] = state.waved;
    alongX = state.waved[3] ?? 0;
    alongY = state.waved[4] ?? 0;
  }
  const radians = (turnOfGroup(phone.group, phone.fromCore, state) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const pivotX = phone.group > 0 && phone.group !== TRUSS_GROUP ? CORE_X : 0;
  const pivotY = phone.group > 0 && phone.group !== TRUSS_GROUP ? CORE_Y : 0;
  return {
    x: pivotX + (x - pivotX) * cos - (y - pivotY) * sin,
    y: pivotY + (x - pivotX) * sin + (y - pivotY) * cos,
    alongX: alongX * cos - alongY * sin,
    alongY: alongX * sin + alongY * cos,
  };
}

function expectSame(placed: PlacedFragment | null, phone: PhoneFragment | null, state: HologramFrameState) {
  expect(placed === null).toBe(phone === null);
  if (placed === null || phone === null) return;
  // Where it is before the rings push it, which is where its sparkle is read.
  expect(placed.plane[0]).toBeCloseTo(phone.x, 9);
  expect(placed.plane[1]).toBeCloseTo(phone.y, 9);
  // In the plane of the view it is drawn exactly where the phone draws it, and its stroke lies
  // exactly the phone's way.
  const drawn = phoneDrawn(phone, state);
  expect(placed.centre[0]).toBeCloseTo(drawn.x, 9);
  expect(-placed.centre[1]).toBeCloseTo(drawn.y, 9);
  expect(placed.axis[0]).toBeCloseTo(drawn.alongX, 9);
  expect(-placed.axis[1]).toBeCloseTo(drawn.alongY, 9);
  expect(placed.tier).toBe(phone.tier);
  expect(placed.light).toBeCloseTo(phone.light, 9);
  expect(placed.glyph).toBe(phone.glyph);
  expect(placed.group).toBe(phone.group);
}

/** Compares every row at the front view against the phone, and says how many were drawn. */
function compareEveryRow(state: HologramFrameState): number {
  let drawn = 0;
  for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
    const phone = phoneBody(offset, state);
    expectSame(placeBodyFragment(scene.body, offset, state, FRONT_VIEW), phone, state);
    if (phone !== null) drawn++;
  }
  for (let offset = 0; offset < scene.stream.length; offset += STREAM_STRIDE) {
    const phone = phoneStream(offset, state);
    expectSame(placeStreamFragment(scene.stream, offset, state, FRONT_VIEW), phone, state);
    if (phone !== null) drawn++;
  }
  return drawn;
}

const IDLE = MOMENTS.idle;

/**
 * Enough of him lit at each moment that the comparison means something. Fewer while he arrives,
 * and while he thinks: the plane leaves 0.12 of a fragment's strength wherever it is not passing,
 * which is under the faintest that is drawn for all but the strongest. About 2100 of the scene's
 * rows are lit then, against 3700 at the other moments.
 */
const FEWEST_COMPARED: Record<string, number> = { arriving: 500, thinking: 1500 };

describe('a fragment in three dimensions, seen from the front', () => {
  for (const [name, moment] of Object.entries(MOMENTS)) {
    it(`is exactly where the phone draws it: ${name}`, () => {
      expect(compareEveryRow(stateAt(moment))).toBeGreaterThan(FEWEST_COMPARED[name] ?? 2000);
    });
  }

  it('keeps the depth the phone keeps and throws away, once he has arrived and nobody is talking', () => {
    const state = stateAt(IDLE);
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE * 7) {
      const phone = phoneBody(offset, state);
      const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW);
      if (phone === null || placed === null) continue;
      expect(placed.centre[2]).toBeCloseTo(phone.depth, 9);
    }
  });

  it('brings the fragments out of the core in depth as well as across while he arrives', () => {
    const early = stateAt({ time: 0.3, appearance: 0.3 / MATERIALISE_SECONDS });
    const settled = stateAt({ time: 0.3 });
    let nearer = 0;
    let compared = 0;
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
      const arriving = placeBodyFragment(scene.body, offset, early, FRONT_VIEW);
      const here = placeBodyFragment(scene.body, offset, settled, FRONT_VIEW);
      if (arriving === null || here === null) continue;
      compared++;
      if (Math.abs(arriving.centre[2]) <= Math.abs(here.centre[2]) + 1e-12) nearer++;
    }
    expect(compared).toBeGreaterThan(100);
    expect(nearer).toBe(compared);
  });

  it('stacks the listening lattice in layers a row’s height apart', () => {
    const state = stateAt({ time: 12.3, hearing: 1, hearingLevel: 0 });
    const layer = 0.11 * 0.816;
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE * 5) {
      const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW);
      if (placed === null) continue;
      // Pulled 0.88 of the way into the nearest layer, so within 0.12 of half a layer of one.
      const fromLayer = Math.abs(placed.centre[2] / layer - Math.round(placed.centre[2] / layer));
      expect(fromLayer).toBeLessThanOrEqual(0.5 * 0.12 + 1e-9);
    }
  });

  it('keeps the lattice’s knots knots as the centre eye sees them, 1.6 m away', () => {
    const state = stateAt({ time: 12.3, hearing: 1, hearingLevel: 0 });
    // A radius of 0.22 m at 1.6 m: the eye is about seven radii from his centre.
    const eyeDistance = 1.6 / 0.22;
    const spread = (distance: number) => {
      // How far each fragment is seen from the grid point nearest where it is seen.
      let total = 0;
      let count = 0;
      for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE * 3) {
        const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW, distance);
        // The whorl and the arcs lie in the plane through his middle, where perspective streaks nothing.
        if (placed === null || placed.group > 0) continue;
        const seen = seenLarger(placed.centre[2], eyeDistance);
        const x = placed.plane[0] * seen;
        const y = placed.plane[1] * seen;
        const target = [0, 0];
        latticeTarget(x, y, 0.5, state, target);
        total += Math.hypot(x - target[0], y - target[1]);
        count++;
      }
      return total / count;
    };
    // Snapped where the eye sees them, the layers line up behind one another; snapped in the plane,
    // perspective pulls each knot out into a streak.
    expect(spread(eyeDistance)).toBeLessThan(0.5 * spread(Number.POSITIVE_INFINITY));
  });
});

/** Every body fragment drawn at this moment, seen from the front, with its row's offset. */
function drawnBody(state: HologramFrameState): { offset: number; placed: PlacedFragment }[] {
  const drawn: { offset: number; placed: PlacedFragment }[] = [];
  for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
    const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW);
    if (placed !== null) drawn.push({ offset, placed });
  }
  return drawn;
}

/** How far from his middle a fragment is seen from the front, in the view plane. */
function seenReach(placed: PlacedFragment) {
  return Math.hypot(placed.plane[0], placed.plane[1]);
}

/**
 * The share of the specks drawn beyond `from` R that lie within 20° of the ring through where they
 * are seen. Measured from where they are drawn, after the inner layer's turn, since that turns their
 * stroke with them; from the front the view plane's x is the body's and its y the body's flipped.
 */
function shareAlongTheRing(state: HologramFrameState, from: number) {
  let along = 0;
  let measured = 0;
  for (const { placed } of drawnBody(state)) {
    const x = placed.centre[0];
    const y = -placed.centre[1];
    const reach = Math.hypot(x, y);
    const half = Math.hypot(placed.axis[0], placed.axis[1]);
    if (reach < from || half === 0) continue;
    measured++;
    const outward = Math.abs(placed.axis[0] * x - placed.axis[1] * y) / (half * reach);
    if (outward < Math.sin((20 * Math.PI) / 180)) along++;
  }
  return along / measured;
}

/**
 * The specks drawn at his edge (beyond 0.75R) within a sliver of 0.15R behind the plane through his
 * middle, or in front of it: how many there are, and how many of them are lit above the dim tier.
 */
function specksAtTheEdge(state: HologramFrameState, behind: boolean) {
  const sliver = drawnBody(state).filter(({ placed }) => {
    const depth = placed.centre[2];
    const isBehind = depth < 0;
    // the globe's shell: the truss lies flat round his limb, in front of it, and would swamp it
    if (placed.group === TRUSS_GROUP) return false;
    return seenReach(placed) >= 0.75 && Math.abs(depth) <= 0.15 && isBehind === behind;
  });
  return { count: sliver.length, lit: sliver.filter(({ placed }) => placed.tier > 0).length };
}

describe('his specks', () => {
  it('lie along the ring where they are seen, like beads on a necklace, however far he has turned', () => {
    // A direction held in the view plane lies along the ring only where a speck rested; a quarter
    // turn later the beads at the edge of the donut would be the ones that had crossed his face.
    for (const time of [10, 10 + BODY_TURN_SECONDS / 4, 10 + BODY_TURN_SECONDS * 0.6]) {
      const share = shareAlongTheRing(stateAt({ time }), 0.6);
      expect(share).toBeGreaterThan(0.55);
      // And not all of them, so the shell does not read as combed.
      expect(share).toBeLessThan(0.9);
    }
  });

  it('are dimmed a little seen face on, so his edge still leads, and never shortened into beads', () => {
    // His middle is filled again, as the old body was, so the specks seen there are dimmed by at
    // most a quarter — enough that the ring of beads round his edge is still the brightest of
    // him, not so much that the middle goes dark. Measured: 0.80 face on, where the hollow shell's was under 0.4.
    const faceOn = { light: 0, drawnShare: 0, count: 0 };
    const edgeOn = { light: 0, drawnShare: 0, count: 0 };
    for (const { offset, placed } of drawnBody(stateAt(IDLE))) {
      // The globe's specks: the whorl's and the arcs' lie flat in the view plane and are never dimmed.
      if (placed.group > 0) continue;
      const reach = seenReach(placed);
      const tally = reach < 0.3 ? faceOn : reach > 0.8 ? edgeOn : null;
      if (tally === null) continue;
      tally.light += placed.light;
      // How much of its own length is drawn, which its clock and the limb take from it.
      tally.drawnShare += (2 * length3(placed.axis)) / scene.body[offset + 4];
      tally.count++;
    }
    expect(faceOn.count).toBeGreaterThan(100);
    // Enough at the edge to measure: over four in ten of his specks are held in the view plane
    // instead — the whorl's and the gyroscope's round the core, and the truss's — so the edge holds
    // fewer than it did (measured 426 before the truss was made of specks, 390 since).
    expect(edgeOn.count).toBeGreaterThan(350);
    expect(faceOn.light / faceOn.count).toBeGreaterThan(0.7);
    expect(edgeOn.light / edgeOn.count).toBeGreaterThan(0.8);
    expect(faceOn.light / faceOn.count).toBeLessThan(0.9 * (edgeOn.light / edgeOn.count));
    expect(faceOn.drawnShare / faceOn.count).toBeGreaterThan(0.85 * (edgeOn.drawnShare / edgeOn.count));
  });

  it('stay inside his limb while he talks, however far his voice moves them', () => {
    // All but the truss's, which lies round his limb on purpose and which his voice never moves.
    const drawn = drawnBody(stateAt(MOMENTS.speaking)).filter(({ placed }) => placed.group !== TRUSS_GROUP);
    expect(drawn.length).toBeGreaterThan(2000);
    for (const { placed } of drawn) {
      expect(seenReach(placed)).toBeLessThan(0.94);
    }
  });

  it('light the ring of beads round his edge from just behind the limb as from just in front', () => {
    // Specks a sliver behind the plane through his middle are only ever seen at the edge of the
    // donut; drawn dim like the rest of the back of the shell, they would leave half the ring dark.
    const state = stateAt(IDLE);
    const behind = specksAtTheEdge(state, true);
    const inFront = specksAtTheEdge(state, false);
    // Enough to measure: fewer since over four in ten specks went to the whorl and the gyroscope
    // (measured 190).
    expect(behind.count).toBeGreaterThan(150);
    expect(behind.lit / behind.count).toBeGreaterThan(0.8 * (inFront.lit / inFront.count));
  });
});

describe('the rings his syllables send out of his core', () => {
  /** Where a fragment is drawn, seen from the front: the view plane's x is the body's, its y the body's flipped. */
  const drawnAt = (placed: PlacedFragment): [number, number] => [placed.centre[0], -placed.centre[1]];
  const everySlotFull = { ...MOMENTS.speaking, voiceWave: new Array(VOICE_WAVE_SLOTS).fill(1), voiceWavePhase: 0.5 };

  /** Where a body row is drawn with no ring to push it: where it lay before the push, turned with its group. */
  const unpushed = (placed: PlacedFragment, offset: number, state: HologramFrameState): [number, number] => {
    const fromCore = Math.hypot((scene.body[offset] ?? 0) - CORE_X, (scene.body[offset + 1] ?? 0) - CORE_Y);
    const turn = (turnOfGroup(placed.group, fromCore, state) * Math.PI) / 180;
    const aboutCore = placed.group > 0 && placed.group !== TRUSS_GROUP;
    const pivotX = aboutCore ? CORE_X : 0;
    const pivotY = aboutCore ? CORE_Y : 0;
    const fromX = placed.plane[0] - pivotX;
    const fromY = placed.plane[1] - pivotY;
    return [
      pivotX + fromX * Math.cos(turn) - fromY * Math.sin(turn),
      pivotY + fromX * Math.sin(turn) + fromY * Math.cos(turn),
    ];
  };

  it('leave every speck where it was in silence', () => {
    const silent = stateAt({ ...MOMENTS.speaking, voiceWave: undefined, voiceWavePhase: undefined });
    for (const { offset, placed } of drawnBody(silent)) {
      const [x, y] = drawnAt(placed);
      const [expectedX, expectedY] = unpushed(placed, offset, silent);
      expect(x).toBeCloseTo(expectedX, 12);
      expect(y).toBeCloseTo(expectedY, 12);
    }
  });

  it('push his specks out from the core where he is speaking, along the line they lie on, never in', () => {
    const pushes = drawnBody(stateAt(MOMENTS.speaking))
      .filter(({ placed }) => placed.group === 0)
      .map(({ placed }) => {
        const [x, y] = drawnAt(placed);
        return Math.hypot(x - CORE_X, y - CORE_Y) - Math.hypot(placed.plane[0] - CORE_X, placed.plane[1] - CORE_Y);
      });
    expect(Math.min(...pushes)).toBeGreaterThanOrEqual(-1e-12);
    // A real ring, just out of the core, and the ones before it move a good share of the globe.
    expect(pushes.filter((push) => push > 0.01).length).toBeGreaterThan(200);
  });

  it('never push a speck past where the rings melt into his shell, so his limb holds', () => {
    // The 0.94R limb test above measures where a speck is before the rings push it; this is where it
    // is drawn, with every slot a full syllable and with the real ones.
    for (const moment of [MOMENTS.speaking, everySlotFull]) {
      const state = stateAt(moment);
      const drawn = drawnBody(state).filter(({ placed }) => placed.group !== TRUSS_GROUP);
      expect(drawn.length).toBeGreaterThan(2000);
      for (const { placed } of drawn) {
        const [x, y] = drawnAt(placed);
        expect(Math.hypot(x, y)).toBeLessThan(0.94);
        // A speck the rings pushed is never pushed out past where they are gone.
        const before = Math.hypot(placed.plane[0] - CORE_X, placed.plane[1] - CORE_Y);
        if (placed.group === 0 && before < VOICE_WAVE_GONE) {
          expect(Math.hypot(x - CORE_X, y - CORE_Y)).toBeLessThan(VOICE_WAVE_GONE);
        }
      }
    }
  });

  it('leave the truss exactly where it is, so its squares stay squares', () => {
    const spoken = stateAt(everySlotFull);
    const silent = stateAt({ ...everySlotFull, voiceWave: undefined });
    let compared = 0;
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
      const loud = placeBodyFragment(scene.body, offset, spoken, FRONT_VIEW);
      if (loud === null || loud.group !== TRUSS_GROUP) continue;
      const quiet = placeBodyFragment(scene.body, offset, silent, FRONT_VIEW);
      expect(quiet).not.toBeNull();
      expect(loud.centre).toEqual(quiet?.centre ?? []);
      expect(loud.axis).toEqual(quiet?.axis ?? []);
      compared++;
    }
    expect(compared).toBeGreaterThan(150);
  });

  it("breathe the gyroscope's arcs out as a ring passes, keeping them arcs about the core", () => {
    const spoken = stateAt(everySlotFull);
    const silent = stateAt({ ...everySlotFull, voiceWave: undefined });
    let compared = 0;
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
      const loud = placeBodyFragment(scene.body, offset, spoken, FRONT_VIEW);
      if (loud === null || loud.group !== GYRO_GROUP) continue;
      const quiet = placeBodyFragment(scene.body, offset, silent, FRONT_VIEW);
      if (quiet === null) continue;
      const [loudX, loudY] = drawnAt(loud);
      const [quietX, quietY] = drawnAt(quiet);
      // The same angle about the core, so an arc stays an arc; only how far out it is moves.
      expect(Math.atan2(loudY - CORE_Y, loudX - CORE_X)).toBeCloseTo(Math.atan2(quietY - CORE_Y, quietX - CORE_X), 9);
      // And its strokes keep their way: the arcs rock instead.
      expect(loud.axis[0]).toBeCloseTo(quiet.axis[0], 12);
      expect(loud.axis[1]).toBeCloseTo(quiet.axis[1], 12);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('push the stream with the rest of him, but never turn its strokes', () => {
    const spoken = stateAt(everySlotFull);
    const silent = stateAt({ ...everySlotFull, voiceWave: undefined });
    let compared = 0;
    for (let offset = 0; offset < scene.stream.length; offset += STREAM_STRIDE) {
      const loud = placeStreamFragment(scene.stream, offset, spoken, FRONT_VIEW);
      const quiet = placeStreamFragment(scene.stream, offset, silent, FRONT_VIEW);
      if (loud === null || quiet === null) continue;
      expect(loud.axis).toEqual(quiet.axis);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });
});

/** The view from `angle` radians round to the viewer's right, still level. */
function viewFromTheSide(angle: number): ViewBasis {
  return {
    right: [Math.cos(angle), 0, -Math.sin(angle)],
    up: [0, 1, 0],
    front: [Math.sin(angle), 0, Math.cos(angle)],
  };
}

describe('a fragment seen from elsewhere in the room', () => {
  it('is what the front would see had the body turned the other way by as much', () => {
    const angle = Math.PI / 4;
    const state = stateAt(IDLE);
    const turned = stateAt(IDLE);
    const bodyTurn = Math.atan2(state.bodySin, state.bodyCos) - angle;
    turned.bodyCos = Math.cos(bodyTurn);
    turned.bodySin = Math.sin(bodyTurn);
    let compared = 0;
    for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE * 3) {
      const fromSide = placeBodyFragment(scene.body, offset, state, viewFromTheSide(angle));
      const fromFront = placeBodyFragment(scene.body, offset, turned, FRONT_VIEW);
      expect(fromSide === null).toBe(fromFront === null);
      if (fromSide === null || fromFront === null) continue;
      compared++;
      expect(fromSide.plane[0]).toBeCloseTo(fromFront.plane[0], 9);
      expect(fromSide.plane[1]).toBeCloseTo(fromFront.plane[1], 9);
      expect(fromSide.tier).toBe(fromFront.tier);
    }
    expect(compared).toBeGreaterThan(500);
  });

  it('keeps each stream stroke a tangent of its latitude, however it is seen', () => {
    const state = stateAt(IDLE);
    for (const angle of [0, 0.7, Math.PI / 2, 2.4]) {
      for (let offset = 0; offset < scene.stream.length; offset += STREAM_STRIDE) {
        const placed = placeStreamFragment(scene.stream, offset, state, viewFromTheSide(angle));
        if (placed === null) continue;
        // Level, and square to the line from the vertical axis to the stroke — to within the five
        // decimals the scene rounds its rows to.
        expect(placed.axis[1]).toBeCloseTo(0, 9);
        const radial = placed.centre[0] * placed.axis[0] + placed.centre[2] * placed.axis[2];
        const reach = Math.hypot(placed.centre[0], placed.centre[2]);
        expect(radial / (length3(placed.axis) * reach || 1)).toBeCloseTo(0, 3);
      }
    }
  });
});

describe('the body while he thinks', () => {
  it('is lit by a plane climbing up through him, from the bottom of the ball to the top', () => {
    // The state the user asked to be "completely different": a plane travelling up through the
    // ball, lighting only what it passes. Sampled across one pass — SCAN_SECONDS is 2.6, so this one
    // runs from 5.2 to 7.8 — and held to the trend across it, since what the plane passes is a lumpy
    // swarm whose lit middle steps sideways wherever it crosses a dense band.
    const litHeight = (time: number) => {
      const state = stateAt({ time, thinking: 1 });
      let total = 0;
      let count = 0;
      for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
        const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW);
        // The truss is not lit by the plane: it stays, receding, so the squares do.
        if (placed === null || placed.group === TRUSS_GROUP) continue;
        total += placed.plane[1];
        count++;
      }
      return total / count;
    };
    const early = [5.4, 5.8, 6.2].map(litHeight);
    const late = [6.6, 7.0, 7.4].map(litHeight);

    // Down the view plane is y growing, so a climb is the lit middle's y falling: every sample in
    // the second half above every one in the first, and by a real distance, in radii.
    expect(Math.max(...late)).toBeLessThan(Math.min(...early));
    const mean = (of: number[]) => of.reduce((all, one) => all + one, 0) / of.length;
    expect(mean(early) - mean(late)).toBeGreaterThan(0.12);
  });
});

/** The offsets of the truss's rows in the scene's body. */
const TRUSS_OFFSETS = Array.from({ length: scene.body.length / BODY_STRIDE }, (_, row) => row * BODY_STRIDE).filter(
  (offset) => fragmentGroup(scene.body[offset + 7] ?? 0) === TRUSS_GROUP,
);

/** How lit a row's clock makes it this frame, before anything else is asked of it: 0 when it is not drawn. */
function clockStrength(offset: number, state: HologramFrameState) {
  return readFragment(scene.body, offset, state, [0, 0, 0, 0, 0]);
}

describe('the truss round his edge, made of specks', () => {
  it('is never cut or shortened by his limb, though it lies past it', () => {
    // Its rails are at 0.935R and 1.035R, where the limb fade leaves a body speck nothing.
    for (const moment of [IDLE, MOMENTS.speaking, MOMENTS.listening]) {
      const state = stateAt(moment);
      let lit = 0;
      for (const offset of TRUSS_OFFSETS) {
        const strength = clockStrength(offset, state);
        const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW);
        expect(placed === null).toBe(strength <= 0);
        if (placed === null) continue;
        lit++;
        const half = 0.5 * (scene.body[offset + 4] ?? 0) * strength * (1 - LATTICE_STROKE_SHRINK * state.hearing);
        expect(length3(placed.axis)).toBeCloseTo(half, 9);
      }
      expect(lit).toBeGreaterThan(150);
    }
  });

  it('keeps its specks on its rails and rungs, rolled round his middle by rimRoll, even while he listens', () => {
    // Not snapped onto the listening lattice: the squares stay squares.
    for (const moment of [IDLE, MOMENTS.listening]) {
      const state = stateAt(moment);
      const radians = (state.rimRoll * Math.PI) / 180;
      for (const offset of TRUSS_OFFSETS) {
        const placed = placeBodyFragment(scene.body, offset, state, FRONT_VIEW);
        if (placed === null) continue;
        const [x = 0, y = 0] = placed.plane;
        // only slid along the way it lies, never across it: on a rail still — the chord of a slide of
        // 0.7 of its 0.11R stands off the rail by 0.003R at most — or on its rung
        const reach = Math.hypot(x, y);
        const onRail = [TRUSS_OUTER_RAIL, TRUSS_INNER_RAIL].some((rail) => Math.abs(reach - rail) < 4e-3);
        const restClock = Math.atan2(scene.body[offset] ?? 0, -(scene.body[offset + 1] ?? 0));
        const onRung = Math.abs(Math.atan2(x, -y) - restClock) < 1e-6;
        expect(onRail || onRung).toBe(true);
        // turned about his middle, clockwise on screen
        expect(placed.centre[0]).toBeCloseTo(x * Math.cos(radians) - y * Math.sin(radians), 9);
        expect(-placed.centre[1]).toBeCloseTo(x * Math.sin(radians) + y * Math.cos(radians), 9);
      }
    }
  });

  it('stays while he thinks, lying as it always does and receding, rather than going out with the scan', () => {
    const quiet = stateAt({ time: 41.2 });
    const thinking = stateAt(MOMENTS.thinking);
    let compared = 0;
    for (const offset of TRUSS_OFFSETS) {
      const placed = placeBodyFragment(scene.body, offset, thinking, FRONT_VIEW);
      const calm = placeBodyFragment(scene.body, offset, quiet, FRONT_VIEW);
      expect(placed === null).toBe(calm === null);
      if (placed === null || calm === null) continue;
      compared++;
      // the same way, never scattered: the squares must stay squares
      for (const axis of [0, 1, 2]) expect(placed.axis[axis]).toBeCloseTo(calm.axis[axis] ?? 0, 9);
      expect(placed.light).toBeCloseTo(calm.light * (1 - TRUSS_THINKING_DIM), 9);
    }
    expect(compared).toBeGreaterThan(150);
  });
});
