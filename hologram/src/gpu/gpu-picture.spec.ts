import { describe, expect, it } from 'bun:test';
import { PLAIN_RING_GLYPH, SAMPLE_AGENTS, type SatelliteOrbit } from '../agent-work';
import { SCENE_SEED } from '../frame-timing';
import { analyseFrame, createHologramScene, type HologramFrame, pictureSceneOf } from '../hologram-drawing';
import { VOICE_BAND_COUNT } from '../voice-levels';
import { BLEND, DEPTH_TEST, EQUAL, LESS, NOTEQUAL, STENCIL_TEST } from './gl-objects';
import { createGpuPicture, drawGpuPicture, drawGpuPictureCascade, writeGpuPictureCascade } from './gpu-picture';
import { BrowserLocation, type Call, ExpoObject, expoObjects, recordingGl, uncopyable } from './recording-gl.fakes';

/**
 * The picture of everything but his body against a context that only writes down what it is asked:
 * what it compiles, how each path is drawn and blended, and what it leaves set. Whether its pixels
 * are still what they were when he was last redrawn on purpose is the headset's browser tests' to
 * say (vr's `hologram-picture.spec.ts`), against goldens `vr/.scripts/render-picture-goldens.ts`
 * drew from it.
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
  const state = analyseFrame(frameAt(overrides), 1);
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

    // Nine programs, two sources each: the static runs, the glyphs, the arc, the disc, the cage, its
    // cascades, the embers, the fray and the chips. It was fifteen until the Vision footage replaced
    // the Age of Ultron layers (the whorl, the comets, the truss, the crescent and the rest) with the
    // cage and the embers.
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
      const state = analyseFrame(frameAt({ time }), 1);
      drawGpuPicture(gl, picture, { state, pixels: 512, satellites: [] });
      const turns = calls.filter(
        ([name, location]) =>
          name === 'uniform2f' && location instanceof BrowserLocation && location.name === 'bodyTurn',
      );

      expect(turns.length).toBeGreaterThan(0);
      for (const [, , cos, sin] of turns) expect([cos, sin]).toEqual([state.bodyCos, state.bodySin]);
    }
  });

  it('draws the white-hot ring round his core where the frame says it has been drawn in to', () => {
    const calls: Call[] = [];
    const gl = recordingGl(calls);
    const picture = createGpuPicture(gl, scene);
    const silent = analyseFrame(frameAt({}), 1);
    const speaking = analyseFrame(frameAt({ voiceWave: new Array(16).fill(1), voiceWavePhase: 0.2 }), 1);
    expect(speaking.coreRing).toBeLessThan(silent.coreRing);
    for (const state of [silent, speaking]) {
      calls.length = 0;
      drawGpuPicture(gl, picture, { state, pixels: 512, satellites: [] });
      // Its two nested strokes, the orange body and the orange-white line, by their half-widths.
      const ringStrokes = calls.filter(
        ([name, location, , , , halfWidth]) =>
          name === 'uniform4f' &&
          location instanceof BrowserLocation &&
          location.name === 'arc' &&
          (halfWidth === 0.024 / 2 || halfWidth === 0.009 / 2),
      );
      expect(ringStrokes).toHaveLength(2);
      for (const [, , , , radius] of ringStrokes) expect(radius).toBe(state.coreRing);
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

  it('draws nothing more while he thinks: the band through his body is the whole of a thought', () => {
    // Every moment of a pass, the last stretch of it included, where a ring used to bloom out of the
    // core as each pass ended; quiet and speaking alike.
    const made = madePicture();
    const quiet = { level: 0, agitation: 0, burstStrength: 0, burstCount: 0, speaking: false };
    for (const voice of [{}, quiet]) {
      for (let time = 5.2; time < 7.8; time += 0.1) {
        const calm = draw(made, { ...voice, time });
        const thinking = draw(made, { ...voice, time, thinking: 1 });
        expect(named(thinking, 'drawElements')).toEqual(named(calm, 'drawElements'));
        expect(named(thinking, 'stencilFunc')).toEqual(named(calm, 'stencilFunc'));
      }
    }
  });

  it('draws more with satellites than without, and none for a satellite that has gone out', () => {
    const made = madePicture();
    const without = named(draw(made), 'drawElements').length;

    expect(named(draw(made, {}, [orbit()]), 'drawElements').length).toBeGreaterThan(without);
    expect(named(draw(made, {}, [orbit({ level: 0 })]), 'drawElements')).toHaveLength(without);
  });
});

describe("the cage's cascades on the GPU", () => {
  /** A frame at `time`, its cascade worked out, and the calls of the picture and of the cascades over it. */
  function drawnAt(time: number) {
    const made = madePicture();
    const state = analyseFrame(frameAt({ time }), 1);
    writeGpuPictureCascade(made.picture, state);
    made.calls.length = 0;
    drawGpuPicture(made.gl, made.picture, { state, pixels: 512, satellites: [] });
    const picture = made.calls.splice(0);
    drawGpuPictureCascade(made.gl, made.picture, { state, pixels: 512, satellites: [] });
    const cascades = made.calls.splice(0);
    const usesCascade = (calls: Call[]) =>
      named(calls, 'useProgram').some(([, program]) => program === made.picture.cascade.program.program);
    return { picture, cascades, usesCascade };
  }

  it('draws a lit cascade only over the frame, never as part of the picture the headset draws', () => {
    // a cascade fires at 12.01 s and has spread across the cage by 13.1 s
    const { picture, cascades, usesCascade } = drawnAt(13.1);

    expect(usesCascade(picture)).toBe(false);
    expect(usesCascade(cascades)).toBe(true);
    expect(named(cascades, 'uniform4fv')).not.toHaveLength(0);
    // Screened over him as the picture is, with its own stencil and depth for each of its strokes
    expect(named(cascades, 'blendFuncSeparate')[0]?.slice(1)).toEqual(
      named(picture, 'blendFuncSeparate')[0]?.slice(1) ?? [],
    );
    expect(named(cascades, 'disable').map(([, capability]) => capability)).toEqual([STENCIL_TEST, DEPTH_TEST, BLEND]);
  });

  it('draws nothing between cascades', () => {
    // the cascade fired at 12.01 s has gone out by 14.8 s, and the next chance is not until 15 s
    const { cascades, usesCascade } = drawnAt(14.9);

    expect(usesCascade(cascades)).toBe(false);
    expect(named(cascades, 'drawElements')).toHaveLength(0);
  });
});
