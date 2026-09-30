import { describe, expect, it } from 'bun:test';
import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { pointHandPose } from 'iwer/lib/device/configs/hand/point.js';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import { poseFromQuaternion, toReference } from '../room/pose-matrix';
import type { Vector3Like } from '../xr/ray';
import {
  backOfHandNormal,
  CURLED_RATIO,
  EXTENDED_RATIO,
  fingerExtension,
  fingerRay,
  HAND_JOINTS,
  type Handedness,
  type HandJointName,
  type HandJoints,
  isPressingWristButton,
  jointsFromPoses,
  nextPinch,
  nextPointPose,
  nextWristRaised,
  PINCH_OFF_METRES,
  PINCH_ON_METRES,
  pinchDistance,
  pinchPoint,
  WRIST_BUTTON_LIFT_METRES,
  WRIST_BUTTON_REACH_METRES,
  wristButtonPosition,
} from './hand-pose';

/**
 * The hands Meta's emulator poses — relaxed, pointing and pinching — as joint positions in the
 * hand's target-ray space. The emulator's poses are of the left hand; it mirrors x for the right.
 */
interface EmulatedPose {
  jointTransforms: Record<string, { offsetMatrix: ArrayLike<number> }>;
}

function isJointName(name: string): name is HandJointName {
  return HAND_JOINTS.some((joint) => joint === name);
}

function emulated(pose: EmulatedPose, handedness: Handedness = 'left'): HandJoints {
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
function held(
  joints: HandJoints,
  position: Vector3Like,
  orientation: { x: number; y: number; z: number; w: number },
): HandJoints {
  const pose = poseFromQuaternion(position, orientation);
  const moved: Partial<Record<HandJointName, Vector3Like>> = {};
  for (const name of HAND_JOINTS) {
    const joint = joints[name];
    if (joint !== undefined) moved[name] = toReference(pose, joint.x, joint.y, joint.z);
  }
  return moved;
}

/** A turn of `degrees` about the unit axis `axis`. */
function turn(axis: Vector3Like, degrees: number) {
  const half = (degrees * Math.PI) / 360;
  return { x: axis.x * Math.sin(half), y: axis.y * Math.sin(half), z: axis.z * Math.sin(half), w: Math.cos(half) };
}

const RELAXED = emulated(relaxedHandPose);
const POINTING = emulated(pointHandPose);
const PINCHING = emulated(pinchHandPose);

/** The joints with the thumb tip moved to `distance` from the index tip, along x. */
function thumbAt(distance: number): HandJoints {
  const index = RELAXED['index-finger-tip'];
  if (index === undefined) throw new Error('The emulated hand has no index tip.');
  return { ...RELAXED, 'thumb-tip': { x: index.x + distance, y: index.y, z: index.z } };
}

describe('jointsFromPoses', () => {
  it('reads each joint from the translation of its matrix, in WebXR order', () => {
    const poses = new Float32Array(HAND_JOINTS.length * 16);
    HAND_JOINTS.forEach((_, index) => {
      poses.set([index, index + 0.5, -index], index * 16 + 12);
    });
    const joints = jointsFromPoses(poses);
    expect(joints.wrist).toEqual({ x: 0, y: 0.5, z: -0 });
    expect(joints['index-finger-tip']).toEqual({ x: 9, y: 9.5, z: -9 });
    expect(joints['pinky-finger-tip']).toEqual({ x: 24, y: 24.5, z: -24 });
  });

  it('leaves out the joints a short array has no room for', () => {
    const joints = jointsFromPoses(new Float32Array(16 * 2));
    expect(Object.keys(joints)).toEqual(['wrist', 'thumb-metacarpal']);
  });
});

describe('pinching', () => {
  it("reads the emulator's pinch as a pinch and its relaxed and pointing hands as none", () => {
    expect(nextPinch(false, PINCHING)).toBe(true);
    expect(nextPinch(false, RELAXED)).toBe(false);
    expect(nextPinch(false, POINTING)).toBe(false);
  });

  it(`starts under ${PINCH_ON_METRES * 100} cm and ends only past ${PINCH_OFF_METRES * 100} cm`, () => {
    expect(nextPinch(false, thumbAt(PINCH_ON_METRES + 0.002))).toBe(false);
    expect(nextPinch(false, thumbAt(PINCH_ON_METRES - 0.002))).toBe(true);
    expect(nextPinch(true, thumbAt(PINCH_OFF_METRES - 0.002))).toBe(true);
    expect(nextPinch(true, thumbAt(PINCH_OFF_METRES + 0.002))).toBe(false);
  });

  it('lets go when the hand is not tracked', () => {
    expect(nextPinch(true, {})).toBe(false);
    expect(pinchDistance({})).toBeUndefined();
    expect(pinchPoint({})).toBeUndefined();
  });

  it('holds what it pinches halfway between the thumb and index tips', () => {
    const joints: HandJoints = {
      'thumb-tip': { x: 0, y: 1, z: 0 },
      'index-finger-tip': { x: 0.02, y: 1.02, z: -0.04 },
    };
    expect(pinchPoint(joints)).toEqual({ x: 0.01, y: 1.01, z: -0.02 });
    expect(pinchDistance(joints)).toBeCloseTo(Math.hypot(0.02, 0.02, 0.04), 9);
  });
});

describe('pointing', () => {
  it("reads the emulator's point as pointing, and its relaxed and pinching hands as not", () => {
    expect(nextPointPose(false, POINTING)).toBe(true);
    expect(nextPointPose(false, RELAXED)).toBe(false);
    expect(nextPointPose(false, PINCHING)).toBe(false);
    expect(nextPointPose(false, emulated(pointHandPose, 'right'))).toBe(true);
  });

  it('measures a straight finger near 1.9 and a curled one under 0.9', () => {
    expect(fingerExtension(POINTING, 'index')).toBeGreaterThan(EXTENDED_RATIO);
    for (const finger of ['middle', 'ring', 'pinky'] as const) {
      expect(fingerExtension(POINTING, finger)).toBeLessThan(CURLED_RATIO);
      expect(fingerExtension(RELAXED, finger)).toBeGreaterThan(EXTENDED_RATIO);
    }
    expect(fingerExtension({}, 'index')).toBeUndefined();
  });

  it('keeps a point it holds while the index bends a little, and not one it does not', () => {
    const wrist = POINTING.wrist;
    const tip = POINTING['index-finger-tip'];
    if (wrist === undefined || tip === undefined) throw new Error('The emulated hand has no index.');
    // The tip drawn towards the wrist until the finger reads just under the straight threshold.
    const target = EXTENDED_RATIO - 0.08;
    const now = fingerExtension(POINTING, 'index') ?? 1;
    const share = target / now;
    const bent: HandJoints = {
      ...POINTING,
      'index-finger-tip': {
        x: wrist.x + (tip.x - wrist.x) * share,
        y: wrist.y + (tip.y - wrist.y) * share,
        z: wrist.z + (tip.z - wrist.z) * share,
      },
    };
    expect(fingerExtension(bent, 'index')).toBeCloseTo(target, 5);
    expect(nextPointPose(false, bent)).toBe(false);
    expect(nextPointPose(true, bent)).toBe(true);
  });

  it('casts the finger ray from the tip, along the finger, forward out of the hand', () => {
    const ray = fingerRay(POINTING);
    if (ray === undefined) throw new Error('No finger ray.');
    expect(ray.origin).toEqual(POINTING['index-finger-tip'] ?? { x: 0, y: 0, z: 0 });
    expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1, 9);
    // The emulator's hands point down their own −z, as a target ray does.
    expect(ray.direction.z).toBeLessThan(-0.5);
    expect(fingerRay({})).toBeUndefined();
  });
});

describe('the back of the hand', () => {
  it("faces up out of either of the emulator's relaxed hands, held palm down", () => {
    expect(backOfHandNormal(RELAXED, 'left')?.y).toBeGreaterThan(0.9);
    expect(backOfHandNormal(emulated(relaxedHandPose, 'right'), 'right')?.y).toBeGreaterThan(0.9);
  });

  it('turns with the hand', () => {
    // Rolled palm up, a left hand's back faces the floor.
    const palmUp = held(RELAXED, { x: 0, y: 1, z: -0.3 }, turn({ x: 0, y: 0, z: 1 }, 180));
    expect(backOfHandNormal(palmUp, 'left')?.y).toBeLessThan(-0.9);
  });
});

describe('the wrist raised to look at', () => {
  const EYES = { x: 0, y: 1.6, z: 0 };
  const WRIST_AT = { x: 0, y: 1.3, z: -0.35 };

  /** The relaxed left hand, its target ray at WRIST_AT, tilted back by `degrees` about x. */
  function tilted(degrees: number): HandJoints {
    return held(RELAXED, WRIST_AT, turn({ x: 1, y: 0, z: 0 }, degrees));
  }

  /** How far the back of the hand is turned from the eyes, in degrees. */
  function facingDegrees(joints: HandJoints): number {
    const wrist = joints.wrist;
    const back = backOfHandNormal(joints, 'left');
    if (wrist === undefined || back === undefined) throw new Error('No wrist.');
    const toEyes = { x: EYES.x - wrist.x, y: EYES.y - wrist.y, z: EYES.z - wrist.z };
    const length = Math.hypot(toEyes.x, toEyes.y, toEyes.z);
    const cosine = (back.x * toEyes.x + back.y * toEyes.y + back.z * toEyes.z) / length;
    return (Math.acos(cosine) * 180) / Math.PI;
  }

  /** The tilt, found by search, at which the back of the hand is `degrees` from the eyes. */
  function tiltFacing(degrees: number): HandJoints {
    let best = tilted(0);
    let bestError = Number.POSITIVE_INFINITY;
    for (let tilt = -90; tilt <= 90; tilt += 0.25) {
      const joints = tilted(tilt);
      const error = Math.abs(facingDegrees(joints) - degrees);
      if (error < bestError) {
        best = joints;
        bestError = error;
      }
    }
    return best;
  }

  it('counts a wrist whose back faces the eyes', () => {
    const facing = tiltFacing(10);
    expect(nextWristRaised(false, facing, 'left', EYES)).toBe(true);
  });

  it('holds between 40° and 55°, and lets go past 55°', () => {
    const between = tiltFacing(47);
    expect(nextWristRaised(false, between, 'left', EYES)).toBe(false);
    expect(nextWristRaised(true, between, 'left', EYES)).toBe(true);
    expect(nextWristRaised(true, tiltFacing(60), 'left', EYES)).toBe(false);
  });

  it('never counts a palm turned up, which is where the system menu pinch lives', () => {
    const palmUp = held(RELAXED, WRIST_AT, turn({ x: 0, y: 0, z: 1 }, 180));
    expect(nextWristRaised(false, palmUp, 'left', EYES)).toBe(false);
  });

  it('never counts a wrist at the face or at arm stretched out', () => {
    const atFace = held(RELAXED, { x: 0, y: 1.55, z: -0.05 }, turn({ x: 1, y: 0, z: 0 }, 80));
    expect(nextWristRaised(false, atFace, 'left', EYES)).toBe(false);
    const faraway = held(RELAXED, { x: 0, y: 1.0, z: -0.8 }, turn({ x: 1, y: 0, z: 0 }, 30));
    expect(nextWristRaised(false, faraway, 'left', EYES)).toBe(false);
    expect(nextWristRaised(true, {}, 'left', EYES)).toBe(false);
  });

  it('stands the button out of the back of the wrist, and presses it with the other index tip', () => {
    const facing = tiltFacing(10);
    const button = wristButtonPosition(facing, 'left');
    const wrist = facing.wrist;
    const back = backOfHandNormal(facing, 'left');
    if (button === undefined || wrist === undefined || back === undefined) throw new Error('No button.');
    expect(button.x).toBeCloseTo(wrist.x + back.x * WRIST_BUTTON_LIFT_METRES, 9);
    expect(button.y).toBeCloseTo(wrist.y + back.y * WRIST_BUTTON_LIFT_METRES, 9);
    expect(button.z).toBeCloseTo(wrist.z + back.z * WRIST_BUTTON_LIFT_METRES, 9);
    const near = { x: button.x + WRIST_BUTTON_REACH_METRES * 0.8, y: button.y, z: button.z };
    const far = { x: button.x + WRIST_BUTTON_REACH_METRES * 1.2, y: button.y, z: button.z };
    expect(isPressingWristButton(button, near)).toBe(true);
    expect(isPressingWristButton(button, far)).toBe(false);
    expect(isPressingWristButton(button, undefined)).toBe(false);
    expect(wristButtonPosition({}, 'left')).toBeUndefined();
  });
});
