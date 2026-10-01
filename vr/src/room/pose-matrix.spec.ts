import { describe, expect, it } from 'bun:test';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { axisOf, poseFromQuaternion, toLocal, toReference } from './pose-matrix';

const position = { x: 0.4, y: 1.2, z: -2.5 };
const orientation = new Quaternion().setFromEuler(new Euler(0.3, -1.1, 0.7, 'YXZ'));
const pose = poseFromQuaternion(position, orientation);

describe('pose matrices', () => {
  it('lays a position and an orientation out as three.js does, column by column', () => {
    const expected = new Matrix4().compose(
      new Vector3(position.x, position.y, position.z),
      orientation,
      new Vector3(1, 1, 1),
    );
    expected.elements.forEach((value, index) => {
      expect(pose[index]).toBeCloseTo(value, 6);
    });
  });

  it('carries a point into the reference space and back', () => {
    const point = toReference(pose, 0.25, -0.5, 1.5);
    const expected = new Vector3(0.25, -0.5, 1.5)
      .applyQuaternion(orientation)
      .add(new Vector3(position.x, position.y, position.z));
    expect(point.x).toBeCloseTo(expected.x, 6);
    expect(point.y).toBeCloseTo(expected.y, 6);
    expect(point.z).toBeCloseTo(expected.z, 6);
    const back = toLocal(pose, point);
    expect(back.x).toBeCloseTo(0.25, 5);
    expect(back.y).toBeCloseTo(-0.5, 5);
    expect(back.z).toBeCloseTo(1.5, 5);
  });

  it('reads an axis of the posed space', () => {
    const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
    const axis = axisOf(pose, 1);
    expect(axis.x).toBeCloseTo(up.x, 6);
    expect(axis.y).toBeCloseTo(up.y, 6);
    expect(axis.z).toBeCloseTo(up.z, 6);
  });
});
