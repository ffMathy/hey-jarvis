import { describe, expect, it } from 'bun:test';
import { Object3D, Vector3 } from 'three';
import { createTagAlong, easingShare, placeUnder, TAG_ALONG_SECONDS } from './panel-placement';

describe('placeUnder', () => {
  it('puts the panel under his spot, facing the viewer and upright', () => {
    const panel = new Object3D();
    placeUnder(panel, { x: 0, y: 1.4, z: -1.6 }, -0.5, { x: 0, y: 1.6, z: 0 });
    expect(panel.position.x).toBeCloseTo(0, 12);
    expect(panel.position.y).toBeCloseTo(0.9, 12);
    expect(panel.position.z).toBeCloseTo(-1.6, 12);
    const facing = new Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(facing.z).toBeCloseTo(1, 6);
    expect(facing.y).toBeCloseTo(0, 6);
  });
});

describe('easingShare', () => {
  it('covers nothing in no time and about two thirds in one time constant', () => {
    expect(easingShare(0)).toBe(0);
    expect(easingShare(TAG_ALONG_SECONDS)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(easingShare(10)).toBeCloseTo(1, 6);
  });
});

describe('createTagAlong', () => {
  it('jumps to its target first, then drifts after it', () => {
    const tag = createTagAlong();
    const panel = new Object3D();
    const eye = { x: 0, y: 1.6, z: 0 };
    tag.follow(panel, { x: 0, y: 1.4, z: -1.2 }, eye, 0.016);
    expect(panel.position.z).toBeCloseTo(-1.2, 12);
    tag.follow(panel, { x: 1.2, y: 1.4, z: 0 }, eye, TAG_ALONG_SECONDS);
    expect(panel.position.x).toBeCloseTo(1.2 * easingShare(TAG_ALONG_SECONDS), 12);
    tag.reset();
    tag.follow(panel, { x: 1.2, y: 1.4, z: 0 }, eye, 0.016);
    expect(panel.position.x).toBeCloseTo(1.2, 12);
  });
});
