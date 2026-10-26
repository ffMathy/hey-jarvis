import { describe, expect, it } from 'bun:test';
import { SCENE_SEED } from '../frame-timing';
import { analyseFrame, createHologramScene, type HologramFrame } from '../hologram-drawing';
import { FEWEST_PARTICLES } from '../density-control';
import { VOICE_BAND_COUNT } from '../voice-levels';
import { createFlatCamera, placeFlatCamera } from './flat-camera';
import { FRONT_VIEW } from './fragment-3d';
import { buildHologramRows } from './body-rows';
import { createGpuBody, drawGpuBody, type HologramGl } from './gpu-body';
import { HALO_TEXELS } from './halo-union';
import { buildRowVertices } from './row-vertices';

/**
 * The raw renderer against a context that only writes down what it is asked: which passes, in what
 * order, into which target, blended how. Whether the pixels are right is the browser's to say —
 * the headset's preview draws the same moment with three.js and the raw renderer and compares them
 * to the byte.
 */

type Call = [string, ...unknown[]];

/** A GL object as a browser makes one: an instance of a class of its own, with nothing on it to read. */
class BrowserObject {}

/** A uniform's location as a browser makes one, named here so a test can tell which uniform a call sets. */
class BrowserLocation {
  constructor(readonly name: string) {}
}

/** A GL object as expo-gl makes one on a device: an instance of a class of its own, with the id expo-gl reads it by. */
class ExpoObject {
  constructor(readonly id: number) {}
}

/** How a context makes its GL objects and its uniforms' locations. */
interface GlObjects {
  made(): object;
  location(name: string): object;
}

const BROWSER_OBJECTS: GlObjects = { made: () => new BrowserObject(), location: (name) => new BrowserLocation(name) };

function expoObjects(): GlObjects {
  let made = 0;
  return { made: () => new ExpoObject(++made), location: () => new ExpoObject(++made) };
}

/** A context that hands out a fresh object for every create, says yes to every status, and writes every call into `calls`. */
function recordingGl(calls: Call[], objects = BROWSER_OBJECTS): HologramGl {
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    createShader: objects.made,
    createProgram: objects.made,
    createBuffer: objects.made,
    createTexture: objects.made,
    createFramebuffer: objects.made,
    createVertexArray: objects.made,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => objects.location(String(name)),
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
    presence: 1,
    thinking: 0,
    ...overrides,
  };
}

/**
 * Where in `value` there is something the worklets runtime would refuse to copy from the JS thread to
 * the UI thread: anything but a primitive, a plain object, an array or a typed array.
 */
function uncopyable(value: unknown, path: string): string[] {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return [];
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return [path];
  return Object.entries(value).flatMap(([key, inner]: [string, unknown]) => uncopyable(inner, `${path}.${key}`));
}

function drawn(calls: Call[], overrides: Partial<HologramFrame>, fade: number, density = 1) {
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
  drawGpuBody(gl, body, { state, density, fade, alphaFromLight: 1, camera });
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
    // A browser's GL objects are kept as the context made them.
    expect(body.haloFramebuffer).toBeInstanceOf(BrowserObject);
  });

  it('keeps the GL objects expo-gl makes as the plain ids it reads them by, so a worklet can carry the body', () => {
    const calls: Call[] = [];
    const body = createGpuBody(recordingGl(calls, expoObjects()), scene);
    expect(uncopyable(body, 'body')).toEqual([]);
    // Still naming what the context made: the framebuffer the halo target was attached to.
    const framebuffer = calls.find(([name, , bound]) => name === 'bindFramebuffer' && bound !== null)?.[2];
    expect(framebuffer).toBeInstanceOf(ExpoObject);
    expect(body.haloFramebuffer).toEqual({ id: framebuffer instanceof ExpoObject ? framebuffer.id : Number.NaN });
    expect(body.strokes.uniforms.viewportHeight).toEqual({ id: expect.any(Number) });
  });

  it('only clears while he is faded out', () => {
    const calls: Call[] = [];
    drawn(calls, {}, 0);
    expect(calls.map(([name]) => name)).not.toContain('drawElements');
    expect(calls.map(([name]) => name)).toContain('clear');
  });

  it('draws the halo union into its target by MAX, then the strokes and the halos’ light Screened and faded', () => {
    const calls: Call[] = [];
    // Halfway arrived, wholly lit: a phone's view fades the body from outside, by the arrival.
    expect(analyseFrame(frameAt({ appearance: 0.1 }), 1, scene).arrival).toBe(0.5);
    const body = drawn(calls, { appearance: 0.1 }, 1);
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
    // Then onto the canvas, all of it: Screen, faded by the blend's constant colour.
    const secondDraw = names.indexOf('drawElements', firstDraw + 1);
    const between = calls.slice(firstDraw, secondDraw);
    expect(between.filter(([name]) => name === 'bindFramebuffer').at(-1)?.[2]).toBe(null);
    expect(between.filter(([name]) => name === 'viewport').at(-1)).toEqual(['viewport', 0, 0, 600, 900]);
    const viewportHeight = calls.find(
      ([name, location]) =>
        name === 'uniform1f' && location instanceof BrowserLocation && location.name === 'viewportHeight',
    );
    expect(viewportHeight?.[2]).toBe(900);
    expect(between.find(([name]) => name === 'blendFuncSeparate')).toEqual([
      'blendFuncSeparate',
      0x8001,
      0x0301,
      0x8003,
      0x0303,
    ]);
    expect(between.find(([name]) => name === 'blendColor')).toEqual(['blendColor', 1, 1, 1, 1]);
    expect(between.filter(([name]) => name === 'useProgram').at(-1)?.[1]).toBe(body.strokes.program);
    const lastUse = calls.filter(([name]) => name === 'useProgram').at(-1);
    expect(lastUse?.[1]).toBe(body.haloLight.program);
  });

  it('draws only the quads the density share keeps, which are the first of the index', () => {
    const calls: Call[] = [];
    const body = drawn(calls, {}, 1, FEWEST_PARTICLES);
    const kept = Array.from(buildRowVertices(buildHologramRows(scene)).keys).filter(
      (key) => key < Math.fround(FEWEST_PARTICLES),
    ).length;
    // A fortieth of the scene, give or take its hash: not the whole of it with the rest hidden.
    expect(kept).toBeGreaterThan(body.rowCount * 0.02);
    expect(kept).toBeLessThan(body.rowCount * 0.03);
    const draws = calls.filter(([name]) => name === 'drawElements');
    expect(draws.map(([, , count]) => count)).toEqual([kept * 6, kept * 6, 6]);
  });

  it('fades by the fade it is handed, not by the arrival, where nothing outside fades it', () => {
    const calls: Call[] = [];
    drawn(calls, { appearance: 0.1 }, 0.3);
    expect(calls.filter(([name]) => name === 'drawElements')).toHaveLength(3);
    expect(calls.find(([name]) => name === 'blendColor')).toEqual(['blendColor', 0.3, 0.3, 0.3, 0.3]);
  });
});
