import {
  CORE_X,
  CORE_Y,
  FRAGMENT_DUTY,
  FRAGMENT_FAINTEST,
  FRAGMENT_WANDER,
  type HologramFrameState,
  LATTICE_PULL,
  LATTICE_STROKE_SHRINK,
  LATTICE_TURN,
  SCAN_BRIGHT_NEARNESS,
  SCAN_FLOOR,
  SCAN_HALF_WIDTH,
  VORTEX_STRETCH,
  VORTEX_TWIST,
} from 'hologram';
import { LATTICE_LAYER_SHARE, latticeSpacing, type ViewBasis } from './fragment-3d';

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

/** A number as a GLSL float literal: always with a decimal point, which GLSL insists on. */
export function glslFloat(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/**
 * A hex colour as a GLSL vec3 of its raw, encoded bytes — Skia blends the encoded values, with no
 * linearising, so the shaders do too.
 */
export function glslColour(hex: number): string {
  const channel = (shift: number) => glslFloat(((hex >> shift) & 0xff) / 255);
  return `vec3(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** The uniforms the fragment arithmetic reads, as three.js wants them. */
export interface FragmentUniforms {
  [name: string]: { value: unknown };
  time: { value: number };
  bodyShare: { value: number };
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
  lattice: { value: [number, number, number, number] };
  viewRight: { value: [number, number, number] };
  viewUp: { value: [number, number, number] };
  viewFront: { value: [number, number, number] };
}

export function createFragmentUniforms(): FragmentUniforms {
  return {
    time: { value: 0 },
    bodyShare: { value: 1 },
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
    lattice: { value: [1, 0, 0.11, 0] },
    viewRight: { value: [1, 0, 0] },
    viewUp: { value: [0, 1, 0] },
    viewFront: { value: [0, 0, 1] },
  };
}

/**
 * Writes this frame's state into the uniforms. `density` is the share of the rows to draw — the
 * headset's own, not the frame's, since the frame CanvasKit draws has none of the body in it.
 */
export function writeFragmentUniforms(
  uniforms: FragmentUniforms,
  state: HologramFrameState,
  basis: ViewBasis,
  density: number,
) {
  uniforms.time.value = state.time;
  uniforms.bodyShare.value = state.bodyShare;
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
}

/** The attributes, uniforms and functions of the fragment arithmetic, for a vertex shader. */
export const FRAGMENT_GLSL = /* glsl */ `
uniform float time;
uniform float bodyShare;
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
uniform vec2 shellTurn;
uniform vec4 lattice;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform vec3 viewFront;

// One row of body-rows.ts.
in vec4 rest;
in vec4 shape;
in vec4 hashes;
in vec4 identity;
in float thinning;

const float DUTY = ${glslFloat(FRAGMENT_DUTY)};
const float FAINTEST = ${glslFloat(FRAGMENT_FAINTEST)};
const float WANDER = ${glslFloat(FRAGMENT_WANDER)};
const float SCAN_HALF_WIDTH = ${glslFloat(SCAN_HALF_WIDTH)};
const float SCAN_FLOOR = ${glslFloat(SCAN_FLOOR)};
const float SCAN_BRIGHT_NEARNESS = ${glslFloat(SCAN_BRIGHT_NEARNESS)};
const float STROKE_SHRINK = ${glslFloat(LATTICE_STROKE_SHRINK)};
const float VORTEX_TWIST = ${glslFloat(VORTEX_TWIST)};
const float VORTEX_STRETCH = ${glslFloat(VORTEX_STRETCH)};
const float LAYER_SHARE = ${glslFloat(LATTICE_LAYER_SHARE)};
const vec2 CORE = vec2(${glslFloat(CORE_X)}, ${glslFloat(CORE_Y)});

struct Fragment {
  bool visible;
  // Its middle, half its length along it and the glyph's normal, in the body's frame.
  vec3 centre;
  vec3 axis;
  vec3 normal;
  float tier;
  float glyph;
  float group;
  // Where it is in the view plane, and its half-length there, before the inner layer's turn.
  vec2 plane;
  vec2 planeAxis;
};

Fragment hiddenFragment() {
  return Fragment(false, vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, vec2(0.0), vec2(0.0));
}

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

float smooth01(float value) {
  float clamped = clamp(value, 0.0, 1.0);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

// JavaScript's Math.round: halves go up.
float roundHalfUp(float value) {
  return floor(value + 0.5);
}

float fragmentShown(float revealOrder) {
  return clamp01((bodyShare * 1.12 - revealOrder) * 9.0);
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

// latticeFragment in the plane, and the depth pulled as far into the nearest layer.
vec3 onLattice(vec2 point, float depth, float jitterHash) {
  float pull = lattice.w;
  if (pull <= 0.001) return vec3(point, depth);
  float cosine = lattice.x;
  float sine = lattice.y;
  float spacing = lattice.z;
  vec2 local = vec2(point.x * cosine + point.y * sine, point.y * cosine - point.x * sine);
  float rowHeight = spacing * 0.866;
  float row = roundHalfUp(local.y / rowHeight);
  float shift = mod(row, 2.0) == 0.0 ? 0.0 : spacing / 2.0;
  float column = roundHalfUp((local.x - shift) / spacing);
  float jitter = (jitterHash - 0.5) * 0.018;
  vec2 snapped = vec2(column * spacing + shift + jitter, row * rowHeight + jitter);
  vec2 target = vec2(snapped.x * cosine - snapped.y * sine, snapped.y * cosine + snapped.x * sine);
  float layer = spacing * LAYER_SHARE;
  float snappedDepth = roundHalfUp(depth / layer) * layer;
  return vec3(point + (target - point) * pull, depth + (snappedDepth - depth) * pull);
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

vec2 turnVector(vec2 vector) {
  return vec2(vector.x * shellTurn.x - vector.y * shellTurn.y, vector.x * shellTurn.y + vector.y * shellTurn.x);
}

vec3 intoBody(vec2 point, float depth) {
  return point.x * viewRight - point.y * viewUp + depth * viewFront;
}

Fragment finishFragment(vec3 placed, vec2 axis, float axisDepth, float tier, float glyph, float group) {
  Fragment fragment = hiddenFragment();
  fragment.visible = true;
  fragment.plane = placed.xy;
  fragment.planeAxis = axis;
  vec2 point = placed.xy;
  vec2 normal = vec2(-axis.y, axis.x) * 0.55;
  if (group > 0.5) {
    point = CORE + turnVector(point - CORE);
    axis = turnVector(axis);
    normal = turnVector(normal);
  }
  fragment.centre = intoBody(point, placed.z);
  fragment.axis = intoBody(axis, axisDepth);
  fragment.normal = intoBody(normal, 0.0);
  fragment.tier = tier;
  fragment.glyph = glyph;
  fragment.group = group;
  return fragment;
}

Fragment readBodyFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float cycle = floor(cycles);
  float life = cycles - cycle;
  if (life >= DUTY) return hiddenFragment();
  float shown = fragmentShown(identity.z);
  if (shown <= 0.0) return hiddenFragment();
  // brightness + 3 × pool + 6 × turning + 12 × glyph, taken apart exactly in integers.
  int code = int(identity.w + 0.5);
  int glyph = code / 12;
  int kind = code - 12 * glyph;
  int group = kind / 6;
  int pool = (kind - 6 * group) / 3;
  float brightness = float(kind - 6 * group - 3 * pool);
  float strength = shown * fragmentStrength(life, id, float(pool));
  if (strength < FAINTEST) return hiddenFragment();

  vec2 unit = shape.xy;
  float fragmentLength = shape.z;
  float hop = fract(cycle * 0.618034 + identity.x);
  float along = (hop - 0.5) * 1.4 * fragmentLength;
  float inward = clamp01((0.76 - dot(rest.xy, rest.xy)) * 3.2);
  float across = (fract(hop * 23.17) - 0.5) * (WANDER + 1.3 * agitation * inward);
  vec3 turned = vec3(rest.x * bodyTurn.x + rest.z * bodyTurn.y, -rest.y, rest.z * bodyTurn.x - rest.x * bodyTurn.y);
  float planeX = dot(turned, viewRight);
  float planeY = -dot(turned, viewUp);
  float depth = dot(turned, viewFront);
  float y = planeY + unit.y * along + unit.x * across;
  float x = planeX + unit.x * along - unit.y * across;
  float lit = strength * clamp01((0.94 * 0.94 - planeX * planeX - y * y) * 8.0);
  if (lit < FAINTEST) return hiddenFragment();

  float drawn;
  float scale;
  vec4 swirled = swirlFragment(vec2(x, y), unit, hashes.z, drawn, scale);
  if (drawn <= 0.0) return hiddenFragment();
  vec3 placed = onLattice(swirled.xy, depth * scale, hashes.w);
  bool scanBright;
  float litHere = lit * scanned(-intoBody(placed.xy, placed.z).y, scanBright);
  if (litHere < FAINTEST) return hiddenFragment();
  bool facing = depth >= 0.0;
  float plain = facing ? fragmentTier(brightness, litHere, hashes.y) : 0.0;
  float tier = scanBright && facing ? 2.0 : plain;
  float halfLength = fragmentLength * 0.5 * litHere * drawn * (1.0 - STROKE_SHRINK * hearing);
  return finishFragment(placed, swirled.zw * halfLength, 0.0, tier, float(glyph), float(group));
}

Fragment readStreamFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float life = cycles - floor(cycles);
  if (life >= DUTY) return hiddenFragment();
  float shown = fragmentShown(identity.z);
  if (shown <= 0.0) return hiddenFragment();
  int code = int(identity.w + 0.5);
  int glyph = code / 12;
  int kind = code - 12 * glyph;
  int pool = kind >= 3 ? 1 : 0;
  float brightness = float(kind - 3 * pool);
  float strength = shown * fragmentStrength(life, id, float(pool));
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
  float tier = depth < 0.0 ? 0.0 : fragmentTier(brightness, lit, hashes.y);

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
  return finishFragment(placed, axis, tangentDepth * size, tier, float(glyph), 0.0);
}

Fragment readFragment() {
  // Rows are in the density share's order, so a share keeps the ones whose key is under it.
  if (thinning >= density) return hiddenFragment();
  // An if rather than ?:, which WebGL does not allow on structures.
  if (rest.w < 0.5) return readBodyFragment();
  return readStreamFragment();
}
`;

/**
 * The glyphs as distance fields, for a fragment shader: 0 dash, 1 L, 2 bracket, 3 T, 4 Z, 5 ring,
 * 6 cell, exactly as `appendGlyph` builds their paths — `h` is the half-length, `n` the normal's
 * length, and the point is in the glyph's own frame, x along it and y along its normal.
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
// segment has no length, as Skia's butt cap does.
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
