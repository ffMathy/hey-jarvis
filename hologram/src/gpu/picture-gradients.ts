import { limbRidgeStops } from '../hologram-drawing';
import { GRADIENT_ROWS, GRADIENT_TEXELS } from './picture-glsl';

/**
 * The picture's gradients as rows of one texture: the limb bloom's ring profile and its mask round
 * the limb, the limb ridge's (lumpy, from the scene's seed), the thin ring's sweep and the core's
 * bloom. A row is the gradient's colours at {@link GRADIENT_TEXELS} positions from 0 to 1, made the
 * way Skia evaluates a gradient — the stops' colours interpolated as they are written, not
 * premultiplied, and premultiplied afterwards, clamped past the first and last stop — and stored
 * premultiplied, as the paints read them.
 */

/** A gradient's stops: colours as `#rrggbb` or `#rrggbbaa`, at positions from 0 to 1. */
export interface GradientStops {
  colours: readonly string[];
  positions: readonly number[];
}

/** Which row each gradient is, and the radius a radial one reaches 1 at. */
export const GRADIENTS = {
  bloomRing: { row: 0, radius: 1.12 },
  bloomMask: { row: 1 },
  ridgeRing: { row: 2, radius: 1.06 },
  ridgeLumps: { row: 3 },
  thinRing: { row: 4 },
  coreBloom: { row: 5, radius: 1 },
} as const;

const BLOOM_RING: GradientStops = {
  colours: ['#ffffff00', '#ffffff00', '#ffffff70', '#ffffffff', '#ffffff80', '#ffffff00'],
  positions: [0, 0.79, 0.855, 0.895, 0.935, 0.985],
};
// Peaked at 8-9 o'clock: a sweep starts at 3 o'clock and runs clockwise.
const BLOOM_MASK: GradientStops = {
  colours: ['#e8801c00', '#e8801c00', '#ec8a2280', '#f0962aff', '#ec8a2280', '#e8801c00', '#e8801c00'],
  positions: [0, 0.27, 0.37, 0.47, 0.6, 0.7, 1],
};
const RIDGE_RING: GradientStops = {
  colours: ['#ffffff00', '#ffffff00', '#ffffff80', '#ffffffff', '#ffffff70', '#ffffff00'],
  positions: [0, 0.84, 0.885, 0.915, 0.94, 0.965],
};
// Brightest from 1 to 4 o'clock.
const THIN_RING: GradientStops = {
  colours: ['#e69c50', '#e69c50', '#9c5e2e', '#9c5e2e', '#e69c50', '#e69c50'],
  positions: [0, 0.09, 0.22, 0.7, 0.82, 1],
};
// Elongated along the diagonal by its draw, with a darker orange inside the hot ring, never white.
const CORE_BLOOM: GradientStops = {
  colours: ['#d06a2ec0', '#e88030e8', '#f68e30e8', '#e6802eb0', '#dc742a50', '#c8602600'],
  positions: [0, 0.22, 0.34, 0.5, 0.74, 1],
};

/** A `#rrggbb` or `#rrggbbaa` colour as four channels from 0 to 1, not premultiplied. */
export function parseColour(colour: string): [number, number, number, number] {
  const hex = colour.replace('#', '');
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) throw new Error(`Not a colour the picture can paint: ${colour}`);
  return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) : 1];
}

/** One gradient's colour at `position`, premultiplied. */
export function gradientColour(stops: GradientStops, position: number): [number, number, number, number] {
  const { colours, positions } = stops;
  const last = positions.length - 1;
  let below = 0;
  while (below < last && positions[below + 1] <= position) below++;
  const from = parseColour(colours[below]);
  if (below === last || position <= positions[0]) {
    const at = position <= positions[0] ? parseColour(colours[0]) : from;
    return [at[0] * at[3], at[1] * at[3], at[2] * at[3], at[3]];
  }
  const to = parseColour(colours[below + 1]);
  const span = positions[below + 1] - positions[below];
  const share = span > 0 ? (position - positions[below]) / span : 0;
  const mixed = from.map((value, channel) => value + (to[channel] - value) * share);
  return [mixed[0] * mixed[3], mixed[1] * mixed[3], mixed[2] * mixed[3], mixed[3]];
}

/** Every gradient's row, as the bytes of a {@link GRADIENT_TEXELS} × {@link GRADIENT_ROWS} RGBA8 texture. */
export function pictureGradientPixels(textureSeed: number): Uint8Array {
  const rows: [number, GradientStops][] = [
    [GRADIENTS.bloomRing.row, BLOOM_RING],
    [GRADIENTS.bloomMask.row, BLOOM_MASK],
    [GRADIENTS.ridgeRing.row, RIDGE_RING],
    [GRADIENTS.ridgeLumps.row, limbRidgeStops(textureSeed)],
    [GRADIENTS.thinRing.row, THIN_RING],
    [GRADIENTS.coreBloom.row, CORE_BLOOM],
  ];
  const pixels = new Uint8Array(GRADIENT_TEXELS * GRADIENT_ROWS * 4);
  for (const [row, stops] of rows) {
    for (let texel = 0; texel < GRADIENT_TEXELS; texel++) {
      const colour = gradientColour(stops, texel / (GRADIENT_TEXELS - 1));
      const at = (row * GRADIENT_TEXELS + texel) * 4;
      for (let channel = 0; channel < 4; channel++) pixels[at + channel] = Math.round(colour[channel] * 255);
    }
  }
  return pixels;
}
