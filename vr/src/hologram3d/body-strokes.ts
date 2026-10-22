import { type FragmentUniforms, STROKE_FRAGMENT_SHADER, STROKE_VERTEX_SHADER } from 'hologram/gpu';
import { type BufferGeometry, DoubleSide, GLSL3, Mesh, RawShaderMaterial, type Texture, Vector4 } from 'three';
import { LAYER_BLENDING, setLayerFade } from './layer-blending';
import { ALPHA_FROM_LIGHT } from './view-plane-quad';

/** The uniforms the strokes read beyond the fragment arithmetic's. */
export interface StrokeUniforms {
  viewportHeight: { value: number };
  unitMetres: { value: number };
  sparkle: { value: Texture };
  alphaFromLight: { value: number };
}

export interface BodyStrokes {
  mesh: Mesh<BufferGeometry, RawShaderMaterial>;
  uniforms: StrokeUniforms;
  /** Lets go of the material; the rows' geometry is the caller's, shared with the halo union. */
  dispose(): void;
}

/**
 * The strokes — `hologram/gpu`'s shaders and paints (its `body-strokes.ts`) — as one draw of every
 * row of `rowGeometry` (`row-geometry.ts`), Screen-blended over the room and faded as one layer
 * with the rest of him (see `layer-blending.ts`), writing alpha as a share of the light (see
 * ALPHA_FROM_LIGHT), with no depth written.
 *
 * Unlike the phone, strokes of one tier that cross add up rather than forming a union — the phone
 * strokes each tier as one path. They are thin and seldom cross, which is why the halos, which
 * overlap everywhere, get a union pass of their own and these do not.
 */
export function createBodyStrokes(
  rowGeometry: BufferGeometry,
  fragmentUniforms: FragmentUniforms,
  sparkle: Texture,
): BodyStrokes {
  const uniforms: StrokeUniforms = {
    viewportHeight: { value: 1 },
    unitMetres: { value: 1 },
    sparkle: { value: sparkle },
    alphaFromLight: { value: ALPHA_FROM_LIGHT },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: STROKE_VERTEX_SHADER,
    fragmentShader: STROKE_FRAGMENT_SHADER,
    uniforms: { ...fragmentUniforms, ...uniforms },
    // Either way round: a glyph's quad is laid along the stroke and its normal, which winds it
    // clockwise as often as not.
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    ...LAYER_BLENDING,
  });
  setLayerFade(material, 1);
  const mesh = new Mesh(rowGeometry, material);
  // The quad's corners are only moved into place by the shader, so three's bounds say nothing.
  mesh.frustumCulled = false;
  const viewport = new Vector4();
  mesh.onBeforeRender = (renderer) => {
    // Once per eye in a headset, each with its own viewport.
    uniforms.viewportHeight.value = Math.max(1, renderer.getCurrentViewport(viewport).w);
  };
  return {
    mesh,
    uniforms,
    dispose() {
      material.dispose();
    },
  };
}
