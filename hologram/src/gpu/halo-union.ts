import { FRAGMENT_GLSL, GLYPH_GLSL } from './fragment-glsl';
import { glslFloat } from './glsl';

/**
 * The particle halos, as the phone paints them: a union per tier, not a pile.
 *
 * Each tier's halos on the phone are one path stroked once, so where a hundred of them overlap the
 * paint still lands on the pixel once. Stacked one by one they would add up to a flat saturated
 * orange coin over most of the disc, more than twice as bright on average as the phone's union. So
 * the halos are drawn once a frame, before any eye, into a small target with MAX blending: red,
 * green and blue are how much of each spot the dim, mid and bright halos cover, and the halos' light
 * (`halo-light.ts`) turns that coverage into light the way the phone's Screen blend does.
 *
 * They are drawn in the view plane, as the phone's are, each where the centre eye sees its stroke:
 * scaled by the perspective of its depth, so the halo lies under the stroke. The pinned fragments
 * and the ones riding the inner layer go in two halves of the target, because the phone paints
 * those as separate paths, whose halos Screen over each other rather than union.
 */

/** Texels across each half of the target: the same as Skia's picture on the headset, so the halos are as sharp. */
export const HALO_TEXELS = 512;

/** What one ring of a halo contributes: each tier's strength below is scaled by it. */
const HALO_RING_SHARE = 0.52;

/** How wide each tier's halo is, in the drawing's unit, and how strong, before the voice's glow. */
export const HALO_PAINTS = {
  colour: 0xdc5c20,
  dim: { width: 0.115, strength: 0.3 * HALO_RING_SHARE },
  mid: { width: 0.12, strength: 0.34 * HALO_RING_SHARE },
  bright: { width: 0.115, strength: 0.38 * HALO_RING_SHARE },
};

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
  haloRadius = 0.5 * (fragment.tier > 0.5 && fragment.tier < 1.5 ? ${glslFloat(HALO_PAINTS.mid.width)} : ${glslFloat(HALO_PAINTS.dim.width)}) * perspective;
  local = corner * (glyphReach(fragment.glyph, halfLength, normalLength) + haloRadius + 1.5 * texelUnits);
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);

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

out vec4 colour;

${GLYPH_GLSL}

void main() {
  float texel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float edgeDistance = glyphLineDistance(local, glyphShape.x, glyphShape.y, glyphShape.z) - haloRadius;
  float covered = clamp(0.5 - edgeDistance / texel, 0.0, 1.0);
  if (covered <= 0.0) discard;
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
