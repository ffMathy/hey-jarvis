import { FRAGMENT_GLSL, GLYPH_GLSL } from './fragment-glsl';
import { glslColour, glslFloat } from './glsl';
import { SPARKLE_REPEAT } from './sparkle';

/**
 * The body's strokes, each where its fragment really is in three dimensions: one view-facing quad a
 * row, its glyph drawn in it as a distance field, antialiased, in the drawing's tier paints and
 * sparkle.
 *
 * The shaders take three.js's names for the matrices (`modelViewMatrix`, `projectionMatrix`), which
 * three binds by itself to a RawShaderMaterial and the raw renderer (`gpu-body.ts`) sets by hand:
 * the body's frame, in the drawing's unit, to the eye, and the eye to clip space. `viewportHeight` is
 * the pixels of the viewport being drawn and `unitMetres` how long the drawing's unit is in whatever
 * units the model-view matrix ends in (1 when it ends in the drawing's unit), which is only what a
 * pixel is worked out from. They write premultiplied light, with alpha `alphaFromLight` of its
 * brightest channel; the fade is the blend's, the headset's (`vr/src/hologram3d/layer-blending.ts`)
 * and the raw renderer's alike.
 */

/**
 * The tiers' paints are the drawing's, from `hologram/src/hologram-drawing.ts`: the colours from
 * `createHologramResources` (bodyDimStroke, bodyMidStroke, bodyBrightStroke, bodyHotStroke) and the
 * widths and alphas `drawBody` and `drawBodyHighlights` set inline. Widths are full widths in the
 * drawing's unit; the shaders use halves.
 */
export const STROKE_PAINTS = {
  dim: { colour: 0xcc6e2c, width: 0.014, alpha: 0.62 },
  mid: { colour: 0xf87026, width: 0.0155, alpha: 0.85 },
  /** Its alpha is 1 − 0.25 × agitation. */
  bright: { colour: 0xff7e28, width: 0.0165, alpha: 1 },
  /** Round-capped, on the bright strokes only; its alpha is 0.8 × (1 − 0.95 × agitation). */
  hot: { colour: 0xff8e3c, width: 0.007, alpha: 0.8 },
};

/**
 * The narrowest a stroke is drawn, in pixels. A thinner one is drawn this wide and dimmed by as
 * much, so it carries the same light rather than breaking up into dots between pixels — the hot
 * cores are 0.007R, a pixel and a half at conversational distance on a Quest 3.
 */
export const THINNEST_STROKE_PIXELS = 1.2;

export const STROKE_VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The height of the viewport being drawn, in pixels, and how many metres the drawing's unit is.
uniform float viewportHeight;
uniform float unitMetres;

in vec2 corner;

${FRAGMENT_GLSL}
${GLYPH_GLSL}

// Where this corner is in the glyph's own frame — along it, across it — in the drawing's unit.
out vec2 local;
// Where it is in the view plane before the inner layer's turn, which is where the sparkle is read.
out vec2 sparklePoint;
// The glyph, its half-length, its normal's length and its tier.
flat out vec4 glyphShape;

const float WIDEST_HALF_STROKE = ${glslFloat(STROKE_PAINTS.bright.width / 2)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};

void main() {
  Fragment fragment = readFragment();
  if (!fragment.visible) {
    // Past the far plane, so nothing of it is drawn.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float halfLength = length(fragment.axis);
  vec3 along = halfLength > 1e-7 ? fragment.axis / halfLength : viewRight;
  // Square to the stroke in the view plane, on the side the drawing's glyphs put their ticks.
  vec3 across = normalize(cross(along, viewFront));
  float normalLength = length(fragment.normal);
  vec2 reach = glyphReach(fragment.glyph, halfLength, normalLength);

  // How big a pixel is where the fragment is, in the drawing's unit, so the quad is wide enough for
  // the stroke however far away it is, with room for its antialiased edge.
  vec4 clipCentre = projectionMatrix * modelViewMatrix * vec4(fragment.centre, 1.0);
  float pixel = 2.0 * abs(clipCentre.w) / (projectionMatrix[1][1] * viewportHeight * unitMetres);
  float margin = max(WIDEST_HALF_STROKE, 0.5 * THINNEST_PIXELS * pixel) + 1.5 * pixel;
  local = corner * (reach + margin);

  float planeLength = length(fragment.planeAxis);
  vec2 planeAlong = planeLength > 1e-7 ? fragment.planeAxis / planeLength : vec2(1.0, 0.0);
  sparklePoint = fragment.plane + planeAlong * local.x + vec2(-planeAlong.y, planeAlong.x) * local.y;
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(fragment.centre + along * local.x + across * local.y, 1.0);
}
`;

export const STROKE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D sparkle;
uniform float agitation;
// How much of what is behind his light it hides; the fades are the blend's.
uniform float alphaFromLight;

in vec2 local;
in vec2 sparklePoint;
flat in vec4 glyphShape;

out vec4 colour;

${GLYPH_GLSL}

const vec3 DIM = ${glslColour(STROKE_PAINTS.dim.colour)};
const vec3 MID = ${glslColour(STROKE_PAINTS.mid.colour)};
const vec3 BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)};
const vec3 HOT = ${glslColour(STROKE_PAINTS.hot.colour)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};
const float SPARKLE_REPEAT = ${glslFloat(SPARKLE_REPEAT)};

// Coverage of a shape at this distance from its edge, antialiased over one pixel.
float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

void main() {
  float glyph = glyphShape.x;
  float halfLength = glyphShape.y;
  float normalLength = glyphShape.z;
  float tier = glyphShape.w;
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float sparkleLevel = texture(sparkle, sparklePoint / SPARKLE_REPEAT).r;

  vec3 paint = DIM;
  float halfWidth = ${glslFloat(STROKE_PAINTS.dim.width / 2)};
  float strength = ${glslFloat(STROKE_PAINTS.dim.alpha)};
  if (tier > 1.5) {
    paint = BRIGHT * sparkleLevel;
    halfWidth = ${glslFloat(STROKE_PAINTS.bright.width / 2)};
    strength = 1.0 - 0.25 * agitation;
  } else if (tier > 0.5) {
    paint = MID * sparkleLevel;
    halfWidth = ${glslFloat(STROKE_PAINTS.mid.width / 2)};
    strength = ${glslFloat(STROKE_PAINTS.mid.alpha)};
  }
  float drawnHalf = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  strength *= halfWidth / drawnHalf;
  vec3 light = paint * strength * coverage(glyphStrokeDistance(local, glyph, halfLength, normalLength, drawnHalf), pixel);

  if (tier > 1.5) {
    float hotHalf = ${glslFloat(STROKE_PAINTS.hot.width / 2)};
    float drawnHot = max(hotHalf, 0.5 * THINNEST_PIXELS * pixel);
    float hotStrength = ${glslFloat(STROKE_PAINTS.hot.alpha)} * (1.0 - 0.95 * agitation) * hotHalf / drawnHot;
    float hotDistance = glyphLineDistance(local, glyph, halfLength, normalLength) - drawnHot;
    vec3 hot = HOT * sparkleLevel * hotStrength * coverage(hotDistance, pixel);
    // Screen, as the phone lays the hot core over the bright stroke.
    light = light + hot - light * hot;
  }
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest <= 0.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;
