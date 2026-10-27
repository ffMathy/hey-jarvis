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
 * The glow inside the white-hot ring and the ring's own bloom. Inside, the film's disc is a warm
 * glowing haze that fills the ring: at its brightest just inside the ring, a pale orange there, and
 * falling away to about half the ring's light at the middle, a deeper copper, which leaves what lies
 * behind it showing through. On the ring it blooms both ways, inward into that haze and outward into
 * the band between the core and the shell of specks, which it leaves dark and see-through, as the
 * film's is. It is the palest of him, as both films have his middle, and still orange rather than
 * gold (Age of Ultron's colour, see `gpu-picture.ts`).
 *
 * It has been both ways wrong. Pale and nearly as bright at the middle as at the ring, it read as
 * an opaque coin laid over him; then faint amber at a fifth of the ring's light, the inside of the
 * ring was a dark hole where the film's glows.
 */
const CORE_GLOW = stopsAtRadii(CORE_GLOW_REACH, [
  [0, '#e07c3c76'],
  [0.12, '#e4823f7c'],
  [0.22, '#ea8a4690'],
  [CORE_RING_RADIUS - 0.07, '#f0964eac'],
  [CORE_RING_RADIUS - 0.025, '#f8a85ecc'],
  [CORE_RING_RADIUS, '#ffb878d8'],
  [CORE_RING_RADIUS + 0.025, '#f08e4aa0'],
  [CORE_RING_RADIUS + 0.06, '#e4743458'],
  [CORE_RING_RADIUS + 0.11, '#d8642a1c'],
  [CORE_GLOW_REACH, '#d45a2200'],
]);

/**
 * The aura: nothing inside {@link AURA_INNER}, rising to its brightest on the shell's edge, and
 * falling off softly to nothing at {@link AURA_OUTER}, orange where it is brightest and a deep red
 * copper at its far edge, as Age of Ultron's bloom reddens in its falloff: the aura is the reddest
 * of him.
 */
const AURA = stopsAtRadii(AURA_OUTER, [
  [0, '#d45a2200'],
  [AURA_INNER, '#d45a2200'],
  [0.62, '#dc642810'],
  [PICTURE_SHELL_EDGE - 0.08, '#e672308c'],
  [PICTURE_SHELL_EDGE, '#ea7834ff'],
  [0.98, '#e26c2ec0'],
  [1.12, '#d45a225c'],
  [1.3, '#bc4c1a1c'],
  [AURA_OUTER, '#a4401600'],
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
