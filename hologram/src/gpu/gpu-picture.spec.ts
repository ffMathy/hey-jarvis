import { describe, expect, it } from 'bun:test';
import { PLAIN_RING_GLYPH, SAMPLE_AGENTS, type SatelliteOrbit } from '../agent-work';
import {
  anythingLit,
  buildCageNet,
  CASCADE_BOX_NUMBERS,
  CASCADE_BOX_SLOTS,
  CASCADE_BOXES_AT,
  CASCADE_EDGE_NUMBERS,
  CASCADE_EDGE_SLOTS,
  CASCADE_EDGES,
  CASCADE_NUMBERS,
  cascadeScratchSize,
  writeCageCascade,
} from '../cage-cascade';
import { SCENE_SEED } from '../frame-timing';
import { analyseFrame, createHologramScene, type HologramFrame, pictureSceneOf } from '../hologram-drawing';
import { VOICE_BAND_COUNT } from '../voice-levels';
import { createFlatCamera, placeFlatCamera } from './flat-camera';
import { FRONT_VIEW } from './fragment-3d';
import { BLEND, DEPTH_TEST, EQUAL, LESS, NOTEQUAL, STENCIL_TEST } from './gl-objects';
import { createGpuBody } from './gpu-body';
import { drawGpuFrame } from './gpu-frame';
import { createGpuPicture, drawGpuPicture, drawGpuPictureCascade, writeGpuPictureCascade } from './gpu-picture';
import { CASCADE_VECTORS } from './picture-layers';
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
    expect(sources).toHaveLength(18);
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
  function drawnAt(time: number, overrides: Partial<HologramFrame> = {}) {
    const made = madePicture();
    const state = analyseFrame(frameAt({ time, ...overrides }), 1);
    writeGpuPictureCascade(made.picture, state);
    made.calls.length = 0;
    drawGpuPicture(made.gl, made.picture, { state, pixels: 512, satellites: [] });
    const picture = made.calls.splice(0);
    drawGpuPictureCascade(made.gl, made.picture, { state, pixels: 512, satellites: [] });
    const cascades = made.calls.splice(0);
    const usesCascade = (calls: Call[]) =>
      named(calls, 'useProgram').some(([, program]) => program === made.picture.cascade.program.program);
    return { made, state, picture, cascades, usesCascade };
  }

  /** The cascade at `time` as the planner works it out on a scratch of its own, from the same frame. */
  function plannedAt(time: number) {
    const net = buildCageNet(scene.cage);
    const out = new Float32Array(CASCADE_NUMBERS);
    writeCageCascade(net, analyseFrame(frameAt({ time }), 1), new Array(cascadeScratchSize(net)).fill(0), out);
    return out;
  }

  // a cascade fires at 12.01 s and has spread across the cage by 13.1 s, and has gone out by 14.9 s
  const LIT = 13.1;
  const BETWEEN = 14.9;

  it('draws a lit cascade only over the frame, never as part of the picture the headset draws', () => {
    const { made, picture, cascades, usesCascade } = drawnAt(LIT);

    expect(anythingLit(made.picture.cascadeEdges)).toBe(true);
    expect(usesCascade(picture)).toBe(false);
    expect(usesCascade(cascades)).toBe(true);
    // Screened over him as the picture is, with its own stencil and depth for each of its strokes
    expect(named(cascades, 'blendFuncSeparate')[0]?.slice(1)).toEqual(
      named(picture, 'blendFuncSeparate')[0]?.slice(1) ?? [],
    );
    expect(named(cascades, 'disable').map(([, capability]) => capability)).toEqual([STENCIL_TEST, DEPTH_TEST, BLEND]);
  });

  it('hands the shader its numbers once a frame, as many vec4s as it declares, and the shared uniforms once', () => {
    const { made, cascades } = drawnAt(LIT);
    const uploads = named(cascades, 'uniform4fv');
    const source = named(made.made, 'shaderSource')
      .map(([, , text]) => String(text))
      .find((text) => text.includes('uniform vec4 cascade['));

    expect(uploads).toHaveLength(1);
    const [, , data] = uploads[0] ?? [];
    expect(data).toBe(made.picture.cascadeEdges);
    expect(data).toBeInstanceOf(Float32Array);
    expect(made.picture.cascadeEdges).toHaveLength(CASCADE_VECTORS * 4);
    expect(source).toContain(`uniform vec4 cascade[${CASCADE_VECTORS}];`);
    expect(made.picture.cascadeEdges).toEqual(plannedAt(LIT));
    // the cage's turn and the clock once, for the eight strokes that follow
    expect(named(cascades, 'useProgram')).toHaveLength(1);
    expect(named(cascades, 'uniform2f')).toHaveLength(1);
    expect(named(cascades, 'drawElements')).toHaveLength(16);
  });

  it('draws nothing between cascades', () => {
    const { cascades, usesCascade } = drawnAt(BETWEEN);

    expect(usesCascade(cascades)).toBe(false);
    expect(named(cascades, 'drawElements')).toHaveLength(0);
  });

  it('draws nothing of a lit cascade while the cage is dark, as he forms or leaves', () => {
    for (const overrides of [{ appearance: 0.3 }, { presence: 0.3 }, { appearance: 0.92, presence: 0 }]) {
      const { state, cascades, usesCascade } = drawnAt(LIT, overrides);

      expect(state.cageAlpha).toBeLessThan(1);
      expect(usesCascade(cascades)).toBe(false);
      expect(named(cascades, 'drawElements')).toHaveLength(0);
    }
  });

  it('draws a box that is still flaring after every edge of its cascade has gone out', () => {
    // find a frame with a box flaring, then put out every edge, as a plan whose last edges went first
    const made = madePicture();
    let time = 12;
    let state = analyseFrame(frameAt({ time }), 1);
    for (; time < 15; time += 1 / 60) {
      state = analyseFrame(frameAt({ time }), 1);
      writeGpuPictureCascade(made.picture, state);
      const box = CASCADE_BOXES_AT + CASCADE_BOX_SLOTS.light;
      if ((made.picture.cascadeEdges[box] ?? 0) > 0 || (made.picture.cascadeEdges[box + CASCADE_BOX_NUMBERS] ?? 0) > 0)
        break;
    }
    for (let edge = 0; edge < CASCADE_EDGES; edge++)
      made.picture.cascadeEdges[edge * CASCADE_EDGE_NUMBERS + CASCADE_EDGE_SLOTS.light] = 0;
    made.calls.length = 0;
    drawGpuPictureCascade(made.gl, made.picture, { state, pixels: 512, satellites: [] });

    expect(time).toBeLessThan(15);
    expect(named(made.calls, 'drawElements').length).toBeGreaterThan(0);
  });

  it("works out a frame's cascade before anything of the frame is drawn, and draws it over his body", () => {
    const calls: Call[] = [];
    const gl = recordingGl(calls);
    const body = createGpuBody(gl, createHologramScene(SCENE_SEED));
    const picture = createGpuPicture(gl, scene);
    calls.length = 0;
    const state = analyseFrame(frameAt({ time: LIT }), 1);
    const camera = placeFlatCamera(
      createFlatCamera(),
      { width: 600, height: 900, squareX: 300, squareY: 400, squareSide: 540 },
      state.radius,
      FRONT_VIEW,
      Number.POSITIVE_INFINITY,
    );
    drawGpuFrame(gl, body, picture, { state, density: 1, fade: 1, alphaFromLight: 1, camera }, []);
    const programs = named(calls, 'useProgram').map(([, program]) => program);
    const lastOfHisBody = programs.lastIndexOf(body.strokes.program);
    const cascade = programs.indexOf(picture.cascade.program.program);

    // a picture made fresh holds no cascade, so one is drawn only if this frame's was worked out first
    expect(picture.cascadeEdges).toEqual(plannedAt(LIT));
    expect(cascade).toBeGreaterThan(lastOfHisBody);
    expect(lastOfHisBody).toBeGreaterThan(programs.indexOf(picture.cage.program.program));
    expect(programs.at(-1)).toBe(picture.cascade.program.program);
  });
});
