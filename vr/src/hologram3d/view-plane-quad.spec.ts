import { describe, expect, it } from 'bun:test';
import {
  AddEquation,
  ConstantAlphaFactor,
  ConstantColorFactor,
  CustomBlending,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  Texture,
  Vector3,
} from 'three';
import { ALPHA_FROM_LIGHT, createViewPlaneQuad } from './view-plane-quad';

describe('the view-plane quad', () => {
  it('is a square of the side it is given, for the hologram to scale to the phone’s whole drawing', () => {
    const { mesh } = createViewPlaneQuad(1, new Texture());
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox?.getSize(new Vector3());
    expect(size?.x).toBeCloseTo(1, 6);
    expect(size?.y).toBeCloseTo(1, 6);
  });

  it('Screens its light over the room, in colour and in alpha, faded as one layer, without writing depth', () => {
    const quad = createViewPlaneQuad(1, new Texture());
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
    // In full until it is told otherwise; then by the fade, the picture being drawn unfaded.
    const { blendColor } = material;
    expect([blendColor.r, blendColor.g, blendColor.b, material.blendAlpha]).toEqual([1, 1, 1, 1]);
    quad.setFade(0.4);
    expect([blendColor.r, blendColor.g, blendColor.b, material.blendAlpha]).toEqual([0.4, 0.4, 0.4, 0.4]);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.alphaFromLight.value).toBe(ALPHA_FROM_LIGHT);
  });

  it('shows the picture it is given, read the right way up from a target drawn bottom row first', () => {
    const picture = new Texture();
    const { material } = createViewPlaneQuad(1, picture).mesh;
    expect(material.uniforms.picture.value).toBe(picture);
    // Both targets are sampled where the quad's own coordinates fall, unflipped.
    expect(material.vertexShader).toContain('targetCoordinate = uv;');
  });

  it('stays hidden until he is first drawn', () => {
    expect(createViewPlaneQuad(1, new Texture()).mesh.visible).toBe(false);
  });

  it('lets go of only what it made, leaving the picture to its target', () => {
    const picture = new Texture();
    let pictureDisposed = false;
    picture.addEventListener('dispose', () => {
      pictureDisposed = true;
    });
    createViewPlaneQuad(1, picture).dispose();
    expect(pictureDisposed).toBe(false);
  });
});
