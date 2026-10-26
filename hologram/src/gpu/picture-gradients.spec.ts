import { describe, expect, it } from 'bun:test';
import { CORE_RING_RADIUS } from '../hologram-drawing';
import { GRADIENT_TEXELS } from './picture-glsl';
import { GRADIENTS, pictureGradientPixels } from './picture-gradients';

/**
 * The picture's gradients as the texture holds them. How they look drawn is vr's browser tests' to
 * say; what is pinned here is the shape of the glow inside his core's ring, which has been wrong
 * both ways.
 */

/** The core glow's light at `radius` R from the core: the luminance of its premultiplied texel, 0–255. */
function coreGlowAt(pixels: Uint8Array, radius: number): number {
  const { row, radius: reach } = GRADIENTS.coreGlow;
  const texel = Math.round(Math.min(1, radius / reach) * (GRADIENT_TEXELS - 1));
  const at = (row * GRADIENT_TEXELS + texel) * 4;
  return 0.2126 * (pixels[at] ?? 0) + 0.7152 * (pixels[at + 1] ?? 0) + 0.0722 * (pixels[at + 2] ?? 0);
}

describe("the glow inside his core's ring", () => {
  const pixels = pictureGradientPixels();
  const ring = coreGlowAt(pixels, CORE_RING_RADIUS);

  it('fills the ring as a haze, brightest at the ring and never darker towards it', () => {
    let previous = 0;
    for (let radius = 0; radius <= CORE_RING_RADIUS; radius += 0.01) {
      const here = coreGlowAt(pixels, radius);
      expect(here).toBeGreaterThanOrEqual(previous);
      previous = here;
    }
    // Just inside the ring it is nearly the ring's own light, as the film's is.
    expect(coreGlowAt(pixels, CORE_RING_RADIUS * 0.9)).toBeGreaterThan(ring * 0.75);
  });

  it('falls to about half the ring at the middle: neither the opaque coin nor the dark hole it has been', () => {
    // Pale gold and nearly as bright at the middle as at the ring, it read as a coin laid over him;
    // faint amber at a fifth of the ring, the inside of the ring was a hole where the film's glows.
    const middle = coreGlowAt(pixels, 0);

    expect(middle).toBeGreaterThan(ring * 0.35);
    expect(middle).toBeLessThan(ring * 0.6);
  });
});
