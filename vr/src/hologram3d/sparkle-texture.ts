import { DataTexture, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

/**
 * The sparkle the body's mid and bright strokes are modulated by: a tiled grey texture fixed in
 * the drawing's unit space, which strokes move through, so their brightness varies along them.
 *
 * A copy of `buildSparkleTexture` in `hologram/src/hologram-drawing.ts` (about line 1327), which
 * is module-private there because only Skia reads it; same texels, same hash, same seed, so the
 * headset's strokes glint where the phone's do. The spec pins a few texels against the formula.
 */

/** Side of the texture in texels, and how wide a texel is in the drawing's unit: a stroke spans about two. */
export const SPARKLE_TEXTURE_TEXELS = 64;
export const SPARKLE_TEXEL_SIZE = 0.018;
/** How far apart its repeats are, in the drawing's unit. */
export const SPARKLE_REPEAT = SPARKLE_TEXTURE_TEXELS * SPARKLE_TEXEL_SIZE;
/** What the drawing mixes into the scene's texture seed for the sparkle (`createHologramResources`). */
export const SPARKLE_SEED_MIX = 0x2545f491;

/** The texture's RGBA bytes for `seed`: mostly mid, some dips, a few hot spots. */
export function sparklePixels(seed: number): Uint8Array {
  const texels = SPARKLE_TEXTURE_TEXELS;
  const pixels = new Uint8Array(texels * texels * 4);
  for (let texel = 0; texel < texels * texels; texel++) {
    let mixed = Math.imul(texel ^ seed, 0x9e3779b1);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x85ebca77);
    mixed ^= mixed >>> 13;
    const roll = ((mixed >>> 16) & 0xffff) / 65536;
    const second = (mixed & 0xffff) / 65536;
    const value = roll < 0.25 ? 0.5 + roll : roll > 0.9 ? 1 : 0.72 + 0.2 * second;
    const level = Math.round(255 * value);
    pixels.set([level, level, level, 255], texel * 4);
  }
  return pixels;
}

/**
 * The sparkle for a scene's texture seed, as a texture: repeated, filtered linearly without
 * mipmaps as the drawing's image shader is, and with no colour management, since its bytes are a
 * multiplier rather than a colour.
 */
export function createSparkleTexture(textureSeed: number): DataTexture {
  const texture = new DataTexture(
    sparklePixels(textureSeed ^ SPARKLE_SEED_MIX),
    SPARKLE_TEXTURE_TEXELS,
    SPARKLE_TEXTURE_TEXELS,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
