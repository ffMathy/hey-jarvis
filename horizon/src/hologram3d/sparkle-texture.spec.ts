import { describe, expect, it } from 'bun:test';
import { createHologramScene, SCENE_SEED } from 'hologram';
import { LinearFilter, NoColorSpace, RepeatWrapping } from 'three';
import {
  createSparkleTexture,
  SPARKLE_REPEAT,
  SPARKLE_SEED_MIX,
  SPARKLE_TEXTURE_TEXELS,
  sparklePixels,
} from './sparkle-texture';

describe('the sparkle', () => {
  const pixels = sparklePixels(createHologramScene(SCENE_SEED).textureSeed ^ SPARKLE_SEED_MIX);
  const levels = Array.from({ length: SPARKLE_TEXTURE_TEXELS ** 2 }, (_, texel) => (pixels[texel * 4] ?? 0) / 255);

  it('is grey and opaque in every texel', () => {
    for (let texel = 0; texel < SPARKLE_TEXTURE_TEXELS ** 2; texel++) {
      expect(pixels[texel * 4 + 1]).toBe(pixels[texel * 4]);
      expect(pixels[texel * 4 + 2]).toBe(pixels[texel * 4]);
      expect(pixels[texel * 4 + 3]).toBe(255);
    }
  });

  it('is mostly mid, with a quarter of dips and a tenth of hot spots, as the drawing’s is', () => {
    const share = (test: (level: number) => boolean) => levels.filter(test).length / levels.length;
    expect(share((level) => level >= 0.995)).toBeCloseTo(0.1, 1);
    expect(share((level) => level < 0.715)).toBeCloseTo(0.22, 1);
    expect(share((level) => level >= 0.715 && level < 0.925)).toBeCloseTo(0.68, 1);
  });

  it('is the same for the same seed, and different for another', () => {
    expect(sparklePixels(42)).toEqual(sparklePixels(42));
    expect(sparklePixels(42)).not.toEqual(sparklePixels(43));
  });

  it('repeats every 1.152 radii, filtered linearly and read as bytes rather than colour', () => {
    expect(SPARKLE_REPEAT).toBeCloseTo(1.152, 12);
    const texture = createSparkleTexture(7);
    expect([texture.wrapS, texture.wrapT]).toEqual([RepeatWrapping, RepeatWrapping]);
    expect([texture.minFilter, texture.magFilter]).toEqual([LinearFilter, LinearFilter]);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.colorSpace).toBe(NoColorSpace);
  });
});
