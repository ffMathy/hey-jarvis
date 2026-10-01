import { describe, expect, it } from 'bun:test';
import {
  AddEquation,
  CustomBlending,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Texture,
} from 'three';
import {
  CANVAS_MARGIN_PIXELS,
  canvasMetres,
  canvasPixels,
  configureCanvasTexture,
  createCanvasMaterial,
  PIXELS_PER_METRE,
  TEXT_LOD_BIAS,
  withMargin,
} from './ui-canvas';

describe('a canvas texture for the room', () => {
  it('is mipmapped and read trilinearly, so a panel shown smaller than it is drawn never skips texels', () => {
    const texture = configureCanvasTexture(new Texture(), 16);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(LinearFilter);
  });

  it('takes the anisotropy the renderer has, and never less than none', () => {
    expect(configureCanvasTexture(new Texture(), 16).anisotropy).toBe(16);
    expect(configureCanvasTexture(new Texture(), 1).anisotropy).toBe(1);
    // A renderer without the extension reports 0; a texture's anisotropy is a whole number of samples.
    expect(configureCanvasTexture(new Texture(), 0).anisotropy).toBe(1);
    expect(configureCanvasTexture(new Texture(), 8.5).anisotropy).toBe(8);
  });

  it('keeps the canvas’s own premultiplied, encoded bytes, so a filtered edge is less covered and never darker', () => {
    const texture = configureCanvasTexture(new Texture(), 4);
    expect(texture.premultiplyAlpha).toBe(true);
    expect(texture.colorSpace).toBe(NoColorSpace);
  });
});

describe('the material a canvas is shown with', () => {
  it('lays the premultiplied picture over what is behind it, colour and alpha alike', () => {
    const material = createCanvasMaterial(null);
    expect(material.blending).toBe(CustomBlending);
    expect([material.blendEquation, material.blendSrc, material.blendDst]).toEqual([
      AddEquation,
      OneFactor,
      OneMinusSrcAlphaFactor,
    ]);
    expect([material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha]).toEqual([
      AddEquation,
      OneFactor,
      OneMinusSrcAlphaFactor,
    ]);
    material.dispose();
  });

  it('is drawn after everything else and hidden by nothing', () => {
    const material = createCanvasMaterial(null);
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    material.dispose();
  });

  it('shows the texture it is given, and the one it is handed after a resize', () => {
    const first = new Texture();
    const material = createCanvasMaterial(first);
    expect(material.uniforms.picture.value).toBe(first);
    const second = new Texture();
    material.uniforms.picture.value = second;
    expect(material.uniforms.picture.value).toBe(second);
    material.dispose();
  });

  it(`reads the mipmaps ${-TEXT_LOD_BIAS} of a level sharper than the display alone would`, () => {
    expect(TEXT_LOD_BIAS).toBeLessThan(0);
    expect(TEXT_LOD_BIAS).toBeGreaterThanOrEqual(-1);
    const { fragmentShader } = createCanvasMaterial(null);
    expect(fragmentShader).toContain(`texture(picture, canvasCoordinate, ${TEXT_LOD_BIAS.toFixed(2)})`);
  });
});

describe('the transparent margin round a canvas', () => {
  it('is added on both sides', () => {
    expect(withMargin(100)).toBe(100 + 2 * CANVAS_MARGIN_PIXELS);
  });

  it('still leaves a transparent texel round the outline at the fourth mipmap level', () => {
    expect(CANVAS_MARGIN_PIXELS / 2 ** 3).toBeGreaterThanOrEqual(1);
  });

  it('is under a centimetre in the room, so nothing is placed round a panel for it', () => {
    expect(canvasMetres(CANVAS_MARGIN_PIXELS)).toBeLessThan(0.01);
  });
});

describe('canvas pixels and metres', () => {
  it(`are ${PIXELS_PER_METRE} to the metre, whole pixels one way and back again the other`, () => {
    expect(canvasPixels(0.39)).toBe(585);
    expect(canvasPixels(0.0125)).toBe(19);
    expect(canvasMetres(canvasPixels(0.39))).toBeCloseTo(0.39, 9);
  });
});
