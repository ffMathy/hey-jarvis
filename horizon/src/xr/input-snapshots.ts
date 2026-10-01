import { HAND_JOINTS, type HandJoints, jointsFromPoses } from '../entities/hand-pose';
import {
  type GamepadLike,
  isButtonDown,
  SQUEEZE_BUTTON_INDEX,
  THUMBSTICK_FORWARD_AXIS_INDEX,
  TRIGGER_BUTTON_INDEX,
} from './gamepad-buttons';
import { distanceBetween, type Ray, rayFromPose, type Vector3Like } from './ray';

/**
 * What every hand and controller is doing in one frame: where it points, where it holds things, its
 * joints or its buttons, and how far along its ray the real room is.
 *
 * The room's selects (`xr-input.ts`) are events, and say nothing between a press and its release;
 * placing things in the room needs the whole of it, every frame — a pinch being held and carried, a
 * finger pointing, the grip squeezed, the thumbstick pushed. So each frame this reads, per input
 * source:
 *
 * - its target ray (a controller's laser, or a hand's system ray) and its grip;
 * - a hand's 25 joints, with `XRFrame.fillPoses` in one call where the browser has it and one
 *   `getJointPose` per joint where it does not — and nothing at all for a frame some joint is not
 *   tracked in, since `fillPoses` then leaves every pose untrustworthy;
 * - a controller's trigger, grip and thumbstick;
 * - how far along its target ray a hit test finds a real surface: one hit-test source per input
 *   source, made when the source appears and cancelled when it goes (`depth-probes.ts` does the same
 *   from the head). On a Quest 3 that is the depth sensor, so a lamp can be dropped on by pointing
 *   at it, and something behind a wall is not taken for what is pointed at.
 *
 * Each source is keyed by its hand and kind — `left-hand`, `right-controller` — which stays the same
 * when a controller is put down and picked up again, unlike the `XRInputSource` object.
 */

declare global {
  interface XRFrame {
    /**
     * Every space's pose in `baseSpace`, as 16-float column-major matrices one after another, in
     * one call (WebXR Hand Input). Missing from `@types/webxr`, and from some browsers, so optional.
     */
    fillPoses?: (spaces: Iterable<XRSpace>, baseSpace: XRSpace, transforms: Float32Array) => boolean;
  }
}

export type InputKind = 'hand' | 'controller';

/** What a controller's buttons and thumbstick are doing this frame. */
export interface ControllerButtons {
  trigger: boolean;
  /** The grip. */
  squeeze: boolean;
  /** The thumbstick pushed forward (up to 1) or pulled back (down to −1); 0 inside the dead zone. */
  thumbstickForward: number;
}

/** One hand or controller in one frame. Anything the frame had no pose for is left out. */
export interface InputSnapshot {
  /** Its hand and kind, `left-hand` or `right-controller`: the same every frame it is there. */
  id: string;
  kind: InputKind;
  handedness: XRHandedness;
  /** A controller's laser, or a hand's system ray. */
  targetRay?: Ray;
  /** Where a controller is held. */
  grip?: Vector3Like;
  /** A hand's joints, when every one of them is tracked. */
  joints?: HandJoints;
  /** A controller's buttons. */
  buttons?: ControllerButtons;
  /** How far along `targetRay` the first real surface is, when a hit test says. */
  hitDistance?: number;
}

/**
 * How far off the middle the thumbstick has to be before it counts. A Touch controller's stick
 * rests a few hundredths off centre, and a token riding a ray would otherwise creep.
 */
export const THUMBSTICK_DEAD_ZONE = 0.2;

/** The key a source is known by: its hand and whether it is a hand or a controller. */
export function inputIdOf(handedness: XRHandedness, kind: InputKind): string {
  return `${handedness}-${kind}`;
}

/** A controller's buttons and thumbstick, from its `xr-standard` gamepad. */
export function controllerButtonsOf(gamepad: GamepadLike | null | undefined): ControllerButtons {
  const axis = gamepad?.axes?.[THUMBSTICK_FORWARD_AXIS_INDEX];
  // Forward is negative on a gamepad's y axis, as on every other gamepad.
  const forward = typeof axis === 'number' && Number.isFinite(axis) ? -axis : 0;
  return {
    trigger: isButtonDown(gamepad, TRIGGER_BUTTON_INDEX),
    squeeze: isButtonDown(gamepad, SQUEEZE_BUTTON_INDEX),
    thumbstickForward: Math.abs(forward) < THUMBSTICK_DEAD_ZONE ? 0 : Math.max(-1, Math.min(1, forward)),
  };
}

/** How far along `ray` the point `hit` is, or undefined for a hit behind where the ray starts. */
export function hitDistanceAlong(ray: Ray, hit: Vector3Like): number | undefined {
  const along =
    (hit.x - ray.origin.x) * ray.direction.x +
    (hit.y - ray.origin.y) * ray.direction.y +
    (hit.z - ray.origin.z) * ray.direction.z;
  return along > 0 ? distanceBetween(ray.origin, hit) : undefined;
}

export interface InputSnapshots {
  /** Every tracked hand and controller in `frame`, in `space`. Call from the frame callback. */
  read(frame: XRFrame, space: XRReferenceSpace): InputSnapshot[];
  dispose(): void;
}

function positionIn(frame: XRFrame, space: XRSpace, baseSpace: XRReferenceSpace): Vector3Like | undefined {
  const pose = frame.getPose(space, baseSpace);
  if (pose === undefined) return undefined;
  const { x, y, z } = pose.transform.position;
  return { x, y, z };
}

/** The snapshots for `session`'s input sources. */
export function createInputSnapshots(session: XRSession): InputSnapshots {
  const hitTests = new Map<XRInputSource, XRHitTestSource>();
  const asked = new Set<XRInputSource>();
  const jointSpaces = new Map<XRHand, XRJointSpace[] | undefined>();
  const poses = new Float32Array(HAND_JOINTS.length * 16);
  const canHitTest = session.enabledFeatures?.includes('hit-test') === true;
  let disposed = false;

  /** Asks for a hit-test source along `source`'s ray; nothing depends on getting one. */
  function watch(source: XRInputSource) {
    if (!canHitTest || asked.has(source)) return;
    asked.add(source);
    let request: Promise<XRHitTestSource> | undefined;
    try {
      request = session.requestHitTestSource?.({ space: source.targetRaySpace });
    } catch {
      return;
    }
    request?.then(
      (hitTest) => {
        // Gone, or the room closed, while the source was being made.
        if (disposed || !asked.has(source)) hitTest.cancel();
        else hitTests.set(source, hitTest);
      },
      () => undefined,
    );
  }

  function forget(source: XRInputSource) {
    asked.delete(source);
    hitTests.get(source)?.cancel();
    hitTests.delete(source);
    if (source.hand !== undefined) jointSpaces.delete(source.hand);
  }

  const onSourcesChange = (event: XRInputSourcesChangeEvent) => {
    for (const source of event.removed) forget(source);
    for (const source of event.added) watch(source);
  };
  session.addEventListener('inputsourceschange', onSourcesChange);
  for (const source of session.inputSources) watch(source);

  /** The hand's joint spaces in `HAND_JOINTS` order, the order `jointsFromPoses` reads. */
  function spacesOf(hand: XRHand): XRJointSpace[] | undefined {
    if (jointSpaces.has(hand)) return jointSpaces.get(hand);
    const spaces: XRJointSpace[] = [];
    for (const name of HAND_JOINTS) {
      const space = hand.get(name);
      if (space === undefined) break;
      spaces.push(space);
    }
    const complete = spaces.length === HAND_JOINTS.length ? spaces : undefined;
    jointSpaces.set(hand, complete);
    return complete;
  }

  function jointsOf(frame: XRFrame, hand: XRHand, space: XRReferenceSpace): HandJoints | undefined {
    const spaces = spacesOf(hand);
    if (spaces === undefined) return undefined;
    if (frame.fillPoses !== undefined) {
      return frame.fillPoses(spaces, space, poses) ? jointsFromPoses(poses) : undefined;
    }
    if (frame.getJointPose === undefined) return undefined;
    for (const [index, joint] of spaces.entries()) {
      const pose = frame.getJointPose(joint, space);
      if (pose === undefined) return undefined;
      poses.set(pose.transform.matrix, index * 16);
    }
    return jointsFromPoses(poses);
  }

  function hitDistanceOf(frame: XRFrame, source: XRInputSource, space: XRReferenceSpace, ray: Ray | undefined) {
    const hitTest = hitTests.get(source);
    if (hitTest === undefined || ray === undefined) return undefined;
    try {
      const hit = frame.getHitTestResults(hitTest)[0]?.getPose(space);
      return hit === undefined ? undefined : hitDistanceAlong(ray, hit.transform.position);
    } catch {
      // A source made since this frame began has no results in it yet.
      return undefined;
    }
  }

  function snapshotOf(frame: XRFrame, source: XRInputSource, space: XRReferenceSpace): InputSnapshot {
    const kind: InputKind = source.hand === undefined ? 'controller' : 'hand';
    const rayPose = frame.getPose(source.targetRaySpace, space);
    const targetRay = rayPose && rayFromPose(rayPose.transform);
    return {
      id: inputIdOf(source.handedness, kind),
      kind,
      handedness: source.handedness,
      targetRay,
      grip: source.gripSpace && positionIn(frame, source.gripSpace, space),
      joints: source.hand && jointsOf(frame, source.hand, space),
      buttons: kind === 'controller' ? controllerButtonsOf(source.gamepad) : undefined,
      hitDistance: hitDistanceOf(frame, source, space, targetRay),
    };
  }

  return {
    read(frame, space) {
      const snapshots: InputSnapshot[] = [];
      for (const source of session.inputSources) {
        // Gaze and screen taps have no hand to hold anything with.
        if (source.targetRayMode === 'tracked-pointer') snapshots.push(snapshotOf(frame, source, space));
      }
      return snapshots;
    },
    dispose() {
      disposed = true;
      session.removeEventListener('inputsourceschange', onSourcesChange);
      for (const hitTest of hitTests.values()) hitTest.cancel();
      hitTests.clear();
      asked.clear();
    },
  };
}
