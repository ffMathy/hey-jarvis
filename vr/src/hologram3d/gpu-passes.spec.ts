import { describe, expect, it } from 'bun:test';
import { createHologramScene, SCENE_SEED } from 'hologram';
import { buildHologramRows, buildRowVertices, createFragmentUniforms, HALO_TEXELS } from 'hologram/gpu';
import {
  AddEquation,
  ConstantAlphaFactor,
  ConstantColorFactor,
  DoubleSide,
  InstancedBufferGeometry,
  MaxEquation,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from 'three';
import { createBodyStrokes } from './body-strokes';
import { createHaloUnion } from './halo-union';
import { createRowGeometry } from './row-geometry';

const scene = createHologramScene(SCENE_SEED);
const rows = buildHologramRows(scene);
const rowGeometry = createRowGeometry(rows);

describe('the rows’ geometry', () => {
  it('is the rows’ vertices as three.js attributes, not instances', () => {
    const vertices = buildRowVertices(rows);
    expect(rowGeometry).not.toBeInstanceOf(InstancedBufferGeometry);
    for (const { name, size, values } of vertices.attributes) {
      const attribute = rowGeometry.getAttribute(name);
      expect(attribute.itemSize).toBe(size);
      expect(attribute.array).toEqual(values);
    }
    expect(rowGeometry.getAttribute('corner').array).toEqual(vertices.corner);
    expect(rowGeometry.index?.array).toEqual(vertices.index);
  });
});

describe('the body’s strokes', () => {
  const uniforms = createFragmentUniforms();
  const strokes = createBodyStrokes(rowGeometry, uniforms, new Texture());
  const { material } = strokes.mesh;

  it('are Screened over the room and faded as one layer with the rest of him', () => {
    expect([material.blendEquation, material.blendSrc, material.blendDst]).toEqual([
      AddEquation,
      ConstantColorFactor,
      OneMinusSrcColorFactor,
    ]);
    expect([material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha]).toEqual([
      AddEquation,
      ConstantAlphaFactor,
      OneMinusSrcAlphaFactor,
    ]);
    expect(material.blendAlpha).toBe(1);
    expect(material.depthWrite).toBe(false);
  });

  it('are drawn from both sides, since a glyph’s quad winds either way', () => {
    expect(material.side).toBe(DoubleSide);
  });

  it('read the same uniforms and the same rows as the halo pass, so both place every fragment alike', () => {
    const halo = createHaloUnion(rowGeometry, uniforms);
    expect(material.uniforms.time).toBe(uniforms.time);
    expect(halo.mesh.material.uniforms.time).toBe(uniforms.time);
    expect(halo.mesh.geometry).toBe(rowGeometry);
    expect(strokes.mesh.geometry).toBe(rowGeometry);
    expect(strokes.mesh.frustumCulled).toBe(false);
  });

  it('leave the rows’ geometry to whoever made it, since the other pass still draws it', () => {
    const shared = createRowGeometry(rows);
    let disposed = false;
    shared.addEventListener('dispose', () => {
      disposed = true;
    });
    createBodyStrokes(shared, createFragmentUniforms(), new Texture()).dispose();
    createHaloUnion(shared, createFragmentUniforms()).dispose();
    expect(disposed).toBe(false);
  });
});

describe('the halo union', () => {
  const halo = createHaloUnion(rowGeometry, createFragmentUniforms());

  it('keeps the most any halo covers each texel by, in two halves of a small byte target', () => {
    expect([halo.target.width, halo.target.height]).toEqual([HALO_TEXELS * 2, HALO_TEXELS]);
    expect(halo.texture.type).toBe(UnsignedByteType);
    expect(halo.texture.format).toBe(RGBAFormat);
    expect(halo.texture.generateMipmaps).toBe(false);
  });

  it('blends by MAX, which is what makes a union of the overlaps, from both sides and with no depth', () => {
    const { material } = halo.mesh;
    expect([material.blendEquation, material.blendEquationAlpha]).toEqual([MaxEquation, MaxEquation]);
    expect(material.side).toBe(DoubleSide);
    expect(material.depthTest).toBe(false);
    expect(halo.mesh.frustumCulled).toBe(false);
  });
});
