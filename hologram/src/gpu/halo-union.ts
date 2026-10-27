import { FRAGMENT_GLSL, GLYPH_GLSL } from './fragment-glsl';
import { glslFloat } from './glsl';

/**
 * The particle halos: the soft glow round his specks, a union per tier, not a pile.
 *
 * In the film everything glows — near-white at the hot centres, falling off through orange — and a
 * speck's halo is that glow: a radial falloff from its stroke, full on the stroke and nothing at
 * the tier's radius, rather than the flat capsule it used to be. Each tier's halos are unioned, not
 * summed: stacked one by one, a hundred overlapping halos would add up to a flat saturated coin
 * over most of the disc, and the user wants the middle of him to stay see-through between his
 * light. So the halos are drawn once a frame, before any eye, into a small target with MAX
 * blending: red, green and blue are how much of each spot the dim, mid and bright halos light, and
 * the halos' light (`halo-light.ts`) turns that into light the way a Screen blend would. Unioned,
 * the soft halos make one smooth envelope of glow round the bright shell, highest where the
 * specks crowd and gone a halo's radius past the last of them.
 *
 * They are drawn in the view plane, each where the centre eye sees its stroke: scaled by the
 * perspective of its depth, so the halo lies under the stroke. The pinned fragments and the ones
 * riding the inner layer go in two halves of the target, because they are separate layers, whose
 * halos Screen over each other rather than union.
 */

/** Texels across each half of the target: the same as the picture on the headset, so the halos are as sharp. */
export const HALO_TEXELS = 512;

/**
 * How wide each tier's halo is — twice the distance from its stroke at which its glow is gone — in
 * the drawing's unit, and how strong it is on the stroke, before the voice's glow. Warm orange-gold.
 * The bright specks bloom, each a point of glow of its own; the mid and dim ones lay a broad warm
 * haze through him, as the old body's halos did, which is much of how packed he looks. Every halo is
 * as strong as its speck's `light`. The widest reaches 0.08R past its stroke, so from the shell's
 * edge at 0.87R no halo gets near the edge of the target at ±1.85R.
 */
export const HALO_PAINTS = {
  colour: 0xdc7426,
  dim: { width: 0.11, strength: 0.18 },
  mid: { width: 0.12, strength: 0.24 },
  bright: { width: 0.16, strength: 0.65 },
};

/**
 * How a halo's glow falls off across its radius: `(1 − d/r)^HALO_FALLOFF` at a distance `d` from
 * its stroke. Squared, it is a soft peak rather than a plateau, so where specks crowd the union is
 * a smooth glow brightest on the specks, and where they are sparse each one is a point of bloom.
 */
const HALO_FALLOFF = 2;

export const HALO_UNION_VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

// One texel, in the drawing's unit, and his radius as a share of the square the target covers.
uniform float texelUnits;
uniform float radiusFraction;

in vec2 corner;

${FRAGMENT_GLSL}
${GLYPH_GLSL}

out vec2 local;
flat out vec4 glyphShape;
flat out float haloRadius;
flat out float shellLight;

void main() {
  Fragment fragment = readFragment();
  if (!fragment.visible) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  // Onto the plane through his centre as the centre eye sees it.
  float depth = dot(fragment.centre, viewFront);
  float perspective = seenLarger(depth);
  vec2 centre = vec2(dot(fragment.centre, viewRight), -dot(fragment.centre, viewUp)) * perspective;
  vec2 axis = vec2(dot(fragment.axis, viewRight), -dot(fragment.axis, viewUp)) * perspective;
  float halfLength = length(axis);
  vec2 along = halfLength > 1e-7 ? axis / halfLength : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float normalLength = length(fragment.normal) * perspective;
  float width = fragment.tier > 1.5 ? ${glslFloat(HALO_PAINTS.bright.width)} : (fragment.tier > 0.5 ? ${glslFloat(HALO_PAINTS.mid.width)} : ${glslFloat(HALO_PAINTS.dim.width)});
  haloRadius = 0.5 * width * perspective;
  local = corner * (glyphReach(fragment.glyph, halfLength, normalLength) + haloRadius + 1.5 * texelUnits);
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);
  shellLight = fragment.light;

  // Into the target: the pinned half on the left, the turning half on the right, y up as a
  // texture's rows go.
  vec2 point = centre + along * local.x + across * local.y;
  vec2 share = vec2(0.5 + point.x * radiusFraction, 0.5 - point.y * radiusFraction);
  gl_Position = vec4(share.x - 1.0 + fragment.group, 2.0 * share.y - 1.0, 0.0, 1.0);
}
`;

export const HALO_UNION_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

in vec2 local;
flat in vec4 glyphShape;
flat in float haloRadius;
flat in float shellLight;

out vec4 colour;

${GLYPH_GLSL}

void main() {
  float reached = glyphLineDistance(local, glyphShape.x, glyphShape.y, glyphShape.z) / haloRadius;
  if (reached >= 1.0) discard;
  float covered = pow(1.0 - reached, ${glslFloat(HALO_FALLOFF)}) * shellLight;
  float tier = glyphShape.w;
  colour = vec4(tier < 0.5 ? covered : 0.0, tier > 0.5 && tier < 1.5 ? covered : 0.0, tier > 1.5 ? covered : 0.0, 0.0);
}
`;

/** What the halo union is told each frame, beside the fragment uniforms. */
export interface HaloUnionPlacement {
  /** One texel, in the drawing's unit. */
  texelUnits: number;
  /** His radius as a share of the square the target covers: `state.radius` of a frame analysed at size 1. */
  radiusFraction: number;
}

/**
 * Where the halo union puts this frame in its target: the square it covers is the drawing's own
 * square (the phone's canvas, the headset's view-plane quad), so a frame analysed at size 1 gives
 * his radius as a share of it directly. `texels` is how many texels across each half of the target
 * is: HALO_TEXELS on the headset, fewer where the halos are drawn smaller (a watch).
 */
export function haloUnionPlacement(
  radiusShare: number,
  into: HaloUnionPlacement,
  texels: number = HALO_TEXELS,
): HaloUnionPlacement {
  'worklet';
  into.radiusFraction = radiusShare;
  into.texelUnits = 1 / (radiusShare * texels);
  return into;
}
