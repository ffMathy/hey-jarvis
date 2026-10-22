import { describe, expect, it } from 'bun:test';
import { SCENE_SEED } from '../frame-timing';
import { analyseFrame, createHologramScene, type HologramFrame } from '../hologram-drawing';
import { VOICE_BAND_COUNT } from '../voice-levels';
import { createFlatCamera, placeFlatCamera } from './flat-camera';
import { FRONT_VIEW } from './fragment-3d';
import { createGpuBody, drawGpuBody, type HologramGl } from './gpu-body';
import { HALO_TEXELS } from './halo-union';

/**
 * The raw renderer against a context that only writes down what it is asked: which passes, in what
 * order, into which target, blended how. Whether the pixels are right is the browser's to say —
 * the headset's preview draws the same moment with three.js and the raw renderer and compares them
 * to the byte.
 */

type Call = [string, ...unknown[]];

/** A context that hands out a fresh object for every create, says yes to every status, and writes every call into `calls`. */
function recordingGl(calls: Call[]): HologramGl {
  let made = 0;
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    createShader: () => ({ made: ++made }),
    createProgram: () => ({ made: ++made }),
    createBuffer: () => ({ made: ++made }),
    createTexture: () => ({ made: ++made }),
    createFramebuffer: () => ({ made: ++made }),
    createVertexArray: () => ({ made: ++made }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => ({ name }),
    getAttribLocation: (_program, name) => (name === 'corner' ? 0 : 1),
    checkFramebufferStatus: () => 0x8cd5,
  };
  // A Proxy is typed as its target, and the calls are answered by its `get` rather than by the
  // target's own members, which TypeScript cannot see: every call HologramGl names is answered.
  return new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        (...args: unknown[]) => {
          calls.push([name, ...args]);
          return answers[name]?.(...args);
        },
    },
  ) as HologramGl;
}

const scene = createHologramScene(SCENE_SEED);

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

function drawn(calls: Call[], overrides: Partial<HologramFrame>, fade?: number) {
  const gl = recordingGl(calls);
  const body = createGpuBody(gl, scene);
  calls.length = 0;
  const state = analyseFrame(frameAt(overrides), 1, scene);
  const camera = placeFlatCamera(
    createFlatCamera(),
    { width: 600, height: 900, squareX: 300, squareY: 400, squareSide: 540 },
    state.radius,
    FRONT_VIEW,
    Number.POSITIVE_INFINITY,
  );
  drawGpuBody(gl, body, { state, density: 1, fade: fade ?? state.arrival, alphaFromLight: 1, camera });
  return body;
}

describe('the raw renderer', () => {
  it('compiles the three passes as GLSL ES 3.00 and draws the rows with a 16-bit index', () => {
    const calls: Call[] = [];
    const body = createGpuBody(recordingGl(calls), scene);
    const sources = calls.filter(([name]) => name === 'shaderSource').map(([, , source]) => String(source));
    expect(sources).toHaveLength(6);
    for (const source of sources) expect(source.startsWith('#version 300 es\n')).toBe(true);
    expect(body.rowCount).toBe(10168);
    expect(body.indexCount).toBe(10168 * 6);
    expect(body.indexType).toBe(0x1403);
    const target = calls.find(([name, , , , width]) => name === 'texImage2D' && width === HALO_TEXELS * 2);
    expect(target?.[3]).toBe(0x8058);
  });

  it('only clears while he is faded out', () => {
    const calls: Call[] = [];
    drawn(calls, {}, 0);
    expect(calls.map(([name]) => name)).not.toContain('drawElements');
    expect(calls.map(([name]) => name)).toContain('clear');
  });

  it('draws the halo union into its target by MAX, then the strokes and the halos’ light Screened and faded', () => {
    const calls: Call[] = [];
    const body = drawn(calls, { appearance: 0.1 });
    const names = calls.map(([name]) => name);
    const draws = calls.filter(([name]) => name === 'drawElements');
    expect(draws.map(([, , count]) => count)).toEqual([body.indexCount, body.indexCount, 6]);
    // The union first, into its own framebuffer at its own size.
    const firstDraw = names.indexOf('drawElements');
    const boundBefore = calls
      .slice(0, firstDraw)
      .filter(([name]) => name === 'bindFramebuffer')
      .at(-1);
    expect(boundBefore?.[2]).toBe(body.haloFramebuffer);
    expect(
      calls
        .slice(0, firstDraw)
        .filter(([name]) => name === 'viewport')
        .at(-1),
    ).toEqual(['viewport', 0, 0, HALO_TEXELS * 2, HALO_TEXELS]);
    expect(
      calls
        .slice(0, firstDraw)
        .filter(([name]) => name === 'blendEquationSeparate')
        .at(-1),
    ).toEqual(['blendEquationSeparate', 0x8008, 0x8008]);
    // Then onto the canvas: Screen, faded by the blend's constant colour.
    const secondDraw = names.indexOf('drawElements', firstDraw + 1);
    const between = calls.slice(firstDraw, secondDraw);
    expect(between.filter(([name]) => name === 'bindFramebuffer').at(-1)?.[2]).toBe(null);
    expect(between.find(([name]) => name === 'blendFuncSeparate')).toEqual([
      'blendFuncSeparate',
      0x8001,
      0x0301,
      0x8003,
      0x0303,
    ]);
    const fade = analyseFrame(frameAt({ appearance: 0.1 }), 1, scene).arrival;
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(1);
    expect(between.find(([name]) => name === 'blendColor')).toEqual(['blendColor', fade, fade, fade, fade]);
    expect(between.filter(([name]) => name === 'useProgram').at(-1)?.[1]).toBe(body.strokes.program);
    const lastUse = calls.filter(([name]) => name === 'useProgram').at(-1);
    expect(lastUse?.[1]).toBe(body.haloLight.program);
  });
});
