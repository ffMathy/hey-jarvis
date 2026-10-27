import {
  BACK_OF_THE_SHELL,
  CORE_X,
  CORE_Y,
  FRAGMENT_CODE_GLYPH_STEP,
  FRAGMENT_DUTY,
  FRAGMENT_FAINTEST,
  FRAGMENT_GROUP_STEP,
  FRAGMENT_WANDER,
  GYRO_GIMBAL_SPLIT,
  GYRO_GROUP,
  type HologramFrameState,
  INNER_LAYER_GROUP,
  LATTICE_PULL,
  LATTICE_STROKE_SHRINK,
  LATTICE_TURN,
  SCAN_BRIGHT_NEARNESS,
  SCAN_FLOOR,
  SCAN_HALF_WIDTH,
  SHELL_FACE_DIMMING,
  THOUGHT_FROM_HOP,
  THOUGHT_SCATTER,
  TRUSS_GROUP,
  TRUSS_THINKING_DIM,
  VORTEX_STRETCH,
  VORTEX_TWIST,
} from '../hologram-drawing';
import { LATTICE_LAYER_SHARE, latticeSpacing, type ViewBasis } from './fragment-3d';
import { glslFloat } from './glsl';

/**
 * The per-fragment arithmetic on the GPU: `fragment-3d.ts`, line for line, in GLSL.
 *
 * Shared by every draw that needs to know where a fragment is — the halo union, which is drawn
 * once a frame, and the strokes, drawn once per eye — so each evaluates it for itself in its
 * vertex shader rather than reading it from a state pass. three 0.186 has no transform feedback,
 * and a state pass into float textures needs EXT_color_buffer_float, which a Quest is not known to
 * expose; the arithmetic is a few hundred operations per fragment, about 120,000 evaluations a
 * frame across the three draws, which a mobile GPU does in a fraction of a millisecond. Both eyes
 * still agree on every fragment, because every input is the same centre-eye uniform in both.
 *
 * Numbers come from `hologram`'s own constants wherever it exports them, so the two cannot drift;
 * the literals that remain are the ones the phone writes inline, and each says where.
 */

/**
 * The uniforms the fragment arithmetic reads: plain data, each number or vector in a `{ value }`
 * box, which is the shape three.js binds by name and the shape the raw renderer (`gpu-body.ts`)
 * reads, so both share one object per frame rather than copying it.
 */
export interface FragmentUniforms {
  [name: string]: { value: number | readonly number[] };
  time: { value: number };
  mixShare: { value: number };
  hotShare: { value: number };
  agitation: { value: number };
  swirl: { value: number };
  hearing: { value: number };
  thinking: { value: number };
  scanHeight: { value: number };
  density: { value: number };
  bodyTurn: { value: [number, number] };
  streamTurn: { value: [number, number] };
  shellTurn: { value: [number, number] };
  gyroSway: { value: [number, number] };
  rimTurn: { value: [number, number] };
  lattice: { value: [number, number, number, number] };
  viewRight: { value: [number, number, number] };
  viewUp: { value: [number, number, number] };
  viewFront: { value: [number, number, number] };
  eyeDistance: { value: number };
}

export function createFragmentUniforms(): FragmentUniforms {
  return {
    time: { value: 0 },
    mixShare: { value: 0 },
    hotShare: { value: 1 },
    agitation: { value: 0 },
    swirl: { value: 1 },
    hearing: { value: 0 },
    thinking: { value: 0 },
    scanHeight: { value: 0 },
    density: { value: 1 },
    bodyTurn: { value: [1, 0] },
    streamTurn: { value: [1, 0] },
    shellTurn: { value: [1, 0] },
    gyroSway: { value: [1, 0] },
    rimTurn: { value: [1, 0] },
    lattice: { value: [1, 0, 0.11, 0] },
    viewRight: { value: [1, 0, 0] },
    viewUp: { value: [0, 1, 0] },
    viewFront: { value: [0, 0, 1] },
    eyeDistance: { value: ORTHOGRAPHIC_EYE_DISTANCE },
  };
}

/**
 * How far away the eye is taken to be when it is infinitely far: far enough that nothing about him
 * is seen larger by more than a part in ten thousand, and a number float32 holds.
 */
export const ORTHOGRAPHIC_EYE_DISTANCE = 1e5;

/**
 * Writes this frame's state into the uniforms. `density` is the share of the rows to draw — the
 * headset's own, not the frame's, since the flat picture of the rest of him has none of the body —
 * and `eyeDistance` how far the centre eye is from his centre, in the drawing's unit.
 */
export function writeFragmentUniforms(
  uniforms: FragmentUniforms,
  state: HologramFrameState,
  basis: ViewBasis,
  density: number,
  eyeDistance: number,
) {
  'worklet';
  uniforms.time.value = state.time;
  uniforms.mixShare.value = state.mix;
  uniforms.hotShare.value = state.hotShare;
  uniforms.agitation.value = state.agitation;
  uniforms.swirl.value = state.swirl;
  uniforms.hearing.value = state.hearing;
  uniforms.thinking.value = state.thinking;
  uniforms.scanHeight.value = state.scan;
  uniforms.density.value = density;
  uniforms.bodyTurn.value = [state.bodyCos, state.bodySin];
  uniforms.streamTurn.value = [state.streamCos, state.streamSin];
  const shellRadians = (state.shellTurn * Math.PI) / 180;
  uniforms.shellTurn.value = [Math.cos(shellRadians), Math.sin(shellRadians)];
  const swayRadians = (state.gyroSway * Math.PI) / 180;
  uniforms.gyroSway.value = [Math.cos(swayRadians), Math.sin(swayRadians)];
  const rimRadians = (state.rimRoll * Math.PI) / 180;
  uniforms.rimTurn.value = [Math.cos(rimRadians), Math.sin(rimRadians)];
  // The lattice's turn is worked out here in double precision, as latticeTarget does, rather than
  // from a float32 clock on the GPU.
  const latticeRadians = state.time * LATTICE_TURN;
  uniforms.lattice.value = [
    Math.cos(latticeRadians),
    Math.sin(latticeRadians),
    latticeSpacing(state),
    state.hearing * LATTICE_PULL,
  ];
  uniforms.viewRight.value = basis.right;
  uniforms.viewUp.value = basis.up;
  uniforms.viewFront.value = basis.front;
  uniforms.eyeDistance.value = Number.isFinite(eyeDistance) ? eyeDistance : ORTHOGRAPHIC_EYE_DISTANCE;
}

/** The attributes, uniforms and functions of the fragment arithmetic, for a vertex shader. */
export const FRAGMENT_GLSL = /* glsl */ `
uniform float time;
uniform float mixShare;
uniform float hotShare;
uniform float agitation;
uniform float swirl;
uniform float hearing;
uniform float thinking;
uniform float scanHeight;
uniform float density;
uniform vec2 bodyTurn;
uniform vec2 streamTurn;
// The groups' turns in the view plane, as cosine and sine: the inner layer's, the gyroscope's
// rocking on top of it, and the truss's roll (turnOfGroup).
uniform vec2 shellTurn;
uniform vec2 gyroSway;
uniform vec2 rimTurn;
uniform vec4 lattice;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform vec3 viewFront;
// How far the centre eye is from his centre, in the drawing's unit.
uniform float eyeDistance;

// One row of body-rows.ts.
in vec4 rest;
in vec4 shape;
in vec4 hashes;
in vec3 identity;
in float thinning;

const float DUTY = ${glslFloat(FRAGMENT_DUTY)};
const float FAINTEST = ${glslFloat(FRAGMENT_FAINTEST)};
const float WANDER = ${glslFloat(FRAGMENT_WANDER)};
const float SCAN_HALF_WIDTH = ${glslFloat(SCAN_HALF_WIDTH)};
const float SCAN_FLOOR = ${glslFloat(SCAN_FLOOR)};
const float SCAN_BRIGHT_NEARNESS = ${glslFloat(SCAN_BRIGHT_NEARNESS)};
const float SHELL_FACE_DIMMING = ${glslFloat(SHELL_FACE_DIMMING)};
const float BACK_OF_THE_SHELL = ${glslFloat(BACK_OF_THE_SHELL)};
const float STROKE_SHRINK = ${glslFloat(LATTICE_STROKE_SHRINK)};
const float VORTEX_TWIST = ${glslFloat(VORTEX_TWIST)};
const float VORTEX_STRETCH = ${glslFloat(VORTEX_STRETCH)};
const float LAYER_SHARE = ${glslFloat(LATTICE_LAYER_SHARE)};
const vec2 CORE = vec2(${glslFloat(CORE_X)}, ${glslFloat(CORE_Y)});
const int GLYPH_STEP = ${FRAGMENT_CODE_GLYPH_STEP};
const int GROUP_STEP = ${FRAGMENT_GROUP_STEP};
const int INNER_LAYER_GROUP = ${INNER_LAYER_GROUP};
const int GYRO_GROUP = ${GYRO_GROUP};
const int TRUSS_GROUP = ${TRUSS_GROUP};
const float GIMBAL_SPLIT = ${glslFloat(GYRO_GIMBAL_SPLIT)};
const float THOUGHT_SCATTER = ${glslFloat(THOUGHT_SCATTER)};
const float THOUGHT_FROM_HOP = ${glslFloat(THOUGHT_FROM_HOP)};
const float TRUSS_THINKING_DIM = ${glslFloat(TRUSS_THINKING_DIM)};

struct Fragment {
  bool visible;
  // Its middle, half its length along it and the glyph's normal, in the body's frame.
  vec3 centre;
  vec3 axis;
  vec3 normal;
  float tier;
  // How much of its tier's paint it shows: less seen face on through the shell.
  float light;
  float glyph;
  float group;
  // Where it is in the view plane, and its half-length there, before its group's turn.
  vec2 plane;
  vec2 planeAxis;
};

Fragment hiddenFragment() {
  return Fragment(false, vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, 0.0, vec2(0.0), vec2(0.0));
}

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

// What is left of a speck's light seen through his shell where it is seen: shellFacing.
float shellFacing(vec2 seen, float radiusSquared) {
  if (radiusSquared <= 0.0) return 1.0;
  return 1.0 - SHELL_FACE_DIMMING * clamp01(1.0 - dot(seen, seen) / radiusSquared);
}

// Which way a speck lies in the view plane, where it is seen: its row's direction, along the ring
// through there and out from his middle, turned into the view's x and y. ringDirection.
vec2 ringDirection(vec2 seen, vec2 unit) {
  float reach = length(seen);
  if (reach <= 0.0) return unit;
  vec2 outward = seen / reach;
  return vec2(-outward.y * unit.x + outward.x * unit.y, outward.x * unit.x + outward.y * unit.y);
}

float smooth01(float value) {
  float clamped = clamp(value, 0.0, 1.0);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

// JavaScript's Math.round: halves go up.
float roundHalfUp(float value) {
  return floor(value + 0.5);
}

float fragmentStrength(float life, float id, float pool) {
  float progress = life / DUTY;
  float envelope = min(1.0, min(progress * 3.0, (1.0 - progress) * 3.0));
  float poolShare = pool < 0.5 ? clamp01((id - mixShare) * 12.0 + 1.0) : clamp01((2.0 * mixShare - id) * 12.0);
  return envelope * poolShare;
}

float fragmentTier(float brightness, float strength, float hot) {
  if (brightness > 1.5) {
    if (strength <= 0.55) return 1.0;
    float margin = hotShare - hot;
    if (margin > 0.0) return 2.0;
    if (margin > -0.12 && strength > 0.86) return 2.0;
    return 1.0;
  }
  if (brightness > 0.5 && strength > 0.4) return 1.0;
  return 0.0;
}

// swirlFragment: the place (xy) and direction (zw), how much of it shows, and the scale its place
// was brought in by, which the depth is scaled by too.
vec4 swirlFragment(vec2 point, vec2 unit, float orderHash, out float shown, out float scale) {
  if (swirl >= 1.0) {
    shown = 1.0;
    scale = 1.0;
    return vec4(point, unit);
  }
  float order = clamp01(0.9 * length(point) + 0.1 * orderHash);
  float travelled = smooth01((swirl - 0.6 * order) / 0.4);
  float left = 1.0 - travelled;
  float spin = VORTEX_TWIST * left * left;
  float cosine = cos(spin);
  float sine = sin(spin);
  scale = 0.04 + 0.96 * travelled;
  vec2 swirled = vec2(point.x * cosine + point.y * sine, point.y * cosine - point.x * sine) * scale;
  float reach = length(swirled);
  if (reach == 0.0) reach = 1.0;
  vec2 outward = swirled / reach;
  vec2 heading = vec2(0.35 * outward.x - outward.y, 0.35 * outward.y + outward.x);
  heading /= length(heading);
  float settled = travelled * travelled;
  vec2 direction = heading * (1.0 - settled)
    + vec2(unit.x * cosine + unit.y * sine, unit.y * cosine - unit.x * sine) * settled;
  float directionLength = length(direction);
  if (directionLength == 0.0) directionLength = 1.0;
  float stretch = 1.0 + VORTEX_STRETCH * left * clamp01(reach * 2.5);
  shown = smooth01((travelled - 0.04) * 6.0) * stretch;
  return vec4(swirled, direction / directionLength);
}

// How much larger than on the plane through his centre the centre eye sees what is depth nearer.
float seenLarger(float depth) {
  return eyeDistance / max(eyeDistance - depth, 0.1 * eyeDistance);
}

// The lattice point for where the centre eye sees the fragment, the depth pulled as far into the
// nearest layer, and the fragment put where the eye sees it on that point from its layer.
vec3 onLattice(vec2 point, float depth, float jitterHash) {
  float pull = lattice.w;
  if (pull <= 0.001) return vec3(point, depth);
  float cosine = lattice.x;
  float sine = lattice.y;
  float spacing = lattice.z;
  vec2 seen = point * seenLarger(depth);
  vec2 local = vec2(seen.x * cosine + seen.y * sine, seen.y * cosine - seen.x * sine);
  float rowHeight = spacing * 0.866;
  float row = roundHalfUp(local.y / rowHeight);
  float shift = mod(row, 2.0) == 0.0 ? 0.0 : spacing / 2.0;
  float column = roundHalfUp((local.x - shift) / spacing);
  float jitter = (jitterHash - 0.5) * 0.018;
  vec2 snapped = vec2(column * spacing + shift + jitter, row * rowHeight + jitter);
  vec2 target = vec2(snapped.x * cosine - snapped.y * sine, snapped.y * cosine + snapped.x * sine);
  float layer = spacing * LAYER_SHARE;
  float snappedDepth = roundHalfUp(depth / layer) * layer;
  vec2 placed = target / seenLarger(snappedDepth);
  return vec3(point + (placed - point) * pull, depth + (snappedDepth - depth) * pull);
}

float scanned(float heightDown, out bool bright) {
  if (thinking <= 0.0) {
    bright = false;
    return 1.0;
  }
  float nearness = clamp01(1.0 - abs(heightDown - scanHeight) / SCAN_HALF_WIDTH);
  bright = nearness > SCAN_BRIGHT_NEARNESS && thinking > 0.5;
  return 1.0 - thinking * (1.0 - SCAN_FLOOR) * (1.0 - nearness * nearness);
}

// A vector of the view plane turned by turn (cosine, sine): clockwise on screen, y down.
vec2 turnVector(vec2 vector, vec2 turn) {
  return vec2(vector.x * turn.x - vector.y * turn.y, vector.x * turn.y + vector.y * turn.x);
}

// A group's turn in the view plane (turnOfGroup): the inner layer's; the gyroscope's arcs rocked on
// top of it, those inside GIMBAL_SPLIT of the core one way and the rest the other; the truss's roll.
vec2 turnOfGroup(int group, float fromCore) {
  if (group == INNER_LAYER_GROUP) return shellTurn;
  if (group == GYRO_GROUP) return turnVector(shellTurn, fromCore < GIMBAL_SPLIT ? gyroSway : vec2(gyroSway.x, -gyroSway.y));
  return rimTurn;
}

vec3 intoBody(vec2 point, float depth) {
  return point.x * viewRight - point.y * viewUp + depth * viewFront;
}

// The last step every fragment shares: its group's turn in the view plane — about his middle for
// the truss, about the core for the rest — then out of the plane into the body's frame.
Fragment finishFragment(vec3 placed, vec2 axis, float axisDepth, float tier, float light, float glyph, int group, float fromCore) {
  Fragment fragment = hiddenFragment();
  fragment.visible = true;
  fragment.plane = placed.xy;
  fragment.planeAxis = axis;
  vec2 point = placed.xy;
  vec2 normal = vec2(-axis.y, axis.x) * 0.55;
  if (group > 0) {
    vec2 turn = turnOfGroup(group, fromCore);
    vec2 pivot = group == TRUSS_GROUP ? vec2(0.0) : CORE;
    point = pivot + turnVector(point - pivot, turn);
    axis = turnVector(axis, turn);
    normal = turnVector(normal, turn);
  }
  fragment.centre = intoBody(point, placed.z);
  fragment.axis = intoBody(axis, axisDepth);
  fragment.normal = intoBody(normal, 0.0);
  fragment.tier = tier;
  fragment.light = light;
  fragment.glyph = glyph;
  fragment.group = float(group);
  return fragment;
}

Fragment readBodyFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float cycle = floor(cycles);
  float life = cycles - cycle;
  if (life >= DUTY) return hiddenFragment();
  // brightness + 3 × pool + GROUP_STEP × group + GLYPH_STEP × glyph, taken apart exactly in integers.
  int code = int(identity.z + 0.5);
  int glyph = code / GLYPH_STEP;
  int kind = code - GLYPH_STEP * glyph;
  int group = kind / GROUP_STEP;
  int pool = (kind - GROUP_STEP * group) / 3;
  float brightness = float(kind - GROUP_STEP * group - 3 * pool);
  float strength = fragmentStrength(life, id, float(pool));
  if (strength < FAINTEST) return hiddenFragment();

  float fragmentLength = shape.z;
  float hop = fract(cycle * 0.618034 + identity.x);
  vec3 turned = vec3(rest.x * bodyTurn.x + rest.z * bodyTurn.y, -rest.y, rest.z * bodyTurn.x - rest.x * bodyTurn.y);
  // The groups held in the view plane rest there: placeFragment.
  bool held = group > 0;
  float planeX = held ? rest.x : dot(turned, viewRight);
  float planeY = held ? rest.y : -dot(turned, viewUp);
  float depth = held ? rest.z : dot(turned, viewFront);
  vec2 unit = ringDirection(vec2(planeX, planeY), shape.xy);
  // While he thinks it lies some way dealt afresh at each blink: thoughtTurn.
  float scatter = group == TRUSS_GROUP ? 0.0 : thinking * (fract(hop * THOUGHT_FROM_HOP) - 0.5) * THOUGHT_SCATTER;
  unit = turnVector(unit, vec2(cos(scatter), sin(scatter)));
  // The voice's churn, which the gyroscope's arcs leave to their rocking.
  float inward = group == GYRO_GROUP ? 0.0 : clamp01((0.76 - (planeX * planeX + planeY * planeY)) * 3.2);
  float wander = fract(hop * 23.17) - 0.5;
  float along = (hop - 0.5) * 1.4 * fragmentLength + wander * 1.3 * agitation * inward;
  // The truss's specks slide only along their rails and rungs, and lie past the limb on purpose.
  bool truss = group == TRUSS_GROUP;
  float across = truss ? 0.0 : wander * WANDER;
  float y = planeY + unit.y * along + unit.x * across;
  float x = planeX + unit.x * along - unit.y * across;
  float edge = truss ? 1.0 : clamp01((0.94 * 0.94 - x * x - y * y) * 8.0);
  float light = shellFacing(vec2(x, y), dot(rest.xyz, rest.xyz));
  // The truss is not put out by the thinking plane; it recedes instead.
  if (truss) light *= 1.0 - TRUSS_THINKING_DIM * thinking;
  float lit = strength * edge;
  if (lit < FAINTEST) return hiddenFragment();

  float drawn;
  float scale;
  vec4 swirled = swirlFragment(vec2(x, y), unit, hashes.z, drawn, scale);
  if (drawn <= 0.0) return hiddenFragment();
  // The truss keeps its squares while he listens, and while he thinks.
  vec3 placed = vec3(swirled.xy, depth * scale);
  bool scanBright = false;
  float litHere = lit;
  if (!truss) {
    placed = onLattice(swirled.xy, depth * scale, hashes.w);
    litHere = lit * scanned(-intoBody(placed.xy, placed.z).y, scanBright);
  }
  if (litHere < FAINTEST) return hiddenFragment();
  bool facing = depth >= -BACK_OF_THE_SHELL;
  bool promoted = scanBright && facing;
  float plain = facing ? fragmentTier(brightness, litHere * light, hashes.y) : 0.0;
  float tier = promoted ? 2.0 : plain;
  float halfLength = fragmentLength * 0.5 * litHere * drawn * (1.0 - STROKE_SHRINK * hearing);
  return finishFragment(
    placed,
    swirled.zw * halfLength,
    0.0,
    tier,
    promoted ? 1.0 : light,
    float(glyph),
    group,
    length(rest.xy - CORE)
  );
}

Fragment readStreamFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float life = cycles - floor(cycles);
  if (life >= DUTY) return hiddenFragment();
  int code = int(identity.z + 0.5);
  int glyph = code / GLYPH_STEP;
  int kind = code - GLYPH_STEP * glyph;
  int pool = kind >= 3 ? 1 : 0;
  float brightness = float(kind - 3 * pool);
  float strength = fragmentStrength(life, id, float(pool));
  if (strength < FAINTEST) return hiddenFragment();

  vec3 turned = vec3(
    rest.x * streamTurn.x + rest.z * streamTurn.y,
    -rest.y,
    rest.z * streamTurn.x - rest.x * streamTurn.y
  );
  float planeX = dot(turned, viewRight);
  float planeY = -dot(turned, viewUp);
  float depth = dot(turned, viewFront);
  float lit = strength * clamp01((0.86 - planeX * planeX - planeY * planeY) * 8.0);
  if (lit < FAINTEST) return hiddenFragment();
  vec3 tangent = vec3(
    shape.x * streamTurn.x + shape.y * streamTurn.y,
    0.0,
    shape.y * streamTurn.x - shape.x * streamTurn.y
  );
  float tier = depth < -BACK_OF_THE_SHELL ? 0.0 : fragmentTier(brightness, lit, hashes.y);

  float drawn;
  float scale;
  vec4 swirled = swirlFragment(vec2(planeX, planeY), vec2(1.0, 0.0), hashes.z, drawn, scale);
  if (drawn <= 0.0) return hiddenFragment();
  vec3 placed = onLattice(swirled.xy, depth * scale, hashes.w);
  float rightwards = dot(tangent, viewRight) < 0.0 ? -1.0 : 1.0;
  vec2 tangentPlane = rightwards * vec2(dot(tangent, viewRight), -dot(tangent, viewUp));
  float tangentDepth = rightwards * dot(tangent, viewFront);
  float size = lit * drawn * (1.0 - STROKE_SHRINK * hearing);
  vec2 direction = swirled.zw;
  vec2 axis = vec2(
    tangentPlane.x * direction.x - tangentPlane.y * direction.y,
    tangentPlane.x * direction.y + tangentPlane.y * direction.x
  ) * size;
  return finishFragment(placed, axis, tangentDepth * size, tier, 1.0, float(glyph), 0, 0.0);
}

Fragment readFragment() {
  // A share keeps the rows whose key is under it. The index is in key order, so the phone's and the
  // watch's renderer draw only those (quadsKept); this hides the rest for a draw of every row.
  if (thinning >= density) return hiddenFragment();
  // An if rather than ?:, which WebGL does not allow on structures.
  if (rest.w < 0.5) return readBodyFragment();
  return readStreamFragment();
}
`;

/**
 * The glyphs as distance fields, for a fragment shader: 0 dash, 1 L, 2 bracket, 3 T, 4 Z, 5 ring,
 * 6 cell — `h` is the half-length, `n` the normal's length (0.55 of it), and the point is in the
 * glyph's own frame, x along it and y along its normal. A dash is one stroke along it; an L adds
 * one along the normal at its far end; a bracket and a Z add one at each end, the same way round
 * and opposite ways; a T one from its middle, 1.4 normals long; a ring is a circle 0.45 of the
 * half-length across; and a cell is the rectangle the normal spans.
 */
export const GLYPH_GLSL = /* glsl */ `
float segmentDistance(vec2 point, vec2 from, vec2 to) {
  vec2 run = to - from;
  float lengthSquared = dot(run, run);
  float along = lengthSquared > 0.0 ? clamp(dot(point - from, run) / lengthSquared, 0.0, 1.0) : 0.0;
  return length(point - from - run * along);
}

float boxDistance(vec2 point, vec2 halfSize) {
  vec2 outside = abs(point) - halfSize;
  return length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0);
}

// A butt-capped stroke of half-width w along one segment: a box, which draws nothing when the
// segment has no length, as a butt cap does.
float buttDistance(vec2 point, vec2 from, vec2 to, float halfWidth) {
  vec2 run = to - from;
  float runLength = length(run);
  if (runLength < 1e-7) return 1e3;
  vec2 direction = run / runLength;
  vec2 fromMiddle = point - 0.5 * (from + to);
  vec2 local = vec2(dot(fromMiddle, direction), dot(fromMiddle, vec2(-direction.y, direction.x)));
  return boxDistance(local, vec2(0.5 * runLength, halfWidth));
}

// Distance to the glyph's centre line: what a round-capped stroke — a halo, a hot core — is
// measured from.
float glyphLineDistance(vec2 point, float glyph, float h, float n) {
  int kind = int(glyph + 0.5);
  if (kind == 5) return abs(length(point) - 0.45 * h);
  if (kind == 6) return abs(boxDistance(point, vec2(h, n)));
  float nearest = segmentDistance(point, vec2(-h, 0.0), vec2(h, 0.0));
  if (kind == 1) {
    nearest = min(nearest, segmentDistance(point, vec2(h, 0.0), vec2(h, n)));
  } else if (kind == 2) {
    nearest = min(nearest, segmentDistance(point, vec2(-h, n), vec2(-h, 0.0)));
    nearest = min(nearest, segmentDistance(point, vec2(h, 0.0), vec2(h, n)));
  } else if (kind == 3) {
    nearest = min(nearest, segmentDistance(point, vec2(0.0), vec2(0.0, 1.4 * n)));
  } else if (kind == 4) {
    nearest = min(nearest, segmentDistance(point, vec2(-h, n), vec2(-h, 0.0)));
    nearest = min(nearest, segmentDistance(point, vec2(h, 0.0), vec2(h, -n)));
  }
  return nearest;
}

// Signed distance to the glyph stroked butt-capped at half-width w, as the body's tiers are.
float glyphStrokeDistance(vec2 point, float glyph, float h, float n, float halfWidth) {
  int kind = int(glyph + 0.5);
  if (kind == 5) return abs(length(point) - 0.45 * h) - halfWidth;
  if (kind == 6) return abs(boxDistance(point, vec2(h, n))) - halfWidth;
  float nearest = buttDistance(point, vec2(-h, 0.0), vec2(h, 0.0), halfWidth);
  if (kind == 1) {
    nearest = min(nearest, buttDistance(point, vec2(h, 0.0), vec2(h, n), halfWidth));
  } else if (kind == 2) {
    nearest = min(nearest, buttDistance(point, vec2(-h, n), vec2(-h, 0.0), halfWidth));
    nearest = min(nearest, buttDistance(point, vec2(h, 0.0), vec2(h, n), halfWidth));
  } else if (kind == 3) {
    nearest = min(nearest, buttDistance(point, vec2(0.0), vec2(0.0, 1.4 * n), halfWidth));
  } else if (kind == 4) {
    nearest = min(nearest, buttDistance(point, vec2(-h, n), vec2(-h, 0.0), halfWidth));
    nearest = min(nearest, buttDistance(point, vec2(h, 0.0), vec2(h, -n), halfWidth));
  }
  return nearest;
}

// How far along and across the glyph reaches from its middle: what its quad has to cover.
vec2 glyphReach(float glyph, float h, float n) {
  int kind = int(glyph + 0.5);
  if (kind == 5) return vec2(0.45 * h);
  if (kind == 0) return vec2(h, 0.0);
  if (kind == 3) return vec2(h, 1.4 * n);
  return vec2(h, n);
}
`;
