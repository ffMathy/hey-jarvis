import { CHIP_GONE_SECONDS, CHIP_HOLD_SECONDS, PICTURE_SHELL_EDGE } from '../hologram-drawing';
import { glslFloat } from './glsl';
import { SPARKLE_REPEAT } from './sparkle';

/**
 * The shapes everything of him but his body is drawn from, as GLSL: what was Skia's picture.
 *
 * Every layer of it is a few strokes and fills — circular arcs, straight runs and discs — so every
 * layer is drawn from these three shapes, each a quad round the shape with its exact coverage worked
 * out per pixel: a stroke's coverage is a box filter across it a pixel wide, which is what keeps a
 * stroke thinner than a pixel as bright as its area, as Skia's antialiasing does, rather than
 * breaking it into dots. A layer's own vertex shader works out where its shapes are this frame —
 * that is the layer — and hands one of them to `emitSegment`, `emitArcPiece` or `emitDisc`; the
 * fragment shader here colours it. The chips were filled boxes, a fourth shape, until they became
 * streaks.
 *
 * A shape can be lit less than its paint, corner by corner (`shapeLight`, 1 unless its layer says
 * otherwise): how the cage's edges twinkle and fade towards his back, how the embers come and go,
 * and how a chip's streak fades back from its head, while each layer is still one paint and one path.
 *
 * Everything is in a draw's local frame: the drawing's unit (his resting radius is 1, y down) as
 * Skia's canvas was transformed for that draw, taken to the square the picture fills by `toSquare`.
 * `localPerPixel` is how long a device pixel is in it, which every shape's antialiasing is measured
 * in, so a draw's transform must scale it uniformly; a disc's coverage is measured with derivatives
 * instead, so a disc tolerates any.
 */

/**
 * The paints, as `paintKind` carries them: a plain colour, the sparkle modulating it (the cage's
 * hairlines, which glitter as they turn through it), or a radial gradient (the core's glow and the
 * aura), measured from the draw's local origin.
 */
export const PICTURE_PAINTS = { solid: 0, sparkle: 1, radial: 2 } as const;

/** The constants and helpers both stages share, as the drawing wrote them. */
const PICTURE_HELPERS = /* glsl */ `
const float TAU = 6.283185307179586;
const float DEGREES = 0.017453292519943295;

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

float smooth01(float value) {
  float clamped = clamp01(value);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

float fraction(float value) {
  return value - floor(value);
}

// A clock angle, degrees clockwise from 12 o'clock, as radians from 3 o'clock with y down.
float clockRadians(float clockDegrees) {
  return (clockDegrees - 90.0) * DEGREES;
}

// The drawing's repeatable hash of an integer, 0 to 1: Math.imul's arithmetic is a uint's.
float hashInteger(float value) {
  uint mixed = uint(int(value)) * 0x9e3779b1u;
  mixed ^= mixed >> 15u;
  mixed *= 0x85ebca77u;
  mixed ^= mixed >> 13u;
  return float(mixed) / 4294967296.0;
}
`;

/**
 * A burst's shard this frame, which the chips' layer places its quads by (`drawChips`): a streak of
 * light flung off the left of the shell's edge, from its tail to its head, how much thinner than its
 * paint it has grown as it breaks up, and how lit it still is. False where it is not drawn.
 */
const CHIP_GLSL = /* glsl */ `
// The latest burst: its age, number, reach and strength.
uniform vec4 burst;

bool chipShard(
  float chip,
  float shard,
  float piece,
  float hotCore,
  out vec2 tail,
  out vec2 head,
  out float thinning,
  out float light
) {
  tail = vec2(0.0);
  head = vec2(0.0);
  thinning = 1.0;
  light = 0.0;
  float age = burst.x;
  float count = burst.y;
  float reach = burst.z;
  // a small onset throws three chips, a loud one five
  if (chip >= 3.0 + floor(reach * 2.0 + 0.5)) return false;
  float size = 0.78 + 0.22 * reach;
  bool split = hashInteger(count * 53.0 + 1.0) < 0.33;
  float base = 255.0 + hashInteger(count * 131.0 + 7.0) * 35.0;
  float flight = age / ${glslFloat(CHIP_GONE_SECONDS)};
  float breakUp = clamp01((age - ${glslFloat(CHIP_HOLD_SECONDS)}) / ${glslFloat(CHIP_GONE_SECONDS - CHIP_HOLD_SECONDS)});
  float seed = count * 211.0 + chip * 17.0;
  bool upper = split && mod(chip, 2.0) == 0.0;
  bool leads = chip == 0.0;
  float centre = split ? (upper ? 300.0 : 250.0) : base;
  float launch = centre + (hashInteger(seed) - 0.5) * (split ? 16.0 : 52.0);
  // A chip is a few shards: its first the main streak, the others splinters thrown a few degrees to
  // either side of it, a little slower, and shorter.
  float shardSeed = seed + shard * 37.0 + 3.0;
  float splinter = shard > 0.5 ? 1.0 : 0.0;
  float clock = launch
    + splinter * (hashInteger(shardSeed) - 0.5) * 12.0
    - (upper ? 14.0 : 8.0 + 14.0 * hashInteger(seed + 5.0)) * flight;
  float speed = (leads ? 1.6 + 0.7 * hashInteger(seed + 3.0) : 0.9 + 1.2 * hashInteger(seed + 3.0))
    * (1.0 - splinter * (0.15 + 0.25 * hashInteger(shardSeed + 1.0)));
  float chipSize = size * (leads ? 1.05 : 0.6 + 0.35 * hashInteger(seed + 9.0));
  float angle = clockRadians(clock);
  vec2 outward = vec2(cos(angle), sin(angle));
  // Each leans a little off straight out, as light thrown off a turning edge does.
  float lean = (hashInteger(shardSeed + 2.0) - 0.5) * 0.7;
  vec2 along = vec2(outward.x * cos(lean) - outward.y * sin(lean), outward.x * sin(lean) + outward.y * cos(lean));
  float headRadius = ${glslFloat(PICTURE_SHELL_EDGE + 0.06)} + speed * age;
  float streak = chipSize
    * (splinter > 0.5 ? 0.06 + 0.05 * hashInteger(shardSeed + 4.0) : 0.17 + 0.09 * hashInteger(seed + 7.0))
    * (1.0 - 0.3 * breakUp);
  // It streaks back along the way it came, but never from inside the edge it left.
  streak = min(streak, headRadius - ${glslFloat(PICTURE_SHELL_EDGE - 0.02)});
  // Breaking up, it snaps in two, and the pieces draw apart, thin and fade as they go.
  float pieces = breakUp > 0.0 ? 2.0 : 1.0;
  if (streak < 0.01 || piece >= pieces) return false;
  float gap = breakUp * streak * 0.35;
  float pieceLength = pieces == 1.0 ? streak : (streak - gap) * 0.5;
  head = outward * headRadius - along * (piece == 0.0 ? 0.0 : pieceLength + gap);
  // its white-hot core is the front half of it
  tail = head - along * pieceLength * (hotCore > 0.5 ? 0.5 : 1.0);
  thinning = 1.0 - 0.45 * breakUp;
  light = 1.0 - 0.6 * breakUp * breakUp;
  return true;
}
`;

/** What every layer's vertex shader starts with: the frame, the helpers and the shapes. */
export const PICTURE_VERTEX_PRELUDE = /* glsl */ `
precision highp float;
precision highp int;

// The draw's local frame to the square the picture fills, 0 to 1 across and y down, and how many of
// its units a device pixel is.
uniform mat3 toSquare;
uniform float localPerPixel;

// Each shape's quad: its corner at ±1, along it and across it.
in vec2 corner;

out vec2 local;
flat out vec4 shapeA;
flat out vec4 shapeB;
flat out vec4 shapeC;
flat out float shapeKind;
// How lit the shape is at this corner, 0 to 1, as a share of its paint: 1 unless its layer says.
out float shapeLight;

${PICTURE_HELPERS}
${CHIP_GLSL}
void place(vec2 at) {
  local = at;
  vec2 square = (toSquare * vec3(at, 1.0)).xy;
  gl_Position = vec4(square.x * 2.0 - 1.0, 1.0 - square.y * 2.0, 0.0, 1.0);
}

// A shape not drawn this frame: every corner outside the clip volume, so nothing is rasterised.
void hide() {
  local = vec2(0.0);
  shapeA = vec4(0.0);
  shapeB = vec4(0.0);
  shapeC = vec4(0.0);
  shapeKind = 0.0;
  shapeLight = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}

// A straight run of a path from one point to another. Where it meets the run before it (\`joins\` 1)
// or after it (\`joins\` 2, both 3) its end is round, which is the path's round join drawn by the two
// runs together (a pixel they share is painted once, as the one that covers it more: see
// \`drawShapes\`); where it is the path's own end the end is round or cut square (butt), as Skia's
// caps are.
void emitRun(vec2 from, vec2 to, float halfWidth, float joins, float roundStart, float roundEnd) {
  vec2 run = to - from;
  float runLength = length(run);
  bool joinedBefore = mod(joins, 2.0) > 0.5;
  bool joinedAfter = joins > 1.5;
  float startRound = joinedBefore ? 1.0 : roundStart;
  float endRound = joinedAfter ? 1.0 : roundEnd;
  // A butt-capped run of no length is not drawn at all, as Skia draws none.
  if (runLength < 1e-6 && startRound < 0.5 && endRound < 0.5) {
    hide();
    return;
  }
  vec2 along = runLength > 0.0 ? run / runLength : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float reach = halfWidth + localPerPixel;
  vec2 end = corner.x < 0.0
    ? from - along * (startRound > 0.5 ? reach : localPerPixel)
    : to + along * (endRound > 0.5 ? reach : localPerPixel);
  shapeKind = 1.0;
  shapeA = vec4(from, to);
  shapeB = vec4(halfWidth, roundStart, roundEnd, joins);
  shapeC = vec4(0.0);
  shapeLight = 1.0;
  place(end + across * corner.y * reach);
}

// A run that is a path of its own.
void emitSegment(vec2 from, vec2 to, float halfWidth, float roundStart, float roundEnd) {
  emitRun(from, to, halfWidth, 0.0, roundStart, roundEnd);
}

// One of \`pieces\` equal pieces of a circular arc from \`start\` through \`sweep\` radians (y down, so
// a positive sweep is clockwise): an arc is drawn as several quads so that none of them covers much
// more than the band itself. Each quad's sides run straight out from the centre along its own first
// and last angle, and a piece's neighbour starts on the very line it ends on, so the quads never
// overlap and every pixel between them is the rasteriser's to give to one or the other.
void emitArcPiece(
  vec2 centre,
  float radius,
  float halfWidth,
  float start,
  float sweep,
  float piece,
  float pieces,
  float roundStart,
  float roundEnd
) {
  if (sweep == 0.0 || radius <= 0.0) {
    hide();
    return;
  }
  if (sweep < 0.0) {
    start += sweep;
    sweep = -sweep;
    float swapped = roundStart;
    roundStart = roundEnd;
    roundEnd = swapped;
  }
  float whole = sweep >= TAU ? 1.0 : 0.0;
  sweep = min(sweep, TAU);
  float pieceSweep = sweep / pieces;
  float from = start + pieceSweep * piece;
  float to = from + pieceSweep;
  float reach = halfWidth + localPerPixel;
  // Round caps and the antialiasing reach a little past the arc's two ends.
  float before = whole < 0.5 && piece < 0.5 ? min((roundStart > 0.5 ? reach : localPerPixel) / radius, 0.6) : 0.0;
  float after = whole < 0.5 && piece > pieces - 1.5 ? min((roundEnd > 0.5 ? reach : localPerPixel) / radius, 0.6) : 0.0;
  float first = from - before;
  float last = to + after;
  float halfSpan = (last - first) * 0.5;
  float inner = max(radius - reach, 0.0);
  float outer = (radius + reach) / cos(halfSpan);
  float angle = corner.x < 0.0 ? first : last;
  shapeKind = 2.0;
  shapeA = vec4(centre, radius, halfWidth);
  shapeB = vec4(start, sweep, roundStart, roundEnd + 2.0 * whole);
  shapeC = vec4(piece, pieces, 0.0, 0.0);
  shapeLight = 1.0;
  place(centre + vec2(cos(angle), sin(angle)) * (corner.y < 0.0 ? inner : outer));
}

// A filled circle.
void emitDisc(vec2 centre, float radius) {
  float reach = radius + localPerPixel;
  shapeKind = 3.0;
  shapeA = vec4(centre, radius, 0.0);
  shapeB = vec4(0.0);
  shapeC = vec4(0.0);
  shapeLight = 1.0;
  place(centre + corner * reach);
}
`;

/**
 * How much of the depth range one path's band spans: path \`n\` of a frame (its stencil value, 1 to
 * 255) draws between \`pathDepthOf(n)\` and that less this, so every later path is nearer than every
 * earlier one, and within a path the more a fragment covers the nearer it is.
 */
export const PATH_DEPTH_SPAN = 0.99 / 256;

/** Where a path's band of depths starts: see {@link PATH_DEPTH_SPAN}. */
export function pathDepthOf(path: number): number {
  'worklet';
  return (256 - path) / 256;
}

/** Texels across a gradient's row, and how many rows the gradients' texture has. */
export const GRADIENT_TEXELS = 1024;
export const GRADIENT_ROWS = 2;

/**
 * The one fragment shader every layer shares: the shape's coverage, the paint, Screen-blended by
 * the blend state (premultiplied light, `ONE, ONE_MINUS_SRC_COLOR`), as every one of Skia's paints
 * here was.
 */
export const PICTURE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform float localPerPixel;
// The paint: its colour premultiplied by its alpha, or (alpha, alpha, alpha, alpha) under a gradient.
uniform vec4 paintColour;
uniform int paintKind;
uniform sampler2D sparkle;
uniform sampler2D gradients;
// The radial gradient's row, and the radius it reaches its end at.
uniform vec2 gradient;
// Where the path's band of depths starts.
uniform float pathDepth;

in vec2 local;
flat in vec4 shapeA;
flat in vec4 shapeB;
flat in vec4 shapeC;
flat in float shapeKind;
in float shapeLight;

out vec4 colour;

${PICTURE_HELPERS}
const float PATH_DEPTH_SPAN = ${glslFloat(PATH_DEPTH_SPAN)};

// How much of a pixel a band \`halfPixels\` either side of a line covers, \`distancePixels\` from it:
// the band's width box-filtered over the pixel, so a band under a pixel wide covers its area.
float band(float distancePixels, float halfPixels) {
  float away = abs(distancePixels);
  return clamp(halfPixels + 0.5 - away, 0.0, 1.0) - clamp(0.5 - halfPixels - away, 0.0, 1.0);
}

// How far a point is from a run with round ends.
float capsuleDistance(vec2 point, vec2 from, vec2 to) {
  vec2 run = to - from;
  float share = clamp(dot(point - from, run) / max(dot(run, run), 1e-12), 0.0, 1.0);
  return length(point - from - run * share);
}

float segmentCoverage(vec2 point) {
  vec2 from = shapeA.xy;
  vec2 to = shapeA.zw;
  float halfPixels = shapeB.x / localPerPixel;
  bool joinedBefore = mod(shapeB.w, 2.0) > 0.5;
  bool joinedAfter = shapeB.w > 1.5;
  vec2 run = to - from;
  float runLength = length(run);
  vec2 along = runLength > 0.0 ? run / runLength : vec2(1.0, 0.0);
  vec2 offset = point - from;
  float alongPoint = dot(offset, along);
  bool buttBefore = !joinedBefore && shapeB.y < 0.5;
  bool buttAfter = !joinedAfter && shapeB.z < 0.5;
  // Past a butt end only the band across the run reaches, cut square; elsewhere the run is round.
  float away = (buttBefore && alongPoint < 0.0) || (buttAfter && alongPoint > runLength)
    ? abs(dot(offset, vec2(-along.y, along.x)))
    : capsuleDistance(point, from, to);
  float covered = band(away / localPerPixel, halfPixels);
  if (buttBefore) covered *= clamp(alongPoint / localPerPixel + 0.5, 0.0, 1.0);
  if (buttAfter) covered *= clamp((runLength - alongPoint) / localPerPixel + 0.5, 0.0, 1.0);
  return covered;
}

float arcCoverage(vec2 point) {
  vec2 centre = shapeA.xy;
  float radius = shapeA.z;
  float halfPixels = shapeA.w / localPerPixel;
  float start = shapeB.x;
  float sweep = shapeB.y;
  float whole = shapeB.w >= 1.5 ? 1.0 : 0.0;
  float roundStart = shapeB.z;
  float roundEnd = shapeB.w - 2.0 * whole;
  vec2 offset = point - centre;
  float fromCentre = length(offset);
  // The pieces' quads meet edge to edge, so a pixel is drawn by whichever quad the rasteriser gave it
  // to, and no piece asks which of them the pixel's angle belongs to. It used to: a pixel whose centre
  // lay on the line two pieces meet on — every pixel on a 45-degree diagonal through a circle centred
  // on a pixel corner, as the aura is — was rasterised by one quad while the angle, worked out in
  // floating point, gave it to the other, so neither painted it, and the aura showed a dark line
  // down each lower diagonal.
  if (whole > 0.5) return band((fromCentre - radius) / localPerPixel, halfPixels);
  // How far round from the start this pixel is, 0 to a turn.
  float turned = mod(atan(offset.y, offset.x) - start, TAU);
  if (turned <= sweep) {
    float covered = band((fromCentre - radius) / localPerPixel, halfPixels);
    if (roundStart < 0.5) covered *= clamp(turned * fromCentre / localPerPixel + 0.5, 0.0, 1.0);
    if (roundEnd < 0.5) covered *= clamp((sweep - turned) * fromCentre / localPerPixel + 0.5, 0.0, 1.0);
    return covered;
  }
  // Past the arc's ends only the end pieces' quads reach, and each draws its own end: the gap past
  // the arc is split at its middle, the start's piece taking the half nearer the start.
  float gapMiddle = sweep + (TAU - sweep) * 0.5;
  bool nearStart = turned >= gapMiddle;
  bool isFirst = shapeC.x < 0.5;
  bool isLast = shapeC.x > shapeC.y - 1.5;
  if (nearStart ? !isFirst : !isLast) return 0.0;
  float endAngle = nearStart ? start : start + sweep;
  float isRound = nearStart ? roundStart : roundEnd;
  if (isRound > 0.5) {
    vec2 end = centre + vec2(cos(endAngle), sin(endAngle)) * radius;
    return band(length(point - end) / localPerPixel, halfPixels);
  }
  float beyond = (nearStart ? TAU - turned : turned - sweep) * fromCentre / localPerPixel;
  return band((fromCentre - radius) / localPerPixel, halfPixels) * clamp(0.5 - beyond, 0.0, 1.0);
}

float discCoverage(vec2 point) {
  float signedDistance = length(point - shapeA.xy) - shapeA.z;
  return clamp(0.5 - signedDistance / max(fwidth(signedDistance), 1e-6), 0.0, 1.0);
}

vec4 gradientAt(float row, float position) {
  float texel = clamp(position, 0.0, 1.0) * ${glslFloat(GRADIENT_TEXELS - 1)} + 0.5;
  return texture(gradients, vec2(texel / ${glslFloat(GRADIENT_TEXELS)}, (row + 0.5) / ${glslFloat(GRADIENT_ROWS)}));
}

void main() {
  float shapeCovered = shapeKind < 1.5
    ? segmentCoverage(local)
    : shapeKind < 2.5
      ? arcCoverage(local)
      : discCoverage(local);
  // How lit a shape is counts as how much it covers, so where a path's shapes overlap the one
  // that lights a pixel most is the one painted there.
  float covered = shapeCovered * clamp(shapeLight, 0.0, 1.0);
  if (covered < 0.001) discard;
  // Within its path's own band of depths, nearer the more it covers: see \`drawShapes\`.
  gl_FragDepth = pathDepth - covered * PATH_DEPTH_SPAN;
  vec4 paint = paintColour;
  if (paintKind == ${PICTURE_PAINTS.sparkle}) {
    paint.rgb *= texture(sparkle, local / ${glslFloat(SPARKLE_REPEAT)}).r;
  } else if (paintKind == ${PICTURE_PAINTS.radial}) {
    paint *= gradientAt(gradient.x, length(local) / gradient.y);
  }
  colour = paint * covered;
}
`;
