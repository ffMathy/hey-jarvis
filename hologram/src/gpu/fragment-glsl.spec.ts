import { describe, expect, it } from 'bun:test';
import {
  analyseFrame,
  HEARD_WAVE_FROM,
  HEARD_WAVE_GONE,
  type HologramFrame,
  LATTICE_PULL,
  SCAN_DEAL_FROM_HOP,
  SCAN_FLOOR,
  SCAN_PROMOTED_SHARE,
  SCAN_SOFTNESS,
  SCAN_STRETCH,
} from '../hologram-drawing';
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
    // the gyroscope's rocking, which this frame's agitation sets going, and the truss's roll
    expect(Math.abs(state.gyroSway)).toBeGreaterThan(1);
    const sway = (state.gyroSway * Math.PI) / 180;
    expect(uniforms.gyroSway.value[0]).toBeCloseTo(Math.cos(sway), 12);
    expect(uniforms.gyroSway.value[1]).toBeCloseTo(Math.sin(sway), 12);
    const rim = (state.rimRoll * Math.PI) / 180;
    expect(uniforms.rimTurn.value[0]).toBeCloseTo(Math.cos(rim), 12);
    expect(uniforms.rimTurn.value[1]).toBeCloseTo(Math.sin(rim), 12);
    expect(uniforms.lattice.value[3]).toBeCloseTo(state.hearing * LATTICE_PULL, 12);
    expect(uniforms.eyeDistance.value).toBe(7.25);
  });

  it('carry the rings his syllables send out of his core, newest first, four to a vector', () => {
    const uniforms = createFragmentUniforms();
    // Silent to begin with: nothing to push, and the shader skips the rings altogether.
    for (const name of ['voiceWave0', 'voiceWave1', 'voiceWave2', 'voiceWave3'] as const) {
      expect(uniforms[name].value).toEqual([0, 0, 0, 0]);
    }
    expect(uniforms.voiceWaveClock.value).toEqual([0, 0]);

    const slots = Array.from({ length: 16 }, (_, slot) => (slot % 5) / 4);
    const state = analyseFrame(frameAt({ voiceWave: slots, voiceWavePhase: 0.35 }), 1);
    writeFragmentUniforms(uniforms, state, FRONT_VIEW, 1, Number.POSITIVE_INFINITY);
    const written = [
      ...uniforms.voiceWave0.value,
      ...uniforms.voiceWave1.value,
      ...uniforms.voiceWave2.value,
      ...uniforms.voiceWave3.value,
    ];
    expect(written).toEqual(state.voiceWave);
    expect(state.voiceWaveLargest).toBeGreaterThan(0);
    expect(uniforms.voiceWaveClock.value).toEqual([state.voiceWaveLargest, 0.35]);
  });

  it('carry the thinking band’s tilt, as a cosine and a sine worked out on the CPU', () => {
    const uniforms = createFragmentUniforms();
    // Level to begin with.
    expect(uniforms.scanTilt.value).toEqual([1, 0]);
    // A moment the band leans well over.
    const state = analyseFrame(frameAt({ time: 1.8, thinking: 1 }), 1);
    expect(Math.abs(state.scanTiltSin)).toBeGreaterThan(0.3);
    writeFragmentUniforms(uniforms, state, FRONT_VIEW, 1, Number.POSITIVE_INFINITY);
    expect(uniforms.scanTilt.value).toEqual([state.scanTiltCos, state.scanTiltSin]);
    expect(uniforms.scanHeight.value).toBe(state.scan);
  });

  it('carry their syllables’ rings flowing in through the lattice, newest first, four to a vector, as his are', () => {
    const uniforms = createFragmentUniforms();
    // Nobody talking to begin with: nothing to pull, and the shader skips their rings altogether.
    for (const name of ['heardWave0', 'heardWave1', 'heardWave2', 'heardWave3'] as const) {
      expect(uniforms[name].value).toEqual([0, 0, 0, 0]);
    }
    expect(uniforms.heardWaveClock.value).toEqual([0, 0]);

    const slots = Array.from({ length: 16 }, (_, slot) => ((slot + 2) % 5) / 4);
    const state = analyseFrame(frameAt({ hearing: 1, hearingLevel: 0.4, heardWave: slots, heardWavePhase: 0.6 }), 1);
    writeFragmentUniforms(uniforms, state, FRONT_VIEW, 1, Number.POSITIVE_INFINITY);
    const written = [
      ...uniforms.heardWave0.value,
      ...uniforms.heardWave1.value,
      ...uniforms.heardWave2.value,
      ...uniforms.heardWave3.value,
    ];
    expect(written).toEqual(state.heardWave);
    expect(state.heardWaveLargest).toBeGreaterThan(0);
    expect(uniforms.heardWaveClock.value).toEqual([state.heardWaveLargest, 0.6]);
    // His own are not theirs: he is silent, and his stay empty.
    expect(uniforms.voiceWaveClock.value).toEqual([0, 0]);
  });

  it('declare them, and the thinking band’s and the inbound rings’ constants, from hologram', () => {
    for (const declared of [
      'uniform vec2 scanTilt;',
      'uniform vec4 heardWave0;',
      'uniform vec4 heardWave1;',
      'uniform vec4 heardWave2;',
      'uniform vec4 heardWave3;',
      'uniform vec2 heardWaveClock;',
      `const float SCAN_SOFTNESS = ${glslFloat(SCAN_SOFTNESS)};`,
      `const float SCAN_FLOOR = ${glslFloat(SCAN_FLOOR)};`,
      `const float SCAN_STRETCH = ${glslFloat(SCAN_STRETCH)};`,
      `const float SCAN_PROMOTED_SHARE = ${glslFloat(SCAN_PROMOTED_SHARE)};`,
      `const float SCAN_DEAL_FROM_HOP = ${glslFloat(SCAN_DEAL_FROM_HOP)};`,
      `const float HEARD_WAVE_FROM = ${glslFloat(HEARD_WAVE_FROM)};`,
      `const float HEARD_WAVE_GONE = ${glslFloat(HEARD_WAVE_GONE)};`,
    ]) {
      expect(FRAGMENT_GLSL).toContain(declared);
    }
    // The hard-edged band's numbers are gone with it.
    expect(FRAGMENT_GLSL).not.toContain('SCAN_HALF_WIDTH');
    expect(FRAGMENT_GLSL).not.toContain('SCAN_BRIGHT_NEARNESS');
  });

  it('stand the eye far off, in a number float32 holds, when it is infinitely far', () => {
    const uniforms = createFragmentUniforms();
    writeFragmentUniforms(uniforms, analyseFrame(frameAt({}), 1), FRONT_VIEW, 1, Number.POSITIVE_INFINITY);
    expect(uniforms.eyeDistance.value).toBe(ORTHOGRAPHIC_EYE_DISTANCE);
    expect(Math.fround(ORTHOGRAPHIC_EYE_DISTANCE)).toBe(ORTHOGRAPHIC_EYE_DISTANCE);
  });
});
