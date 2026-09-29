import { describe, expect, it } from 'bun:test';
import {
  analyseFrame,
  BODY_ID_FIELD,
  BODY_STRIDE,
  createHologramScene,
  FRAGMENT_FAINTEST,
  FRAGMENT_WANDER,
  fragmentTier,
  type HologramFrame,
  type HologramFrameState,
  LATTICE_STROKE_SHRINK,
  latticeFragment,
  placeFragment,
  readFragment,
  readShellFragment,
  SCENE_SEED,
  STREAM_STRIDE,
  scanned,
  swirlFragment,
  VOICE_BAND_COUNT,
} from 'hologram';
import {
  FRONT_VIEW,
  type PlacedFragment,
  placeBodyFragment,
  placeStreamFragment,
  type Vector3Tuple,
  type ViewBasis,
} from './fragment-3d';

const scene = createHologramScene(SCENE_SEED);

/** The moments the drawing is checked at: every phase the body does something different in. */
const MOMENTS: Record<string, Partial<HologramFrame>> = {
  idle: { time: 10 },
  arriving: { time: 0.5, appearance: 0.5 / 1.4 },
  speaking: { time: 23.7, level: 0.7, agitation: 0.85, burstAge: 0.05, burstStrength: 0.8, burstCount: 7 },
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
    density: 1,
    presence: 1,
    thinking: 0,
    ...moment,
  };
  return analyseFrame(frame, 1, scene);
}

function fraction(value: number) {
  return value - Math.floor(value);
}

interface PhoneFragment {
  x: number;
  y: number;
  depth: number;
  /** Half the stroke along it, as `appendGlyph` is handed it: the direction times the half-length. */
  alongX: number;
  alongY: number;
  tier: number;
  glyph: number;
  group: number;
}

/** `appendBody`'s loop body, composed from the helpers it calls, for one row. */
function phoneBody(offset: number, state: HologramFrameState): PhoneFragment | null {
  const body = scene.body;
  const reading = state.reading;
  const placed = state.scratch;
  const strength = readFragment(body, offset, state, reading);
  if (strength <= 0) return null;
  const id = body[offset + BODY_ID_FIELD];
  const length = body[offset + 4];
  const hop = fraction(reading[3] * 0.618034 + id * 9.7);
  const along = (hop - 0.5) * 1.4 * length;
  const fromCentre = body[offset] ** 2 + body[offset + 1] ** 2;
  const inward = Math.min(1, Math.max(0, (0.76 - fromCentre) * 3.2));
  const across = (fraction(hop * 23.17) - 0.5) * (FRAGMENT_WANDER + 1.3 * state.agitation * inward);
  placeFragment(body, offset, along, across, state, placed);
  const lit = strength * placed[3];
  if (lit < FRAGMENT_FAINTEST) return null;
  swirlFragment(placed[0], placed[1], body[offset + 2], body[offset + 3], id, state);
  const drawn = state.swirled[4];
  if (drawn <= 0) return null;
  latticeFragment(state.swirled[0], state.swirled[1], id, state);
  const y = state.listened[1];
  const litHere = lit * scanned(y, state);
  if (litHere < FRAGMENT_FAINTEST) return null;
  const facing = placed[2] >= 0;
  const plain = facing ? fragmentTier(reading[4], litHere, id, state.hotShare) : 0;
  const half = length * 0.5 * litHere * drawn * (1 - LATTICE_STROKE_SHRINK * state.hearing);
  return {
    x: state.listened[0],
    y,
    depth: placed[2],
    alongX: state.swirled[2] * half,
    alongY: state.swirled[3] * half,
    tier: state.scanBright[0] > 0 && facing ? 2 : plain,
    glyph: reading[1],
    group: reading[2] > 0 ? 1 : 0,
  };
}

/** `appendStream`'s loop body, likewise. */
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
  const tier = depth < 0 ? 0 : fragmentTier(plain, lit, id, state.hotShare);
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
    glyph: stream[offset + 9],
    group: 0,
  };
}

function length3(vector: Vector3Tuple) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function expectSame(placed: PlacedFragment | null, phone: PhoneFragment | null, stateTurn: number) {
  expect(placed === null).toBe(phone === null);
  if (placed === null || phone === null) return;
  expect(placed.plane[0]).toBeCloseTo(phone.x, 9);
  expect(placed.plane[1]).toBeCloseTo(phone.y, 9);
  // In the plane of the view the stroke is exactly the phone's, turned with the inner layer when
  // it rides it (the phone turns the canvas under it instead).
  const turn = placed.group === 1 ? (stateTurn * Math.PI) / 180 : 0;
  const alongX = phone.alongX * Math.cos(turn) - phone.alongY * Math.sin(turn);
  const alongY = phone.alongX * Math.sin(turn) + phone.alongY * Math.cos(turn);
  expect(placed.axis[0]).toBeCloseTo(alongX, 9);
  expect(-placed.axis[1]).toBeCloseTo(alongY, 9);
  expect(placed.tier).toBe(phone.tier);
  expect(placed.glyph).toBe(phone.glyph);
  expect(placed.group).toBe(phone.group);
}

/** Compares every row at the front view against the phone, and says how many were drawn. */
function compareEveryRow(state: HologramFrameState): number {
  let drawn = 0;
  for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
    const phone = phoneBody(offset, state);
    expectSame(placeBodyFragment(scene.body, offset, state, FRONT_VIEW), phone, state.shellTurn);
    if (phone !== null) drawn++;
  }
  for (let offset = 0; offset < scene.stream.length; offset += STREAM_STRIDE) {
    const phone = phoneStream(offset, state);
    expectSame(placeStreamFragment(scene.stream, offset, state, FRONT_VIEW), phone, state.shellTurn);
    if (phone !== null) drawn++;
  }
  return drawn;
}

const IDLE = MOMENTS.idle;

describe('a fragment in three dimensions, seen from the front', () => {
  for (const [name, moment] of Object.entries(MOMENTS)) {
    it(`is exactly where the phone draws it: ${name}`, () => {
      // Enough of him lit that the comparison means something.
      expect(compareEveryRow(stateAt(moment))).toBeGreaterThan(name === 'arriving' ? 500 : 2000);
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
    const early = stateAt({ time: 0.3, appearance: 0.3 / 1.4 });
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
