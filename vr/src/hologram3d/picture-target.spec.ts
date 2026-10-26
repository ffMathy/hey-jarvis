import { describe, expect, it } from 'bun:test';
import { LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { createPictureRenderTarget, PICTURE_SIZE_PIXELS } from './picture-target';

/**
 * What his picture is drawn into. Whether the picture drawn there is right is the browser's to say:
 * `tests/e2e/hologram-picture.spec.ts` draws it through this very target and holds it to Skia's.
 */
describe('the picture target', () => {
  it('has the depth and stencil buffers the GPU picture needs under it', () => {
    // Without a stencil buffer every path's overlaps are lit twice; without a depth buffer the
    // faint edge of one strand of the crescent darkens the one lying over it (`gpu-picture.ts`).
    const target = createPictureRenderTarget(PICTURE_SIZE_PIXELS);
    expect(target.depthBuffer).toBe(true);
    expect(target.stencilBuffer).toBe(true);
  });

  it('is a square of the side it is given, of plain bytes, never mipmapped', () => {
    const target = createPictureRenderTarget(256);
    expect([target.width, target.height]).toEqual([256, 256]);
    expect(target.texture.type).toBe(UnsignedByteType);
    expect(target.texture.format).toBe(RGBAFormat);
    expect(target.texture.generateMipmaps).toBe(false);
    expect([target.texture.minFilter, target.texture.magFilter]).toEqual([LinearFilter, LinearFilter]);
  });

  it('carries the picture’s bytes as they are, with no colour management in between', () => {
    expect(createPictureRenderTarget(PICTURE_SIZE_PIXELS).texture.colorSpace).toBe(NoColorSpace);
  });
});
