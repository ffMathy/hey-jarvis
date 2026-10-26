import { AURA_INNER, AURA_OUTER, CORE_RING_RADIUS, PICTURE_SHELL_EDGE } from '../hologram-drawing';
import { GRADIENT_ROWS, GRADIENT_TEXELS } from './picture-glsl';

/**
 * The picture's gradients as rows of one texture: the glow of his core and the aura round him. A row
 * is the gradient's colours at {@link GRADIENT_TEXELS} positions from 0 to 1, made the way Skia
 * evaluates a gradient — the stops' colours interpolated as they are written, not premultiplied,
 * and premultiplied afterwards, clamped past the first and last stop — and stored premultiplied, as
 * the paints read them.
 */

/** A gradient's stops: colours as `#rrggbb` or `#rrggbbaa`, at positions from 0 to 1. */
export interface GradientStops {
  colours: readonly string[];
  positions: readonly number[];
}

/** How far the core's glow reaches from the core, in R. */
const CORE_GLOW_REACH = 0.53;

/** Which row each gradient is, and the radius a radial one reaches 1 at. */
export const GRADIENTS = {
  coreGlow: { row: 0, radius: CORE_GLOW_REACH },
  aura: { row: 1, radius: AURA_OUTER },
} as const;

/** Stops written at radii, in R, as a gradient that reaches its end at `reach`. */
function stopsAtRadii(reach: number, stops: readonly [radius: number, colour: string][]): GradientStops {
  return { colours: stops.map(([, colour]) => colour), positions: stops.map(([radius]) => radius / reach) };
}

/**
 * The glowing disc inside the white-hot ring and the ring's own glow: pale gold and a little less
 * bright than the ring inside it, at its brightest on the ring, and falling away fast outside it, so
 * the band between the core and the shell of specks stays dark and see-through, as the film's is.
 */
const CORE_GLOW = stopsAtRadii(CORE_GLOW_REACH, [
  [0, '#ffcf84a8'],
  [0.2, '#ffcf84b4'],
  [CORE_RING_RADIUS - 0.06, '#ffcf86d0'],
  [CORE_RING_RADIUS, '#ffc870cc'],
  [CORE_RING_RADIUS + 0.04, '#f5a2486b'],
  [CORE_RING_RADIUS + 0.09, '#e08a2c24'],
  [CORE_GLOW_REACH, '#e08a2c00'],
]);

/**
 * The aura: nothing inside {@link AURA_INNER}, rising to its brightest on the shell's edge, and
 * falling off softly to nothing at {@link AURA_OUTER}, warm gold where it is brightest and deep
 * amber at its far edge, as the film's bloom is near-white at its heart and orange in its falloff.
 */
const AURA = stopsAtRadii(AURA_OUTER, [
  [0, '#e08a2c00'],
  [AURA_INNER, '#e08a2c00'],
  [0.62, '#e8923410'],
  [PICTURE_SHELL_EDGE - 0.08, '#f09c3e8c'],
  [PICTURE_SHELL_EDGE, '#f4a246ff'],
  [0.98, '#ec963ac0'],
  [1.12, '#e08a2c5c'],
  [1.3, '#cc74241c'],
  [AURA_OUTER, '#b8641e00'],
]);

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
export function pictureGradientPixels(): Uint8Array {
  const rows: [number, GradientStops][] = [
    [GRADIENTS.coreGlow.row, CORE_GLOW],
    [GRADIENTS.aura.row, AURA],
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
