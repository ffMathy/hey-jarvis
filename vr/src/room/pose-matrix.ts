import type { Vector3Like } from './types';

/**
 * Reading the 4×4 poses WebXR hands out.
 *
 * `XRRigidTransform.matrix` is column-major: columns 0–2 are the space's x, y and z axes in
 * the reference space, column 3 its origin. The poses are rigid — a rotation and a
 * translation, never a scale — which is what lets `toLocal` invert one with a transpose.
 */

/** `point`, given in the posed space, in the reference space. */
export function toReference(pose: Float32Array, x: number, y: number, z: number): Vector3Like {
  return {
    x: pose[0] * x + pose[4] * y + pose[8] * z + pose[12],
    y: pose[1] * x + pose[5] * y + pose[9] * z + pose[13],
    z: pose[2] * x + pose[6] * y + pose[10] * z + pose[14],
  };
}

/** `point`, given in the reference space, in the posed space. */
export function toLocal(pose: Float32Array, point: Vector3Like): Vector3Like {
  const x = point.x - pose[12];
  const y = point.y - pose[13];
  const z = point.z - pose[14];
  return {
    x: pose[0] * x + pose[1] * y + pose[2] * z,
    y: pose[4] * x + pose[5] * y + pose[6] * z,
    z: pose[8] * x + pose[9] * y + pose[10] * z,
  };
}

/** The posed space's `column`th axis (0 = x, 1 = y, 2 = z) in the reference space. */
export function axisOf(pose: Float32Array, column: 0 | 1 | 2): Vector3Like {
  const offset = column * 4;
  return { x: pose[offset], y: pose[offset + 1], z: pose[offset + 2] };
}

/** The pose of a space whose origin is `origin` and whose axes are `xAxis`, `yAxis` and `zAxis`. */
export function poseFromAxes(
  origin: Vector3Like,
  xAxis: Vector3Like,
  yAxis: Vector3Like,
  zAxis: Vector3Like,
): Float32Array {
  const pose = new Float32Array(16);
  pose.set([xAxis.x, xAxis.y, xAxis.z, 0], 0);
  pose.set([yAxis.x, yAxis.y, yAxis.z, 0], 4);
  pose.set([zAxis.x, zAxis.y, zAxis.z, 0], 8);
  pose.set([origin.x, origin.y, origin.z, 1], 12);
  return pose;
}

/** The pose of a space at `position`, turned by the unit quaternion `orientation`. */
export function poseFromQuaternion(
  position: Vector3Like,
  orientation: { x: number; y: number; z: number; w: number },
): Float32Array {
  const { x, y, z, w } = orientation;
  return poseFromAxes(
    position,
    { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) },
    { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) },
    { x: 2 * (x * z + y * w), y: 2 * (y * z - x * w), z: 1 - 2 * (x * x + y * y) },
  );
}
