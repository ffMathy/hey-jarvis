import { describe, expect, it } from 'bun:test';
import {
  analyseFrame,
  createHologramScene,
  HALO_RING_SHARE,
  type HologramFrame,
  LATTICE_PULL,
  SCENE_SEED,
  VOICE_BAND_COUNT,
} from 'hologram';
import {
  AddEquation,
  ConstantAlphaFactor,
  ConstantColorFactor,
  DoubleSide,
  MaxEquation,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from 'three';
import { buildHologramRows } from './body-rows';
import { createBodyStrokes, STROKE_PAINTS } from './body-strokes';
import { FRONT_VIEW } from './fragment-3d';
import {
  createFragmentUniforms,
  FRAGMENT_GLSL,
  glslColour,
  glslFloat,
  ORTHOGRAPHIC_EYE_DISTANCE,
  writeFragmentUniforms,
} from './fragment-glsl';
import { createHaloUnion, HALO_PAINTS, HALO_TEXELS } from './halo-union';
import { createRowAttributes } from './row-geometry';

const scene = createHologramScene(SCENE_SEED);
const attributes = createRowAttributes(buildHologramRows(scene));

function frameAt(overrides: Partial<HologramFrame>): HologramFrame {
  return {
    time: 7.5,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    density: 1,
    presence: 1,
    thinking: 0,
    ...overrides,
  };
}

describe('GLSL literals', () => {
  it('always carry a decimal point, which GLSL insists on for a float', () => {
    expect(glslFloat(1)).toBe('1.0');
    expect(glslFloat(0.6)).toBe('0.6');
    expect(glslFloat(-0.02)).toBe('-0.02');
    expect(glslFloat(1e-7)).toBe('1e-7');
  });

  it('write a colour as its raw bytes over 255, with no linearising', () => {
    expect(glslColour(0xff0080)).toBe(`vec3(1.0, 0.0, ${glslFloat(128 / 255)})`);
  });

  it('take the drawing’s constants from hologram rather than from copies', () => {
    expect(FRAGMENT_GLSL).toContain('const float DUTY = 0.6;');
    expect(FRAGMENT_GLSL).toContain('const vec2 CORE = vec2(-0.02, -0.02);');
  });
});

describe('the fragment uniforms', () => {
  it('carry the frame’s state, with the turns worked out on the CPU in double precision', () => {
    const uniforms = createFragmentUniforms();
    const state = analyseFrame(frameAt({ agitation: 0.6, hearing: 1, hearingLevel: 0.5, thinking: 0.4 }), 1, scene);
    writeFragmentUniforms(uniforms, state, FRONT_VIEW, 0.5, 7.25);
    expect(uniforms.time.value).toBe(state.time);
    expect(uniforms.mixShare.value).toBe(state.mix);
    expect(uniforms.scanHeight.value).toBe(state.scan);
    expect(uniforms.density.value).toBe(0.5);
    expect(uniforms.bodyTurn.value).toEqual([state.bodyCos, state.bodySin]);
    const shell = (state.shellTurn * Math.PI) / 180;
    expect(uniforms.shellTurn.value[0]).toBeCloseTo(Math.cos(shell), 12);
    expect(uniforms.shellTurn.value[1]).toBeCloseTo(Math.sin(shell), 12);
    expect(uniforms.lattice.value[3]).toBeCloseTo(state.hearing * LATTICE_PULL, 12);
    expect(uniforms.eyeDistance.value).toBe(7.25);
  });

  it('stand the eye far off, in a number float32 holds, when it is infinitely far', () => {
    const uniforms = createFragmentUniforms();
    writeFragmentUniforms(uniforms, analyseFrame(frameAt({}), 1, scene), FRONT_VIEW, 1, Number.POSITIVE_INFINITY);
    expect(uniforms.eyeDistance.value).toBe(ORTHOGRAPHIC_EYE_DISTANCE);
    expect(Math.fround(ORTHOGRAPHIC_EYE_DISTANCE)).toBe(ORTHOGRAPHIC_EYE_DISTANCE);
  });
});

describe('the body’s strokes', () => {
  const uniforms = createFragmentUniforms();
  const strokes = createBodyStrokes(attributes, uniforms, new Texture());
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

  it('read the same uniforms as the halo pass, so both place every fragment alike', () => {
    const halo = createHaloUnion(attributes, uniforms);
    expect(material.uniforms.time).toBe(uniforms.time);
    expect(halo.mesh.material.uniforms.time).toBe(uniforms.time);
    expect(halo.mesh.geometry.attributes.rest).toBe(attributes.rest);
    expect(strokes.mesh.geometry.attributes.rest).toBe(attributes.rest);
    expect(strokes.mesh.geometry.instanceCount).toBe(10168);
    expect(strokes.mesh.frustumCulled).toBe(false);
  });

  it('are painted as the drawing paints its tiers', () => {
    expect(STROKE_PAINTS.dim).toEqual({ colour: 0xcc6e2c, width: 0.014, alpha: 0.62 });
    expect(STROKE_PAINTS.mid.colour).toBe(0xf87026);
    expect(STROKE_PAINTS.bright.colour).toBe(0xff7e28);
    expect(STROKE_PAINTS.hot).toEqual({ colour: 0xff8e3c, width: 0.007, alpha: 0.8 });
  });
});

describe('the halo union', () => {
  const halo = createHaloUnion(attributes, createFragmentUniforms());

  it('keeps the most any halo covers each texel by, in two halves of a small byte target', () => {
    expect([halo.target.width, halo.target.height]).toEqual([HALO_TEXELS * 2, HALO_TEXELS]);
    expect(halo.texture.type).toBe(UnsignedByteType);
    expect(halo.texture.format).toBe(RGBAFormat);
    expect(halo.texture.generateMipmaps).toBe(false);
  });

  it('strengthens each tier as drawParticleHalo does', () => {
    expect(HALO_PAINTS.dim.strength).toBeCloseTo(0.3 * HALO_RING_SHARE, 12);
    expect(HALO_PAINTS.mid.strength).toBeCloseTo(0.34 * HALO_RING_SHARE, 12);
    expect(HALO_PAINTS.bright.strength).toBeCloseTo(0.38 * HALO_RING_SHARE, 12);
    expect(HALO_PAINTS.colour).toBe(0xdc5c20);
  });

  it('blends by MAX, which is what makes a union of the overlaps, from both sides and with no depth', () => {
    const { material } = halo.mesh;
    expect([material.blendEquation, material.blendEquationAlpha]).toEqual([MaxEquation, MaxEquation]);
    expect(material.side).toBe(DoubleSide);
    expect(material.depthTest).toBe(false);
    expect(halo.mesh.frustumCulled).toBe(false);
  });
});
