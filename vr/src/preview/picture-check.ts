import {
  analyseFrame,
  arrivalOf,
  BODY_TURN_SECONDS,
  CORE_RING_RADIUS,
  CORE_X,
  CORE_Y,
  createHologramScene,
  MATERIALISE_SECONDS,
  orbitPoint,
  PLAIN_RING_GLYPH,
  ROLL_DEGREES_PER_SECOND,
  SAMPLE_AGENTS,
  SCENE_SEED,
  SCREEN_GLYPH_RADII,
  SCREEN_ORBIT_RADII,
  SPHERE_FRACTION,
  VOICE_BAND_COUNT,
} from 'hologram';
import type { WebGLRenderer } from 'three';
import { createPictureTarget, NO_SATELLITES, type PictureTarget } from '../hologram3d/picture-target';
import type {
  DrawnPictures,
  PictureCheck,
  PictureCheckRequest,
  PictureFacts,
  PictureGoldenRequest,
  PictureMoment,
  PictureOrbit,
  PictureOrbitPoint,
  PictureRequest,
} from './preview-hook';

/**
 * His picture of everything but his body — `hologram/gpu`'s `drawGpuPicture` — drawn for the browser
 * tests exactly as the headset draws it: into a `PictureTarget` (`hologram3d/picture-target.ts`) on
 * the stage's own three.js renderer, then read back. Nothing in the app calls it.
 *
 * The target is kept for each size and drawn into again for every moment after the first, as the
 * headset's is every frame, so a test can tell whether anything one frame draws reaches the next.
 */

const scene = createHologramScene(SCENE_SEED);
const targets = new Map<number, PictureTarget>();

function targetOf(renderer: WebGLRenderer, size: number): PictureTarget {
  let target = targets.get(size);
  if (target === undefined) {
    target = createPictureTarget(renderer, size);
    targets.set(size, target);
  }
  return target;
}

/** Draws `moment` into the `size`-pixel target and reads it back: RGBA, premultiplied, bottom row first. */
function drawMoment(renderer: WebGLRenderer, size: number, moment: PictureMoment): Uint8Array {
  const target = targetOf(renderer, size);
  target.draw(analyseFrame(moment.frame, 1, scene), moment.satellites ?? NO_SATELLITES);
  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target.target, 0, 0, size, size, pixels);
  return pixels;
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function bytesOf(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function drawPictures(renderer: WebGLRenderer, request: PictureRequest): DrawnPictures {
  return {
    pictures: request.moments.map((moment) => base64Of(drawMoment(renderer, request.size, moment))),
    arrivals: request.moments.map(({ frame }) => arrivalOf(frame.appearance, frame.presence)),
  };
}

export function pictureFacts(): PictureFacts {
  // Six numbers an epoch, its start first (see the script in hologram's `hologram-drawing.ts`).
  const scriptBoundaries: number[] = [];
  for (let offset = 0; offset < scene.epochs.length; offset += 6) scriptBoundaries.push(scene.epochs[offset]);
  return {
    voiceBandCount: VOICE_BAND_COUNT,
    sphereFraction: SPHERE_FRACTION,
    materialiseSeconds: MATERIALISE_SECONDS,
    scriptBoundaries,
    plainRingGlyph: PLAIN_RING_GLYPH,
    sampleGlyphs: SAMPLE_AGENTS.map((agent) => agent.glyph),
    screenOrbitRadii: SCREEN_ORBIT_RADII,
    screenGlyphRadii: SCREEN_GLYPH_RADII,
    coreAcross: CORE_X,
    coreDown: CORE_Y,
    coreRingRadius: CORE_RING_RADIUS,
    rollDegreesPerSecond: ROLL_DEGREES_PER_SECOND,
    bodyTurnSeconds: BODY_TURN_SECONDS,
  };
}

export function orbitPoints(orbits: readonly PictureOrbit[], time: number): PictureOrbitPoint[] {
  return orbits.map((orbit) => {
    const { across, up } = orbitPoint(orbit, time);
    return { across, up };
  });
}

/**
 * A PNG's pixels, top row first, as it holds them: unpremultiplied and with no colour conversion,
 * which is how {@link pictureGolden} writes the goldens.
 */
async function pixelsOfPng(base64: string, size: number): Promise<Uint8ClampedArray> {
  const image = await createImageBitmap(new Blob([bytesOf(base64)], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (image.width !== size || image.height !== size) {
    throw new Error(`The golden is ${image.width}×${image.height}, not ${size}×${size}.`);
  }
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2D canvas to read the golden with.');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, size, size).data;
}

function luma(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Mean Rec. 709 luma of RGBA `pixels`, 0–255. */
function meanLumaOf(pixels: ArrayLike<number>): number {
  let total = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    total += luma(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
  }
  return total / (pixels.length / 4);
}

/** `pixels` with their rows the other way up: a framebuffer is read bottom row first, a PNG top first. */
function flipped(pixels: Uint8Array, size: number): Uint8Array {
  const turned = new Uint8Array(pixels.length);
  const row = size * 4;
  for (let y = 0; y < size; y++) turned.set(pixels.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
  return turned;
}

/** How many of the RGB channels differ by each amount, 0–255, and how many pixels by more than 16 in any. */
function differencesOf(drawn: ArrayLike<number>, golden: ArrayLike<number>) {
  const counts = new Uint32Array(256);
  let total = 0;
  let pixelsOver16 = 0;
  for (let offset = 0; offset < drawn.length; offset += 4) {
    let largest = 0;
    for (let channel = offset; channel < offset + 3; channel++) {
      const difference = Math.abs(drawn[channel] - golden[channel]);
      counts[difference]++;
      total += difference;
      largest = Math.max(largest, difference);
    }
    if (largest > 16) pixelsOver16++;
  }
  return { counts, total, pixelsOver16 };
}

/** The 99th percentile and the largest of the differences `counts` holds, out of `channels`. */
function spreadOf(counts: Uint32Array, channels: number) {
  let percentile99 = 0;
  let largestDifference = 0;
  let seen = 0;
  for (let difference = 0; difference < counts.length; difference++) {
    if (counts[difference] === 0) continue;
    largestDifference = difference;
    if (seen < channels * 0.99) percentile99 = difference;
    seen += counts[difference];
  }
  return { percentile99, largestDifference };
}

/**
 * Compares the GPU picture of a moment with its golden: RGB only, since the golden is the picture
 * over black and the GPU's premultiplied light over transparent black is the same light; the GPU's
 * rows are flipped, a framebuffer being read bottom row first.
 */
export async function checkPicture(renderer: WebGLRenderer, request: PictureCheckRequest): Promise<PictureCheck> {
  const { size } = request;
  const drawn = flipped(drawMoment(renderer, size, request), size);
  const golden = await pixelsOfPng(request.golden, size);
  const { counts, total, pixelsOver16 } = differencesOf(drawn, golden);
  const channels = size * size * 3;
  return {
    meanDifference: total / channels,
    ...spreadOf(counts, channels),
    shareOver16: pixelsOver16 / (size * size),
    meanLuma: meanLumaOf(drawn),
    goldenMeanLuma: meanLumaOf(golden),
  };
}

/**
 * The GPU picture of a moment as a golden of it, a PNG in base64: drawn as {@link checkPicture}
 * draws it, its rows flipped to the top first, and its premultiplied light over transparent black
 * written as RGB over black with every pixel opaque — so {@link pixelsOfPng} reads back exactly the
 * RGB the check compares.
 */
export async function pictureGolden(renderer: WebGLRenderer, request: PictureGoldenRequest): Promise<string> {
  const { size } = request;
  const image = new ImageData(size, size);
  image.data.set(flipped(drawMoment(renderer, size, request), size));
  for (let alpha = 3; alpha < image.data.length; alpha += 4) image.data[alpha] = 255;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2D canvas to write the golden with.');
  context.putImageData(image, 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return base64Of(new Uint8Array(await png.arrayBuffer()));
}
