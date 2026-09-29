import { describe, expect, it } from 'bun:test';
import {
  AddEquation,
  CustomBlending,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  Texture,
  Vector3,
} from 'three';
import { HOLOGRAM_RADIUS_METRES } from './dimensions';
import { ALPHA_FROM_LIGHT, createViewPlaneQuad, VIEW_PLANE_SIDE_METRES } from './view-plane-quad';

describe('the view-plane quad', () => {
  it('is the phone’s whole square, about 3.7 sphere radii across', () => {
    expect(VIEW_PLANE_SIDE_METRES / HOLOGRAM_RADIUS_METRES).toBeCloseTo(3.7, 1);
    const { mesh } = createViewPlaneQuad(VIEW_PLANE_SIDE_METRES);
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox?.getSize(new Vector3());
    expect(size?.x).toBeCloseTo(VIEW_PLANE_SIDE_METRES, 6);
    expect(size?.y).toBeCloseTo(VIEW_PLANE_SIDE_METRES, 6);
  });

  it('Screens its light over the room, in colour and in alpha, without writing depth', () => {
    const { material } = createViewPlaneQuad(1).mesh;
    expect(material.blending).toBe(CustomBlending);
    expect([material.blendEquation, material.blendSrc, material.blendDst]).toEqual([
      AddEquation,
      OneFactor,
      OneMinusSrcColorFactor,
    ]);
    expect([material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha]).toEqual([
      AddEquation,
      OneFactor,
      OneMinusSrcAlphaFactor,
    ]);
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

  it('turns its face to the viewer and keeps upright', () => {
    const quad = createViewPlaneQuad(1);
    quad.mesh.position.set(0, 1.6, -1.6);
    quad.faceViewer(new Vector3(1.6, 1.6, -1.6));
    quad.mesh.updateMatrixWorld();
    const facing = new Vector3(0, 0, 1).transformDirection(quad.mesh.matrixWorld);
    const up = new Vector3(0, 1, 0).transformDirection(quad.mesh.matrixWorld);
    expect(facing.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9);
    expect(up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9);
  });
});
