import {
  type HologramScene,
  SPARKLE_SEED_MIX,
  SPARKLE_TEXEL_SIZE,
  SPARKLE_TEXTURE_TEXELS,
  sparklePixels,
} from '../hologram-drawing';

/**
 * The sparkle the body's mid and bright strokes are modulated by, for a GPU pass: the drawing's own
 * texels (`sparklePixels`, the very bytes Skia's image shader tiles), fixed in the drawing's unit
 * space so strokes move through it and glint where the phone's do.
 *
 * Uploaded as a 64×64 RGBA8 texture, repeated both ways and filtered linearly without mipmaps, as
 * the drawing's image shader is, with no colour management, since its bytes are a multiplier.
 */

/** How far apart its repeats are, in the drawing's unit. */
export const SPARKLE_REPEAT = SPARKLE_TEXTURE_TEXELS * SPARKLE_TEXEL_SIZE;

/** The sparkle's RGBA bytes for a scene. */
export function sceneSparklePixels(scene: Pick<HologramScene, 'textureSeed'>): Uint8Array {
  return sparklePixels(scene.textureSeed ^ SPARKLE_SEED_MIX);
}
