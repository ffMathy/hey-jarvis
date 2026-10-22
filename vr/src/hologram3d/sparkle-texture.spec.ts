import { describe, expect, it } from 'bun:test';
import { LinearFilter, NoColorSpace, RepeatWrapping } from 'three';
import { createSparkleTexture } from './sparkle-texture';

describe('the sparkle as a texture', () => {
  it('is repeated, filtered linearly and read as bytes rather than colour', () => {
    const texture = createSparkleTexture(7);
    expect([texture.wrapS, texture.wrapT]).toEqual([RepeatWrapping, RepeatWrapping]);
    expect([texture.minFilter, texture.magFilter]).toEqual([LinearFilter, LinearFilter]);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.colorSpace).toBe(NoColorSpace);
  });
});
