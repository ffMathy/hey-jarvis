import {
  CORE_X,
  CORE_Y,
  FRAGMENT_FAINTEST,
  FRAGMENT_WANDER,
  fragmentTier,
  type HologramFrameState,
  LATTICE_BREATH,
  LATTICE_PULL,
  LATTICE_PULSE,
  LATTICE_SPACING,
  LATTICE_STROKE_SHRINK,
  latticeTarget,
  readFragment,
  readShellFragment,
  scanned,
  swirlFragment,
} from 'hologram';

/**
 * One body or stream fragment in three dimensions: the phone's per-fragment arithmetic, composed
 * from the helpers `hologram` exports, with the body standing in a room instead of on a screen.
 *
 * This is the reference the GPU port (`fragment-glsl.ts`) is a line-by-line transliteration of,
 * and the unit tests hold it to the phone: seen from the front it lands every fragment exactly
 * where `appendBody` and `appendStream` put it. The browser tests then hold the GPU to this.
 *
 * The mapping, from `research/hologram.md` §6:
 * - The body turns about the vertical in its own frame — x right, y up, z towards where the user
 *   stood when he arrived — as `placeFragment` turns it about the screen's vertical.
 * - Everything the phone does in the plane of the screen happens in the plane through his centre
 *   that faces the viewer's centre eye: the wander along and across a fragment, the vortex, the
 *   lattice, the inner layer's turn, and the glyph's own direction. Worked out against the centre
 *   eye, not per eye, so both eyes see the same fragments lit, in the same tiers, facing the same way.
 * - Depth is kept, so the swarm has a back and a front: the vortex scales it with the distance it
 *   has come out of the core (so particles leave the core in 3D rather than as a rod along the
 *   view), and the lattice snaps it into layers the grid's own row spacing apart, so the listening
 *   crystal has depth too.
 * - The thinking plane is level with the floor, sweeping up the world's vertical.
 */

export type Vector3Tuple = [number, number, number];

/**
 * The plane through his centre that faces the centre eye, in the body's own frame: `front` points
 * at the eye, `up` is the world's up made square to it, and `right` completes them. Unit vectors.
 */
export interface ViewBasis {
  right: Vector3Tuple;
  up: Vector3Tuple;
  front: Vector3Tuple;
}

/** The basis when the eye is straight in front of him, level: the phone's own view. */
export const FRONT_VIEW: ViewBasis = { right: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1] };

/** A fragment placed for this frame. Lengths are in the drawing's unit, the sphere's radius. */
export interface PlacedFragment {
  /** Its middle, in the body's frame (y up). */
  centre: Vector3Tuple;
  /** Half its length, along it. */
  axis: Vector3Tuple;
  /** The glyph's normal: across it, 0.55 of the half-length, as `appendGlyph` measures ticks. */
  normal: Vector3Tuple;
  /** 0 dim, 1 mid, 2 bright. */
  tier: number;
  /** 0 dash, 1 L, 2 bracket, 3 T, 4 Z, 5 ring, 6 cell. */
  glyph: number;
  /** 0 pinned, 1 riding the inner layer, which turns about the core. */
  group: number;
  /** Where it is in the view plane (x right, y down) before the inner layer's turn. */
  plane: [number, number];
}

function clamp01(value: number) {
  return value > 0 ? (value > 1 ? 1 : value) : 0;
}

function smooth01(value: number) {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return clamped * clamped * (3 - 2 * clamped);
}

function fraction(value: number) {
  return value - Math.floor(value);
}

function dot(vector: Vector3Tuple, other: Vector3Tuple) {
  return vector[0] * other[0] + vector[1] * other[1] + vector[2] * other[2];
}

/**
 * How far out of the core the vortex has brought a fragment, as the scale `swirlFragment` applies
 * to its place: 1 once the vortex is over. The same arithmetic, which it does not hand back.
 */
export function vortexScale(x: number, y: number, id: number, state: HologramFrameState) {
  if (state.swirl >= 1) return 1;
  const order = clamp01(0.9 * Math.sqrt(x * x + y * y) + 0.1 * fraction(id * 3.91));
  return 0.04 + 0.96 * smooth01((state.swirl - 0.6 * order) / 0.4);
}

/** The lattice's spacing this frame, as `latticeTarget` breathes it. */
export function latticeSpacing(state: HologramFrameState) {
  return LATTICE_SPACING * (1 + LATTICE_BREATH * state.hearingLevel * Math.sin(state.time * LATTICE_PULSE));
}

/**
 * How far apart the lattice's layers are, as a share of its spacing: √(2/3), the height of a
 * tetrahedron on the grid's triangle, so the points sit as tightly front to back as across.
 */
export const LATTICE_LAYER_SHARE = 0.816;

/**
 * How much larger than on the plane through his centre the centre eye sees something `depth`
 * nearer to it, from `eyeDistance` away (both in the drawing's unit). 1 from infinitely far, which
 * is the phone's flat projection; held short of the eye itself.
 */
export function seenLarger(depth: number, eyeDistance: number) {
  if (!Number.isFinite(eyeDistance)) return 1;
  return eyeDistance / Math.max(eyeDistance - depth, 0.1 * eyeDistance);
}

/**
 * Where a fragment is while he listens: the phone's lattice as the centre eye sees it, with its
 * depth pulled the same share of the way into the nearest of the lattice's layers.
 *
 * The grid point is found for where the eye sees the fragment, and the fragment is then put where
 * the eye would see it on that point from its layer's depth. So from the centre eye every layer's
 * points line up behind one another and the lattice is the phone's knots, and in stereo or from
 * another place the layers come apart into a crystal. Snapped in the plane instead, the layers
 * seen in perspective smear each knot into a streak pointing at the centre. From infinitely far —
 * the phone's view — this is `latticeFragment` exactly.
 */
function onLattice(
  x: number,
  y: number,
  depth: number,
  id: number,
  state: HologramFrameState,
  eyeDistance: number,
): Vector3Tuple {
  const pull = state.hearing * LATTICE_PULL;
  if (pull <= 0.001) return [x, y, depth];
  const seen = seenLarger(depth, eyeDistance);
  const target = state.listened;
  latticeTarget(x * seen, y * seen, id, state, target);
  const layer = latticeSpacing(state) * LATTICE_LAYER_SHARE;
  const snapped = Math.floor(depth / layer + 0.5) * layer;
  const unseen = 1 / seenLarger(snapped, eyeDistance);
  return [x + (target[0] * unseen - x) * pull, y + (target[1] * unseen - y) * pull, depth + (snapped - depth) * pull];
}

/**
 * Turns a point of the view plane by the inner layer's turn about the core, as
 * `canvas.rotate(shellTurn, CORE_X, CORE_Y)` does: clockwise on screen, y down.
 */
function turnAboutCore(x: number, y: number, cos: number, sin: number): [number, number] {
  const fromCoreX = x - CORE_X;
  const fromCoreY = y - CORE_Y;
  return [CORE_X + fromCoreX * cos - fromCoreY * sin, CORE_Y + fromCoreX * sin + fromCoreY * cos];
}

/** A vector of the view plane (x right, y down) plus a depth, in the body's frame. */
function intoBody(basis: ViewBasis, x: number, y: number, depth: number): Vector3Tuple {
  const { right, up, front } = basis;
  return [
    x * right[0] - y * up[0] + depth * front[0],
    x * right[1] - y * up[1] + depth * front[1],
    x * right[2] - y * up[2] + depth * front[2],
  ];
}

interface Unfinished {
  x: number;
  y: number;
  depth: number;
  axisX: number;
  axisY: number;
  axisDepth: number;
  tier: number;
  glyph: number;
  group: number;
}

/** The last step every fragment shares: the inner layer's turn, then out of the plane into the body's frame. */
function finish(fragment: Unfinished, state: HologramFrameState, basis: ViewBasis): PlacedFragment {
  let { x, y, axisX, axisY } = fragment;
  let normalX = -axisY * 0.55;
  let normalY = axisX * 0.55;
  const plane: [number, number] = [x, y];
  if (fragment.group === 1) {
    const radians = (state.shellTurn * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    [x, y] = turnAboutCore(x, y, cos, sin);
    [axisX, axisY] = [axisX * cos - axisY * sin, axisX * sin + axisY * cos];
    [normalX, normalY] = [normalX * cos - normalY * sin, normalX * sin + normalY * cos];
  }
  return {
    centre: intoBody(basis, x, y, fragment.depth),
    axis: intoBody(basis, axisX, axisY, fragment.axisDepth),
    normal: intoBody(basis, normalX, normalY, 0),
    tier: fragment.tier,
    glyph: fragment.glyph,
    group: fragment.group,
    plane,
  };
}

/**
 * A body fragment this frame, or null when it is not drawn: `appendBody`, with `placeFragment`
 * turned into three dimensions.
 */
export function placeBodyFragment(
  body: number[],
  offset: number,
  state: HologramFrameState,
  basis: ViewBasis,
  eyeDistance = Number.POSITIVE_INFINITY,
): PlacedFragment | null {
  const reading = state.reading;
  const strength = readFragment(body, offset, state, reading);
  if (strength <= 0) return null;
  const [glyph = 0, turning = 0, cycle = 0, brightness = 0] = [reading[1], reading[2], reading[3], reading[4]];
  const restX = body[offset];
  const restY = body[offset + 1];
  const unitX = body[offset + 2];
  const unitY = body[offset + 3];
  const length = body[offset + 4];
  const id = body[offset + 6];
  const restDepth = body[offset + 9];
  const hop = fraction(cycle * 0.618034 + id * 9.7);
  const along = (hop - 0.5) * 1.4 * length;
  const inward = clamp01((0.76 - (restX * restX + restY * restY)) * 3.2);
  const across = (fraction(hop * 23.17) - 0.5) * (FRAGMENT_WANDER + 1.3 * state.agitation * inward);

  // placeFragment: turned about the vertical in the body's frame, then seen in the view plane.
  const turned: Vector3Tuple = [
    restX * state.bodyCos + restDepth * state.bodySin,
    -restY,
    restDepth * state.bodyCos - restX * state.bodySin,
  ];
  const planeX = dot(turned, basis.right);
  const planeY = -dot(turned, basis.up);
  const depth = dot(turned, basis.front);
  const y = planeY + unitY * along + unitX * across;
  const x = planeX + unitX * along - unitY * across;
  const lit = strength * clamp01((0.94 * 0.94 - planeX * planeX - y * y) * 8);
  if (lit < FRAGMENT_FAINTEST) return null;

  swirlFragment(x, y, unitX, unitY, id, state);
  const [swirledX = 0, swirledY = 0, directionX = 0, directionY = 0, drawn = 0] = state.swirled;
  if (drawn <= 0) return null;
  const [latticeX, latticeY, latticeDepth] = onLattice(
    swirledX,
    swirledY,
    depth * vortexScale(x, y, id, state),
    id,
    state,
    eyeDistance,
  );
  // The thinking plane is level: how far down the world's vertical the fragment is.
  const litHere = lit * scanned(-intoBody(basis, latticeX, latticeY, latticeDepth)[1], state);
  if (litHere < FRAGMENT_FAINTEST) return null;
  const facing = depth >= 0;
  const plain = facing ? fragmentTier(brightness, litHere, id, state.hotShare) : 0;
  const half = length * 0.5 * litHere * drawn * (1 - LATTICE_STROKE_SHRINK * state.hearing);
  return finish(
    {
      x: latticeX,
      y: latticeY,
      depth: latticeDepth,
      axisX: directionX * half,
      axisY: directionY * half,
      axisDepth: 0,
      tier: state.scanBright[0] > 0 && facing ? 2 : plain,
      glyph,
      group: turning > 0 ? 1 : 0,
    },
    state,
    basis,
  );
}

/**
 * A stream fragment this frame, or null when it is not drawn: `appendStream`, with the fragment
 * a true tangent of its latitude, which seen from the front is the foreshortened stroke the phone
 * draws.
 */
export function placeStreamFragment(
  stream: number[],
  offset: number,
  state: HologramFrameState,
  basis: ViewBasis,
  eyeDistance = Number.POSITIVE_INFINITY,
): PlacedFragment | null {
  const strength = readShellFragment(stream, offset, state);
  if (strength <= 0) return null;
  const pool = state.reading[0];
  const restX = stream[offset];
  const restY = stream[offset + 1];
  const restZ = stream[offset + 2];
  const halfX = stream[offset + 3];
  const halfZ = stream[offset + 4];
  const id = stream[offset + 7];
  const turned: Vector3Tuple = [
    restX * state.streamCos + restZ * state.streamSin,
    -restY,
    restZ * state.streamCos - restX * state.streamSin,
  ];
  const planeX = dot(turned, basis.right);
  const planeY = -dot(turned, basis.up);
  const depth = dot(turned, basis.front);
  const lit = strength * clamp01((0.86 - planeX * planeX - planeY * planeY) * 8);
  if (lit < FRAGMENT_FAINTEST) return null;
  const tangent: Vector3Tuple = [
    halfX * state.streamCos + halfZ * state.streamSin,
    0,
    halfZ * state.streamCos - halfX * state.streamSin,
  ];
  const tier = depth < 0 ? 0 : fragmentTier(stream[offset + 8] - 3 * pool, lit, id, state.hotShare);

  swirlFragment(planeX, planeY, 1, 0, id, state);
  const [swirledX = 0, swirledY = 0, directionX = 0, directionY = 0, drawn = 0] = state.swirled;
  if (drawn <= 0) return null;
  const [latticeX, latticeY, latticeDepth] = onLattice(
    swirledX,
    swirledY,
    depth * vortexScale(planeX, planeY, id, state),
    id,
    state,
    eyeDistance,
  );
  // The tangent as the view plane sees it, pointing right as the phone's always does (it draws
  // the length along +x), and turned with the vortex's heading as the phone's direction is.
  const sign = dot(tangent, basis.right) < 0 ? -1 : 1;
  const tangentX = sign * dot(tangent, basis.right);
  const tangentY = -sign * dot(tangent, basis.up);
  const tangentDepth = sign * dot(tangent, basis.front);
  const size = lit * drawn * (1 - LATTICE_STROKE_SHRINK * state.hearing);
  return finish(
    {
      x: latticeX,
      y: latticeY,
      depth: latticeDepth,
      axisX: (tangentX * directionX - tangentY * directionY) * size,
      axisY: (tangentX * directionY + tangentY * directionX) * size,
      axisDepth: tangentDepth * size,
      tier,
      glyph: stream[offset + 9],
      group: 0,
    },
    state,
    basis,
  );
}
