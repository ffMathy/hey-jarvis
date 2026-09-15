import { beforeAll, describe, expect, it } from 'bun:test';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import { createHologramResources, createHologramScene, drawHologram, type HologramFrame } from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * The hologram, drawn for real.
 *
 * React Native Skia's JavaScript API runs over CanvasKit here — the same drawing
 * calls the phone makes, rasterised on the CPU — so these tests look at actual
 * pixels rather than at which functions were called. They cannot say whether it
 * is beautiful; they can say it moves, that it answers Jarvis's voice, and that
 * it stays inside its square.
 */

const SIZE = 256;
const SEED = 1337;

let Skia: ReturnType<typeof JsiSkApi>;

/** Where `LoadSkiaWeb` leaves CanvasKit once the WebAssembly has loaded. */
interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

beforeAll(async () => {
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) {
    throw new Error('CanvasKit did not load');
  }
  // The same API the app gets from the package root, built over CanvasKit.
  Skia = JsiSkApi(globalThis.CanvasKit);
});

function silence(time: number): HologramFrame {
  return { time, level: 0, bands: new Array(VOICE_BAND_COUNT).fill(0), speaking: false };
}

function speech(time: number, level: number, bands: number[]): HologramFrame {
  return { time, level, bands, speaking: true };
}

/** A spectrum with energy in the lowest bands only, or the highest only. */
function spectrum(where: 'low' | 'high', energy: number): number[] {
  return Array.from({ length: VOICE_BAND_COUNT }, (_, band) => {
    const isLow = band < VOICE_BAND_COUNT / 3;
    const isHigh = band >= (VOICE_BAND_COUNT * 2) / 3;
    return (where === 'low' ? isLow : isHigh) ? energy : 0;
  });
}

/** Renders one frame and returns its RGBA pixels. */
function render(frame: HologramFrame): Uint8Array {
  const scene = createHologramScene(SEED);
  const resources = createHologramResources(Skia, scene);
  const surface = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  if (!surface) {
    throw new Error('Could not create a surface to draw on');
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('#000000'));
  drawHologram(canvas, SIZE, frame, scene, resources);
  surface.flush();

  const pixels = surface.makeImageSnapshot().readPixels();
  if (!(pixels instanceof Uint8Array)) {
    throw new Error('Could not read the pixels back');
  }
  return pixels;
}

/** Mean luminance over the whole square, 0–255. */
function brightness(pixels: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += 0.2126 * (pixels[index] ?? 0) + 0.7152 * (pixels[index + 1] ?? 0) + 0.0722 * (pixels[index + 2] ?? 0);
  }
  return total / (pixels.length / 4);
}

/** Mean absolute difference per channel between two renders, 0–255. */
function difference(first: Uint8Array, second: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < first.length; index++) {
    total += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }
  return total / first.length;
}

/** Mean luminance of the outermost `band` pixels on every side. */
function edgeBrightness(pixels: Uint8Array, band: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= band && x < SIZE - band && y >= band && y < SIZE - band) continue;
      const index = (y * SIZE + x) * 4;
      total += 0.2126 * (pixels[index] ?? 0) + 0.7152 * (pixels[index + 1] ?? 0) + 0.0722 * (pixels[index + 2] ?? 0);
      count++;
    }
  }
  return total / count;
}

describe('the hologram', () => {
  it('draws something, and something golden rather than white or blue', () => {
    const pixels = render(speech(5, 0.7, spectrum('low', 0.7)));
    let red = 0;
    let blue = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      red += pixels[index] ?? 0;
      blue += pixels[index + 2] ?? 0;
    }

    expect(brightness(pixels)).toBeGreaterThan(5);
    expect(red).toBeGreaterThan(blue * 1.5);
  });

  it('moves while Jarvis is silent, so an idle screen still looks alive', () => {
    expect(difference(render(silence(1)), render(silence(2.5)))).toBeGreaterThan(1);
  });

  it('draws the same frame the same way every time', () => {
    expect(
      difference(render(speech(4.2, 0.5, spectrum('high', 0.5))), render(speech(4.2, 0.5, spectrum('high', 0.5)))),
    ).toBe(0);
  });

  it('builds the same scene from the same seed, so it looks the same every time the app opens', () => {
    expect(JSON.stringify(createHologramScene(SEED))).toBe(JSON.stringify(createHologramScene(SEED)));
  });

  it('brightens clearly when Jarvis speaks loudly, compared with silence at the same moment', () => {
    const silent = brightness(render(silence(6)));
    const loud = brightness(render(speech(6, 1, new Array(VOICE_BAND_COUNT).fill(0.9))));

    expect(loud).toBeGreaterThan(silent * 1.3);
  });

  it('answers soft speech less than loud speech', () => {
    const soft = brightness(render(speech(6, 0.35, new Array(VOICE_BAND_COUNT).fill(0.35))));
    const loud = brightness(render(speech(6, 1, new Array(VOICE_BAND_COUNT).fill(0.9))));

    expect(loud).toBeGreaterThan(soft);
  });

  it('shows which frequencies are sounding, not just how loud he is', () => {
    // Same moment, same overall level; only where the energy sits differs.
    const low = render(speech(7, 0.7, spectrum('low', 0.9)));
    const high = render(speech(7, 0.7, spectrum('high', 0.9)));

    expect(difference(low, high)).toBeGreaterThan(0.5);
  });

  it('stays inside its square even at full volume, rather than being clipped at the edges', () => {
    const loudest = render(speech(8, 1, new Array(VOICE_BAND_COUNT).fill(1)));

    expect(edgeBrightness(loudest, Math.round(SIZE * 0.02))).toBeLessThan(2);
  });
});
