import { describe, expect, it } from 'bun:test';
import {
  AddEquation,
  ConstantAlphaFactor,
  ConstantColorFactor,
  CustomBlending,
  NoColorSpace,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  Texture,
  Vector3,
} from 'three';
import { ALPHA_FROM_LIGHT, createViewPlaneQuad } from './view-plane-quad';

describe('the view-plane quad', () => {
  it('is a square of the side it is given, for the hologram to scale to the phone’s whole drawing', () => {
    const { mesh } = createViewPlaneQuad(1);
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox?.getSize(new Vector3());
    expect(size?.x).toBeCloseTo(1, 6);
    expect(size?.y).toBeCloseTo(1, 6);
  });

  it('Screens its light over the room, in colour and in alpha, faded as one layer, without writing depth', () => {
    const quad = createViewPlaneQuad(1);
    const { material } = quad.mesh;
    expect(material.blending).toBe(CustomBlending);
    expect([material.blendEquation, material.blendSrc, material.blendDst]).toEqual([
      AddEquation,
      ConstantColorFactor,
      OneMinusSrcColorFactor,
    ]);
    expect([material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha]).toEqual([
      AddEquation,
      ConstantAlphaFactor,
      OneMinusSrcAlphaFactor,
    ]);
    // In full until it is told otherwise; then by the fade, with the picture's own fade undone.
    const { blendColor } = material;
    expect([blendColor.r, blendColor.g, blendColor.b, material.blendAlpha]).toEqual([1, 1, 1, 1]);
    quad.setFade(0.4, 0.5);
    expect([blendColor.r, blendColor.g, blendColor.b, material.blendAlpha]).toEqual([0.4, 0.4, 0.4, 0.4]);
    expect(material.uniforms.pictureFade.value).toBe(0.5);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.alphaFromLight.value).toBe(ALPHA_FROM_LIGHT);
  });

  it('samples Skia’s bytes as they are, with no colour management in between', () => {
    const picture: unknown = createViewPlaneQuad(1).mesh.material.uniforms.picture.value;
    expect(picture).toBeInstanceOf(Texture);
    if (picture instanceof Texture) {
      expect(picture.colorSpace).toBe(NoColorSpace);
      expect(picture.flipY).toBe(false);
    }
  });

  it('stays hidden until it has a picture to show', () => {
    expect(createViewPlaneQuad(1).mesh.visible).toBe(false);
  });
});
