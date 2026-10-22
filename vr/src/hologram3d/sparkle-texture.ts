import { SPARKLE_SEED_MIX, SPARKLE_TEXTURE_TEXELS, sparklePixels } from 'hologram';
import { DataTexture, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

/**
 * The sparkle the body's mid and bright strokes are modulated by, for a scene's texture seed, as a
 * three.js texture: the drawing's own texels (`sparklePixels` in `hologram`, see `hologram/gpu`'s
 * `sparkle.ts`), repeated, filtered linearly without mipmaps as the drawing's image shader is, and
 * with no colour management, since its bytes are a multiplier rather than a colour.
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
