import { type FragmentUniforms, HALO_TEXELS, HALO_UNION_FRAGMENT_SHADER, HALO_UNION_VERTEX_SHADER } from 'hologram/gpu';
import {
  type BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  GLSL3,
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

/**
 * The particle halos as a union per tier, drawn once a frame into a target of their own: the
 * shaders are `hologram/gpu`'s (its `halo-union.ts` says why a union), and this is how three.js
 * draws them.
 */

/** What the halo union is told each frame beside the fragment uniforms (`haloUnionPlacement`). */
export interface HaloUniforms {
  texelUnits: { value: number };
  radiusFraction: { value: number };
}

export interface HaloUnion {
  /** Coverage: the pinned group in the left half, the turning group in the right; R, G, B = dim, mid, bright. */
  texture: Texture;
  uniforms: HaloUniforms;
  /** The draw of every row's halo, in a scene of its own, and the target it draws into. */
  mesh: Mesh<BufferGeometry, RawShaderMaterial>;
  target: WebGLRenderTarget;
  /** Draws this frame's coverage. Call after the fragment uniforms are written and before the room is rendered. */
  render(renderer: WebGLRenderer): void;
  /** Lets go of the target and the material; the rows' geometry is the caller's, shared with the strokes. */
  dispose(): void;
}

/** The halos of every row of `rowGeometry` (`row-geometry.ts`), placed by `fragmentUniforms`. */
export function createHaloUnion(rowGeometry: BufferGeometry, fragmentUniforms: FragmentUniforms): HaloUnion {
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
    texelUnits: { value: 0.01 },
    radiusFraction: { value: 0.27 },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: HALO_UNION_VERTEX_SHADER,
    fragmentShader: HALO_UNION_FRAGMENT_SHADER,
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
  const mesh = new Mesh(rowGeometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  // Never read: the shader places everything in the target itself.
  const camera = new OrthographicCamera();
  const savedClearColour = new Color();

  return {
    texture: target.texture,
    mesh,
    target,
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
    },
  };
}
