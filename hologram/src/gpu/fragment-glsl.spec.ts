import { describe, expect, it } from 'bun:test';
import { analyseFrame, type HologramFrame, LATTICE_PULL } from '../hologram-drawing';
import { VOICE_BAND_COUNT } from '../voice-levels';
import { FRONT_VIEW } from './fragment-3d';
import {
  createFragmentUniforms,
  FRAGMENT_GLSL,
  ORTHOGRAPHIC_EYE_DISTANCE,
  writeFragmentUniforms,
} from './fragment-glsl';
import { glslColour, glslFloat } from './glsl';

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
    const state = analyseFrame(frameAt({ agitation: 0.6, hearing: 1, hearingLevel: 0.5, thinking: 0.4 }), 1);
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
    writeFragmentUniforms(uniforms, analyseFrame(frameAt({}), 1), FRONT_VIEW, 1, Number.POSITIVE_INFINITY);
    expect(uniforms.eyeDistance.value).toBe(ORTHOGRAPHIC_EYE_DISTANCE);
    expect(Math.fround(ORTHOGRAPHIC_EYE_DISTANCE)).toBe(ORTHOGRAPHIC_EYE_DISTANCE);
  });
});
