import { describe, expect, it } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { distanceBetween, rayFromPose, raySphereDistance, rotate } from './ray';

function quaternion(pitch: number, yaw: number, roll: number) {
  const { x, y, z, w } = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
  return { x, y, z, w };
}

describe('rotate', () => {
  it('agrees with three for any rotation', () => {
    for (const [pitch, yaw, roll] of [
      [0, 0, 0],
      [0.3, -1.2, 0.1],
      [-1.4, 2.8, -0.7],
    ] as const) {
      const rotation = quaternion(pitch, yaw, roll);
      const vector = { x: 0.3, y: -0.8, z: 1.7 };
      const expected = new Vector3(vector.x, vector.y, vector.z).applyQuaternion(
        new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      );
      const actual = rotate(vector, rotation);
      expect(actual.x).toBeCloseTo(expected.x, 12);
      expect(actual.y).toBeCloseTo(expected.y, 12);
      expect(actual.z).toBeCloseTo(expected.z, 12);
    }
  });
});

describe('rayFromPose', () => {
  it('points down the pose’s −Z from its position', () => {
    const ray = rayFromPose({ position: { x: 0.2, y: 1.1, z: -0.3 }, orientation: quaternion(0, Math.PI / 2, 0) });
    expect(ray.origin).toEqual({ x: 0.2, y: 1.1, z: -0.3 });
    // A quarter turn left points along −X.
    expect(ray.direction.x).toBeCloseTo(-1, 12);
    expect(ray.direction.z).toBeCloseTo(0, 12);
  });
});

describe('raySphereDistance', () => {
  const ahead = { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } };

  it('is the distance to the near side of a sphere straight ahead', () => {
    expect(raySphereDistance(ahead, { x: 0, y: 1.6, z: -2 }, 0.3)).toBeCloseTo(1.7, 12);
  });

  it('touches a sphere it only grazes', () => {
    expect(raySphereDistance(ahead, { x: 0.3, y: 1.6, z: -2 }, 0.3)).toBeCloseTo(2, 6);
  });

  it('misses a sphere off to the side', () => {
    expect(raySphereDistance(ahead, { x: 0.5, y: 1.6, z: -2 }, 0.3)).toBeUndefined();
  });

  it('misses a sphere behind', () => {
    expect(raySphereDistance(ahead, { x: 0, y: 1.6, z: 2 }, 0.3)).toBeUndefined();
  });

  it('is 0 from inside the sphere', () => {
    expect(raySphereDistance(ahead, { x: 0, y: 1.7, z: 0.1 }, 0.3)).toBe(0);
  });
});

describe('distanceBetween', () => {
  it('is the straight-line distance', () => {
    expect(distanceBetween({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 })).toBe(5);
  });
});
