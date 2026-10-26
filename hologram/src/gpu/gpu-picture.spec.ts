import { describe, expect, it } from 'bun:test';
import { PLAIN_RING_GLYPH, SAMPLE_AGENTS, type SatelliteOrbit } from '../agent-work';
import { SCENE_SEED } from '../frame-timing';
import { analyseFrame, createHologramScene, type HologramFrame, pictureSceneOf } from '../hologram-drawing';
import { VOICE_BAND_COUNT } from '../voice-levels';
import { BLEND, DEPTH_TEST, EQUAL, LESS, NOTEQUAL, STENCIL_TEST } from './gl-objects';
import { createGpuPicture, drawGpuPicture } from './gpu-picture';
import { BrowserLocation, type Call, ExpoObject, expoObjects, recordingGl, uncopyable } from './recording-gl.fakes';

/**
 * The picture of everything but his body against a context that only writes down what it is asked:
 * what it compiles, how each path is drawn and blended, and what it leaves set. Whether its pixels
 * are Skia's picture of him is the headset's browser tests' to say, against frames Skia drew.
 */

const scene = pictureSceneOf(createHologramScene(SCENE_SEED));

function frameAt(overrides: Partial<HologramFrame>): HologramFrame {
  return {
    time: 7.5,
    level: 0.6,
    bands: new Array(VOICE_BAND_COUNT).fill(0.5),
    speaking: true,
    agitation: 1,
    burstAge: 0.08,
    burstStrength: 1,
    burstCount: 3,
    appearance: 1,
    presence: 1,
    thinking: 0,
    ...overrides,
  };
}

function orbit(overrides: Partial<SatelliteOrbit> = {}): SatelliteOrbit {
  return { glyph: PLAIN_RING_GLYPH, level: 1, flare: 0.5, asking: false, turn: 0.25, reach: 1, ...overrides };
}

/** A picture made on a recording context, and that context's calls from then on. */
function madePicture(objects = expoObjects()) {
  const calls: Call[] = [];
  const gl = recordingGl(calls, objects);
  const picture = createGpuPicture(gl, scene);
  const made = calls.splice(0);
  return { gl, picture, calls, made };
}

function draw(
  made: ReturnType<typeof madePicture>,
  overrides: Partial<HologramFrame> = {},
  satellites: SatelliteOrbit[] = [],
) {
  made.calls.length = 0;
  const state = analyseFrame(frameAt(overrides), 1, scene);
  drawGpuPicture(made.gl, made.picture, { state, pixels: 512, satellites });
  return made.calls.splice(0);
}

function named(calls: Call[], name: string) {
  return calls.filter(([called]) => called === name);
}

describe('the picture on the GPU', () => {
  it('compiles every layer as GLSL ES 3.00, and keeps what it made as data a worklet can carry', () => {
    const { picture, made } = madePicture();
    const sources = named(made, 'shaderSource').map(([, , source]) => String(source));

    // Eight programs, two sources each: the static runs, the glyphs, the arc, the disc, the cage, the
    // embers, the fray and the chips. It was fifteen until the Vision footage replaced the Age of
    // Ultron layers (the whorl, the comets, the truss, the crescent and the rest) with the cage and
    // the embers.
    expect(sources.length).toBeGreaterThanOrEqual(16);
    for (const source of sources) expect(source.startsWith('#version 300 es\n')).toBe(true);
    expect(uncopyable(picture, 'picture')).toEqual([]);
    expect(named(made, 'createVertexArray')[0]).toBeDefined();
    expect(picture.segments.array).toEqual({ id: expect.any(Number) });
    expect(picture.sparkle).not.toBeInstanceOf(ExpoObject);
  });

  it('draws every path twice: its coverage into the depth buffer, then the colour of the fragment that covered most', () => {
    const calls = draw(madePicture());
    const draws = calls.flatMap((call, index) => (call[0] === 'drawElements' ? [index] : []));

    // A speaking frame with a burst draws at least fifteen paths: the aura, the core's five (its
    // glow, its two marks and its ring's two strokes), the cage's two (its hairline and the glow
    // under it), the embers' two, the fray's two and the chips' three. It drew more than twenty
    // before the Vision footage replaced the Age of Ultron layers with fewer, finer ones.
    expect(draws.length).toBeGreaterThanOrEqual(30);
    expect(draws.length % 2).toBe(0);
    for (let pair = 0; pair < draws.length; pair += 2) {
      const [depthPass, colourPass] = [draws[pair] ?? 0, draws[pair + 1] ?? 0];
      // the same shapes both times
      expect(calls[colourPass]?.slice(1)).toEqual(calls[depthPass]?.slice(1) ?? []);
      const beforeDepth = calls.slice(0, depthPass);
      const beforeColour = calls.slice(depthPass, colourPass);
      expect(named(beforeDepth, 'colorMask').at(-1)).toEqual(['colorMask', false, false, false, false]);
      expect(named(beforeDepth, 'depthFunc').at(-1)).toEqual(['depthFunc', LESS]);
      expect(named(beforeColour, 'colorMask').at(-1)).toEqual(['colorMask', true, true, true, true]);
      expect(named(beforeColour, 'depthFunc').at(-1)).toEqual(['depthFunc', EQUAL]);
      expect(named(beforeColour, 'depthMask').at(-1)).toEqual(['depthMask', false]);
    }
  });

  it('gives each path a stencil value of its own, counting up from 1, and paints only where it has not', () => {
    const calls = draw(madePicture());
    const values = named(calls, 'stencilFunc').map(([, test, value]) => {
      expect(test).toBe(NOTEQUAL);
      return Number(value);
    });

    expect(values[0]).toBe(1);
    for (let index = 1; index < values.length; index++) expect(values[index]).toBe((values[index - 1] ?? 0) + 1);
    expect(values.length).toBeLessThan(256);
  });

  it('Screens every paint, and leaves the depth and stencil tests off for the body that draws after it', () => {
    const calls = draw(madePicture());

    expect(named(calls, 'enable')).toEqual(
      expect.arrayContaining([
        ['enable', BLEND],
        ['enable', DEPTH_TEST],
        ['enable', STENCIL_TEST],
      ]),
    );
    expect(named(calls, 'blendFuncSeparate')).toEqual([['blendFuncSeparate', 1, 0x0301, 1, 0x0303]]);
    const last = calls.slice(calls.findLastIndex(([name]) => name === 'drawElements'));
    expect(named(last, 'disable')).toEqual(
      expect.arrayContaining([
        ['disable', DEPTH_TEST],
        ['disable', STENCIL_TEST],
      ]),
    );
    expect(named(last, 'depthMask').at(-1)).toEqual(['depthMask', true]);
  });

  it("turns the cage with his body, by the very turn the body's fragments are placed at", () => {
    // A browser's context names each uniform's location, so the cage's turn can be read back.
    const calls: Call[] = [];
    const gl = recordingGl(calls);
    const picture = createGpuPicture(gl, scene);
    for (const time of [1, 7.5, 20]) {
      calls.length = 0;
      const state = analyseFrame(frameAt({ time }), 1, scene);
      drawGpuPicture(gl, picture, { state, pixels: 512, satellites: [] });
      const turns = calls.filter(
        ([name, location]) =>
          name === 'uniform2f' && location instanceof BrowserLocation && location.name === 'bodyTurn',
      );

      expect(turns.length).toBeGreaterThan(0);
      for (const [, , cos, sin] of turns) expect([cos, sin]).toEqual([state.bodyCos, state.bodySin]);
    }
  });

  it('writes a glyph into its slot once, and again only when the slot is given another', () => {
    const made = madePicture();
    const [diamond, square] = SAMPLE_AGENTS;
    const first = draw(made, {}, [orbit({ glyph: diamond?.glyph })]);
    const again = draw(made, {}, [orbit({ glyph: diamond?.glyph })]);
    const changed = draw(made, {}, [orbit({ glyph: square?.glyph })]);

    expect(named(first, 'bufferSubData')).toHaveLength(2);
    expect(named(again, 'bufferSubData')).toHaveLength(0);
    expect(named(changed, 'bufferSubData')).toHaveLength(2);
  });

  it('draws a glyph it cannot read as the plain ring, since its agent is still at work', () => {
    const unreadable = named(draw(madePicture(), {}, [orbit({ glyph: 'M 0 0 L' })]), 'bufferSubData');
    const ring = named(draw(madePicture(), {}, [orbit({ glyph: PLAIN_RING_GLYPH })]), 'bufferSubData');

    expect(unreadable).toEqual(ring);
  });

  it('draws more with satellites than without, and none for a satellite that has gone out', () => {
    const made = madePicture();
    const without = named(draw(made), 'drawElements').length;

    expect(named(draw(made, {}, [orbit()]), 'drawElements').length).toBeGreaterThan(without);
    expect(named(draw(made, {}, [orbit({ level: 0 })]), 'drawElements')).toHaveLength(without);
  });
});
