import { HALO_RING_SHARE } from 'hologram';
import {
  Color,
  CustomBlending,
  DoubleSide,
  GLSL3,
  type InstancedBufferGeometry,
  LinearFilter,
  MaxEquation,
  Mesh,
  NoColorSpace,
  OneFactor,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  type Texture,
  UnsignedByteType,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FRAGMENT_GLSL, type FragmentUniforms, GLYPH_GLSL, glslFloat } from './fragment-glsl';
import { createRowGeometry, type RowAttributes } from './row-geometry';

/**
 * The particle halos, as the phone paints them: a union per tier, not a pile.
 *
 * Each tier's halos on the phone are one path stroked once, so where a hundred of them overlap the
 * paint still lands on the pixel once. Stacked one by one they would add up to a flat saturated
 * orange coin over most of the disc — the critique measured 0.79–0.85 mean halo brightness that
 * way against the phone's 0.375. So the halos are drawn once a frame, before either eye, into a
 * small target with MAX blending: red, green and blue are how much of each spot the dim, mid and
 * bright halos cover, and the view-plane quad turns that coverage into light the way the phone's
 * Screen blend does (see `view-plane-quad.ts`).
 *
 * They are drawn in the view plane, as the phone's are, each where the centre eye sees its stroke:
 * scaled by the perspective of its depth, so the halo lies under the stroke. The pinned fragments
 * and the ones riding the inner layer go in two halves of the target, because the phone paints
 * those as separate paths, whose halos Screen over each other rather than union.
 */

/** Texels across each half of the target: the same as the flat drawing's, so the halos are as sharp. */
export const HALO_TEXELS = 512;

/**
 * How wide each tier's halo is, in the drawing's unit, and how strong, before the voice's glow:
 * `drawBody` and `drawBodyHighlights` in `hologram/src/hologram-drawing.ts` (about lines
 * 2569–2595) pass these to `drawParticleHalo`, which multiplies the strength by HALO_RING_SHARE.
 */
export const HALO_PAINTS = {
  colour: 0xdc5c20,
  dim: { width: 0.115, strength: 0.3 * HALO_RING_SHARE },
  mid: { width: 0.12, strength: 0.34 * HALO_RING_SHARE },
  bright: { width: 0.115, strength: 0.38 * HALO_RING_SHARE },
};

const VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

// How far the centre eye is from his centre, and one texel, both in the drawing's unit; and his
// radius as a share of the square the target covers.
uniform float eyeDistance;
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
  float perspective = eyeDistance / max(eyeDistance - depth, 0.1 * eyeDistance);
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

const FRAGMENT_SHADER = /* glsl */ `
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

export interface HaloUniforms {
  eyeDistance: { value: number };
  texelUnits: { value: number };
  radiusFraction: { value: number };
}

export interface HaloUnion {
  /** Coverage: the pinned group in the left half, the turning group in the right; R, G, B = dim, mid, bright. */
  texture: Texture;
  uniforms: HaloUniforms;
  /** Draws this frame's coverage. Call after the fragment uniforms are written and before the room is rendered. */
  render(renderer: WebGLRenderer): void;
  dispose(): void;
}

export function createHaloUnion(attributes: RowAttributes, fragmentUniforms: FragmentUniforms): HaloUnion {
  const target = new WebGLRenderTarget(HALO_TEXELS * 2, HALO_TEXELS, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  target.texture.colorSpace = NoColorSpace;
  const uniforms: HaloUniforms = {
    eyeDistance: { value: 1000 },
    texelUnits: { value: 0.01 },
    radiusFraction: { value: 0.27 },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: { ...fragmentUniforms, ...uniforms },
    // Either way round: a glyph's quad is laid along the stroke and its normal, which winds it
    // clockwise as often as not.
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    // The union: each texel keeps the most any halo covers it by.
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });
  const mesh: Mesh<InstancedBufferGeometry, RawShaderMaterial> = new Mesh(createRowGeometry(attributes), material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  // Never read: the shader places everything in the target itself.
  const camera = new OrthographicCamera();
  const savedClearColour = new Color();

  return {
    texture: target.texture,
    uniforms,
    render(renderer) {
      // Into a target of its own, with the headset's cameras out of the way — the pattern three's
      // own Reflector uses — then back to whatever the frame was drawing into.
      const previousTarget = renderer.getRenderTarget();
      const xrEnabled = renderer.xr.enabled;
      const autoClear = renderer.autoClear;
      renderer.getClearColor(savedClearColour);
      const clearAlpha = renderer.getClearAlpha();
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setClearColor(savedClearColour, clearAlpha);
      renderer.autoClear = autoClear;
      renderer.xr.enabled = xrEnabled;
      renderer.setRenderTarget(previousTarget);
    },
    dispose() {
      target.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
