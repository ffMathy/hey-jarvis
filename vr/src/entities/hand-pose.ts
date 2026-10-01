import { distanceBetween, type Ray, type Vector3Like } from '../xr/ray';

/**
 * Reading a tracked hand's joints: a pinch, a pointing finger, and a wrist raised to look at.
 *
 * The room's `select` events are no good for grabbing: Quest fires `select` when a pinch is let go,
 * and says nothing in between. The joints are continuous, so a pinch is judged from how far the
 * thumb tip is from the index tip, with a gap between the distance that starts one and the distance
 * that ends it, so a pinch held at the edge does not flicker. And a hand's `targetRaySpace` is an
 * emulated system ray that is there whether the hand points or rests, so pointing is judged from the
 * fingers: the index straight, the other three curled.
 *
 * The thresholds come from Meta's emulator's own poses (`iwer`'s relaxed, point and pinch hands,
 * which the tests read): a straight finger's tip is 1.8–2.0 times as far from the wrist as its
 * knuckle, a curled one 0.7–0.9 times, and a pinch brings the tips to 2 mm from 9–11 cm.
 *
 * Pure functions of the joints' positions, in any one space: the reference space in the app.
 */

/** The hand's joints, in the order WebXR lists them — which is the order `XRFrame.fillPoses` fills. */
export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type HandJointName = (typeof HAND_JOINTS)[number];

/** Where each joint of one hand is; a joint not tracked in this frame is left out. */
export type HandJoints = Readonly<Partial<Record<HandJointName, Vector3Like>>>;

export type Handedness = 'left' | 'right';

export type Finger = 'index' | 'middle' | 'ring' | 'pinky';

/**
 * The joints' positions out of the 16-float column-major matrices `XRFrame.fillPoses` wrote, one per
 * joint in {@link HAND_JOINTS} order. `fillPoses` returns false when any joint is not tracked, and
 * then nothing it wrote is to be trusted, so the caller passes this only what came back true.
 */
export function jointsFromPoses(poses: Float32Array): HandJoints {
  const joints: Partial<Record<HandJointName, Vector3Like>> = {};
  HAND_JOINTS.forEach((name, index) => {
    const offset = index * 16;
    if (offset + 15 >= poses.length) return;
    joints[name] = { x: poses[offset + 12], y: poses[offset + 13], z: poses[offset + 14] };
  });
  return joints;
}

function subtract(from: Vector3Like, take: Vector3Like): Vector3Like {
  return { x: from.x - take.x, y: from.y - take.y, z: from.z - take.z };
}

function cross(first: Vector3Like, second: Vector3Like): Vector3Like {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function dot(first: Vector3Like, second: Vector3Like): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function normalised(vector: Vector3Like): Vector3Like | undefined {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length < 1e-9 ? undefined : { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/** A pinch starts once the thumb and index tips are this close. */
export const PINCH_ON_METRES = 0.015;

/** A pinch ends once they are this far apart again. */
export const PINCH_OFF_METRES = 0.03;

/** How far apart the thumb and index tips are, or undefined when either is not tracked. */
export function pinchDistance(joints: HandJoints): number | undefined {
  const thumb = joints['thumb-tip'];
  const index = joints['index-finger-tip'];
  return thumb === undefined || index === undefined ? undefined : distanceBetween(thumb, index);
}

/** Where a pinch holds something: halfway between the thumb and index tips. */
export function pinchPoint(joints: HandJoints): Vector3Like | undefined {
  const thumb = joints['thumb-tip'];
  const index = joints['index-finger-tip'];
  if (thumb === undefined || index === undefined) return undefined;
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2, z: (thumb.z + index.z) / 2 };
}

/** Whether the hand pinches now, given whether it did in the last frame. A hand not tracked lets go. */
export function nextPinch(wasPinching: boolean, joints: HandJoints): boolean {
  const distance = pinchDistance(joints);
  if (distance === undefined) return false;
  return wasPinching ? distance <= PINCH_OFF_METRES : distance <= PINCH_ON_METRES;
}

/**
 * How straight `finger` is: its tip's distance from the wrist over its knuckle's. About 1.9 straight,
 * 0.8 curled; undefined when a joint it needs is not tracked.
 */
export function fingerExtension(joints: HandJoints, finger: Finger): number | undefined {
  const wrist = joints.wrist;
  const tip = joints[`${finger}-finger-tip`];
  const knuckle = joints[`${finger}-finger-phalanx-proximal`];
  if (wrist === undefined || tip === undefined || knuckle === undefined) return undefined;
  const knuckleDistance = distanceBetween(knuckle, wrist);
  return knuckleDistance < 1e-6 ? undefined : distanceBetween(tip, wrist) / knuckleDistance;
}

/** A finger this straight counts as pointing. */
export const EXTENDED_RATIO = 1.55;

/** A finger this bent counts as curled. */
export const CURLED_RATIO = 1.25;

/** How far past each threshold a finger has to go back before a point pose already held ends. */
const POINT_HYSTERESIS = 0.15;

const CURLED_FINGERS: readonly Finger[] = ['middle', 'ring', 'pinky'];

/**
 * Whether the hand is pointing now, given whether it was in the last frame: the index straight and
 * the other three curled. Once held, the index may bend and the others open a little further before
 * it ends, so a point at the edge does not flicker.
 */
export function nextPointPose(wasPointing: boolean, joints: HandJoints): boolean {
  const slack = wasPointing ? POINT_HYSTERESIS : 0;
  const index = fingerExtension(joints, 'index');
  if (index === undefined || index < EXTENDED_RATIO - slack) return false;
  return CURLED_FINGERS.every((finger) => {
    const extension = fingerExtension(joints, finger);
    return extension !== undefined && extension <= CURLED_RATIO + slack;
  });
}

/**
 * The ray a pointing index finger casts: along the line from its knuckle through its tip, starting
 * at the tip. Only meaningful in a point pose — a resting hand's index points wherever it happens to
 * lie.
 */
export function fingerRay(joints: HandJoints): Ray | undefined {
  const knuckle = joints['index-finger-phalanx-proximal'];
  const tip = joints['index-finger-tip'];
  if (knuckle === undefined || tip === undefined) return undefined;
  const direction = normalised(subtract(tip, knuckle));
  return direction === undefined ? undefined : { origin: { ...tip }, direction };
}

/**
 * The direction the back of the hand faces, out of the knuckles and the wrist.
 *
 * The cross product of the index and little fingers' metacarpals, from the wrist, points out of the
 * palm of a right hand and out of the back of a left one — the hands are mirror images — so it is
 * turned round for the right.
 */
export function backOfHandNormal(joints: HandJoints, handedness: Handedness): Vector3Like | undefined {
  const wrist = joints.wrist;
  const index = joints['index-finger-metacarpal'];
  const little = joints['pinky-finger-metacarpal'];
  if (wrist === undefined || index === undefined || little === undefined) return undefined;
  const normal = normalised(cross(subtract(index, wrist), subtract(little, wrist)));
  if (normal === undefined) return undefined;
  return handedness === 'left' ? normal : { x: -normal.x, y: -normal.y, z: -normal.z };
}

/** How squarely the back of the wrist has to face the eyes for the wrist to count as raised. */
export const WRIST_FACING_ON_DEGREES = 40;

/** How far it may turn away again before a raised wrist is lowered. */
export const WRIST_FACING_OFF_DEGREES = 55;

/** How near the eyes a raised wrist is: closer is a hand at the face, farther an arm stretched out. */
export const WRIST_NEAREST_METRES = 0.15;
export const WRIST_FARTHEST_METRES = 0.7;

/**
 * Whether the wrist is raised to look at, like a watch, given whether it was in the last frame: the
 * back of the hand towards the eyes, within arm's length.
 *
 * The back and not the palm: Meta keeps a pinch with the palm up for itself on both hands — on the
 * left it is the menu button, and it takes the user out of the immersive session — so the wrist
 * button that opens placement lives where no palm-up gesture can reach it.
 */
export function nextWristRaised(
  wasRaised: boolean,
  joints: HandJoints,
  handedness: Handedness,
  eyes: Vector3Like,
): boolean {
  const wrist = joints.wrist;
  const back = backOfHandNormal(joints, handedness);
  if (wrist === undefined || back === undefined) return false;
  const toEyes = subtract(eyes, wrist);
  const distance = Math.hypot(toEyes.x, toEyes.y, toEyes.z);
  if (distance < WRIST_NEAREST_METRES || distance > WRIST_FARTHEST_METRES) return false;
  const degrees = wasRaised ? WRIST_FACING_OFF_DEGREES : WRIST_FACING_ON_DEGREES;
  return dot(back, toEyes) / distance >= Math.cos((degrees * Math.PI) / 180);
}

/** How far out of the back of the wrist the button stands, from the wrist joint: about 4 cm off the skin. */
export const WRIST_BUTTON_LIFT_METRES = 0.06;

/** How near the other hand's index tip has to come to the button to press it. */
export const WRIST_BUTTON_REACH_METRES = 0.02;

/** Where the wrist button is drawn and pressed, or undefined when the joints it needs are not tracked. */
export function wristButtonPosition(joints: HandJoints, handedness: Handedness): Vector3Like | undefined {
  const wrist = joints.wrist;
  const back = backOfHandNormal(joints, handedness);
  if (wrist === undefined || back === undefined) return undefined;
  return {
    x: wrist.x + back.x * WRIST_BUTTON_LIFT_METRES,
    y: wrist.y + back.y * WRIST_BUTTON_LIFT_METRES,
    z: wrist.z + back.z * WRIST_BUTTON_LIFT_METRES,
  };
}

/** Whether the other hand's index tip is on the button. */
export function isPressingWristButton(button: Vector3Like, otherIndexTip: Vector3Like | undefined): boolean {
  return otherIndexTip !== undefined && distanceBetween(button, otherIndexTip) <= WRIST_BUTTON_REACH_METRES;
}
