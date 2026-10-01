import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { pointHandPose } from 'iwer/lib/device/configs/hand/point.js';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import { poseFromQuaternion, toReference } from '../room/pose-matrix';
import type { QuaternionLike, Vector3Like } from '../xr/ray';
import { HAND_JOINTS, type Handedness, type HandJointName, type HandJoints } from './hand-pose';

/**
 * The hands Meta's emulator poses — relaxed, pointing and pinching — as joint positions, for the
 * specs: the same poses the browser tests' emulated hands take, so a threshold the specs pass is one
 * the browser tests will too. Test-only; nothing the app builds imports this.
 *
 * The emulator's poses are of the left hand in its target-ray space; it mirrors x for the right.
 */

interface EmulatedPose {
  jointTransforms: Record<string, { offsetMatrix: ArrayLike<number> }>;
}

function isJointName(name: string): name is HandJointName {
  return HAND_JOINTS.some((joint) => joint === name);
}

/** One of the emulator's poses as joints in its hand's target-ray space. */
export function emulated(pose: EmulatedPose, handedness: Handedness = 'left'): HandJoints {
  const mirror = handedness === 'left' ? 1 : -1;
  const joints: Partial<Record<HandJointName, Vector3Like>> = {};
  for (const [name, transform] of Object.entries(pose.jointTransforms)) {
    if (!isJointName(name)) continue;
    const matrix = transform.offsetMatrix;
    joints[name] = { x: mirror * matrix[12], y: matrix[13], z: matrix[14] };
  }
  return joints;
}

/** `joints` carried by the pose of a hand at `position`, turned by `orientation`. */
export function held(joints: HandJoints, position: Vector3Like, orientation: QuaternionLike): HandJoints {
  const pose = poseFromQuaternion(position, orientation);
  const moved: Partial<Record<HandJointName, Vector3Like>> = {};
  for (const name of HAND_JOINTS) {
    const joint = joints[name];
    if (joint !== undefined) moved[name] = toReference(pose, joint.x, joint.y, joint.z);
  }
  return moved;
}

/** A turn of `degrees` about the unit axis `axis`. */
export function turn(axis: Vector3Like, degrees: number): QuaternionLike {
  const half = (degrees * Math.PI) / 360;
  return { x: axis.x * Math.sin(half), y: axis.y * Math.sin(half), z: axis.z * Math.sin(half), w: Math.cos(half) };
}

export const RELAXED_POSE = relaxedHandPose;
export const POINT_POSE = pointHandPose;
export const PINCH_POSE = pinchHandPose;
