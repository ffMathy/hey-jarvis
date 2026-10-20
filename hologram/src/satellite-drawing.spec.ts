import { beforeAll, describe, expect, it } from 'bun:test';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import { orbitPoint, PLAIN_RING_GLYPH, SAMPLE_AGENTS, type SatelliteOrbit } from './agent-work';
import { SPHERE_FRACTION } from './hologram-drawing';
import { createSatelliteResources, drawSatellites, SCREEN_GLYPH_RADII, SCREEN_ORBIT_RADII } from './satellite-drawing';

/** Drawn for real, headlessly in CanvasKit, as `hologram-drawing.spec.ts` draws him. */

const SIZE = 256;
const RADIUS = SIZE * SPHERE_FRACTION;

let Skia: ReturnType<typeof JsiSkApi>;

interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

beforeAll(async () => {
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) throw new Error('CanvasKit did not load');
  Skia = JsiSkApi(globalThis.CanvasKit);
});

function orbit(overrides: Partial<SatelliteOrbit> = {}): SatelliteOrbit {
  return { glyph: PLAIN_RING_GLYPH, level: 1, flare: 0, asking: false, turn: 0, reach: 1, ...overrides };
}

/** Every glyph this package knows: the plain ring, and sample mode's own. The real ones are the server's. */
const GLYPHS = [PLAIN_RING_GLYPH, ...SAMPLE_AGENTS.map((agent) => agent.glyph)];

function render(orbits: readonly SatelliteOrbit[], time = 0): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  if (!surface) throw new Error('Could not create a surface to draw on');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('#000000'));
  const made = drawSatellites(canvas, Skia, SIZE, time, orbits, createSatelliteResources(Skia));
  expect(made.length).toBe(orbits.filter((drawn) => drawn.level > 0).length);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels();
  if (!(pixels instanceof Uint8Array)) throw new Error('Could not read the pixels back');
  return pixels;
}

/** The brightest red within `reach` pixels of (x, y). */
function brightestNear(pixels: Uint8Array, x: number, y: number, reach: number): number {
  let brightest = 0;
  for (let row = Math.max(0, Math.floor(y - reach)); row <= Math.min(SIZE - 1, Math.ceil(y + reach)); row++) {
    for (
      let column = Math.max(0, Math.floor(x - reach));
      column <= Math.min(SIZE - 1, Math.ceil(x + reach));
      column++
    ) {
      brightest = Math.max(brightest, pixels[(row * SIZE + column) * 4] ?? 0);
    }
  }
  return brightest;
}

function litPixels(pixels: Uint8Array): number {
  let lit = 0;
  for (let index = 0; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 24) lit++;
  return lit;
}

/** Where `drawn` is on the canvas at `time`, in pixels. */
function whereOnCanvas(drawn: SatelliteOrbit, time: number): { x: number; y: number } {
  const { across, up } = orbitPoint(drawn, time);
  return { x: SIZE / 2 + across * RADIUS * SCREEN_ORBIT_RADII, y: SIZE / 2 - up * RADIUS * SCREEN_ORBIT_RADII };
}

describe('the satellites on a screen', () => {
  it('fit inside the canvas, glyph and flare included, wherever they are on the ring', () => {
    const outermost = RADIUS * (SCREEN_ORBIT_RADII + SCREEN_GLYPH_RADII * 1.75);
    expect(outermost).toBeLessThan(SIZE / 2);
  });

  it('draw nothing when there are none', () => {
    expect(litPixels(render([]))).toBe(0);
  });

  it('draw the glyph each is sent where its orbit says, and nothing at his centre', () => {
    for (const [index, glyph] of GLYPHS.entries()) {
      const drawn = orbit({ glyph, turn: index / GLYPHS.length });
      const pixels = render([drawn], 1.2);
      const { x, y } = whereOnCanvas(drawn, 1.2);

      expect(brightestNear(pixels, x, y, RADIUS * SCREEN_GLYPH_RADII)).toBeGreaterThan(120);
      expect(brightestNear(pixels, SIZE / 2, SIZE / 2, 4)).toBe(0);
    }
  });

  it('are dimmer passing behind him than in front of him', () => {
    const front = orbit({ turn: 0.25 });
    const behind = orbit({ turn: 0.75 });

    expect(litPixels(render([front]))).toBeGreaterThan(litPixels(render([behind])));
    expect(whereOnCanvas(front, 0).y).toBeGreaterThan(whereOnCanvas(behind, 0).y);
  });

  it('flare with a ring going out from the glyph as a tool is called', () => {
    expect(litPixels(render([orbit({ flare: 0.6 })]))).toBeGreaterThan(litPixels(render([orbit()])));
  });

  it('draw a different picture for each glyph they are sent', () => {
    const pictures = GLYPHS.map((glyph) => render([orbit({ glyph })]).join(','));

    expect(new Set(pictures).size).toBe(GLYPHS.length);
  });

  it('draw a glyph Skia cannot read as the plain ring, since its agent is still at work', () => {
    expect(render([orbit({ glyph: 'M 0 0 L' })])).toEqual(render([orbit({ glyph: PLAIN_RING_GLYPH })]));
  });

  it('are not drawn once they have gone out', () => {
    expect(litPixels(render([orbit({ level: 0 })]))).toBe(0);
  });
});
