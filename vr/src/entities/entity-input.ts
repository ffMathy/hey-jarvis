import type { InputSnapshot } from '../xr/input-snapshots';
import type { Vector3Like } from '../xr/ray';
import type { Grabber } from './grab';
import {
  fingerRay,
  type Handedness,
  isPressingWristButton,
  nextPinch,
  nextPointPose,
  nextWristRaised,
  pinchPoint,
  wristButtonPosition,
} from './hand-pose';
import type { PointerSource } from './pointing';

/**
 * What the hands and controllers are doing, as placing things, pointing and the wrist button read
 * it — from one frame's input snapshots (`xr/input-snapshots.ts`) and what each hand was doing in
 * the frame before.
 *
 * A hand is a pinch (its hold and its select alike), a finger that may be pointing, and a wrist that
 * may be raised to look at; each is judged with hysteresis (`hand-pose.ts`), so each needs the last
 * frame's answer. A controller is its grip (hold), its trigger (select) and its laser. A hand's
 * pointing ray is its index finger, and only in a point pose — its system ray is there whether it
 * points or rests — while grabbing from afar uses the system ray, which Quest users already aim with.
 *
 * Pure: the snapshots and the last readings in, what each part reads out.
 */

/** What one hand is doing this frame. */
export interface HandReading {
  pinching: boolean;
  pointing: boolean;
  wristRaised: boolean;
}

/** Every tracked hand's reading, by its input id (`left-hand`, `right-hand`). */
export type HandReadings = ReadonlyMap<string, HandReading>;

export const NO_HANDS: HandReadings = new Map();

function handednessOf(input: InputSnapshot): Handedness | undefined {
  return input.handedness === 'left' || input.handedness === 'right' ? input.handedness : undefined;
}

/**
 * Each tracked hand's pinch, point and raised wrist this frame, each judged against the hand's last
 * frame. A hand whose joints are not tracked is left out, and so starts afresh when they are again:
 * a hand lost to tracking lets go.
 */
export function readHands(
  previous: HandReadings,
  inputs: readonly InputSnapshot[],
  eyes: Vector3Like,
): Map<string, HandReading> {
  const hands = new Map<string, HandReading>();
  for (const input of inputs) {
    if (input.kind !== 'hand' || input.joints === undefined) continue;
    const was = previous.get(input.id);
    const handedness = handednessOf(input);
    hands.set(input.id, {
      pinching: nextPinch(was?.pinching ?? false, input.joints),
      pointing: nextPointPose(was?.pointing ?? false, input.joints),
      wristRaised:
        handedness !== undefined && nextWristRaised(was?.wristRaised ?? false, input.joints, handedness, eyes),
    });
  }
  return hands;
}

/**
 * Each hand and controller as the grab reads it. A hand holds and selects with the same pinch, at
 * the point between its thumb and index tips; a controller holds with the grip and selects with the
 * trigger, and pushes a token riding its laser out or in with the thumbstick.
 */
export function grabbersFrom(inputs: readonly InputSnapshot[], hands: HandReadings): Grabber[] {
  const grabbers: Grabber[] = [];
  for (const input of inputs) {
    if (input.kind === 'controller') {
      const buttons = input.buttons;
      grabbers.push({
        id: input.id,
        kind: 'controller',
        grip: input.grip,
        holding: buttons?.squeeze ?? false,
        selecting: buttons?.trigger ?? false,
        ray: input.targetRay,
        hitDistance: input.hitDistance,
        reach: buttons?.thumbstickForward ?? 0,
      });
      continue;
    }
    const reading = hands.get(input.id);
    // A hand whose joints are lost this frame holds nothing and points nowhere, so what it carried
    // is put back where it was rather than dropped wherever the hand was last seen.
    if (input.joints === undefined || reading === undefined) {
      grabbers.push({ id: input.id, kind: 'hand', holding: false, selecting: false });
      continue;
    }
    grabbers.push({
      id: input.id,
      kind: 'hand',
      grip: pinchPoint(input.joints),
      holding: reading.pinching,
      selecting: reading.pinching,
      ray: input.targetRay,
      hitDistance: input.hitDistance,
    });
  }
  return grabbers;
}

/**
 * The rays sir points along this frame: every controller's laser — with how far along it the room
 * is, so a thing behind the wall it points at is passed over — and each hand's index finger while it
 * is in a point pose. A finger's ray has no depth hit: the hit test follows the hand's system ray,
 * which goes elsewhere.
 */
export function pointersFrom(inputs: readonly InputSnapshot[], hands: HandReadings): PointerSource[] {
  const pointers: PointerSource[] = [];
  for (const input of inputs) {
    if (input.kind === 'controller') {
      if (input.targetRay === undefined) continue;
      pointers.push(
        input.hitDistance === undefined
          ? { id: input.id, kind: 'controller', ray: input.targetRay }
          : { id: input.id, kind: 'controller', ray: input.targetRay, hitDistance: input.hitDistance },
      );
      continue;
    }
    if (input.joints === undefined || hands.get(input.id)?.pointing !== true) continue;
    const ray = fingerRay(input.joints);
    if (ray !== undefined) pointers.push({ id: input.id, kind: 'hand', ray });
  }
  return pointers;
}

/** Where the wrist button stands this frame, and whether a finger is on it. */
export interface WristButtonReading {
  /** Off the back of a raised wrist, or undefined while no wrist is raised. */
  position?: Vector3Like;
  /** Whether the other hand's index tip is on it. */
  touched: boolean;
}

/**
 * The wrist button: off the back of whichever wrist is raised — the left first, where a watch is
 * worn — and touched when the other hand's index tip is on it.
 */
export function wristButtonFrom(inputs: readonly InputSnapshot[], hands: HandReadings): WristButtonReading {
  const tracked = inputs.filter((input) => input.kind === 'hand' && input.joints !== undefined);
  const byHand = [
    ...tracked.filter((input) => input.handedness === 'left'),
    ...tracked.filter((input) => input.handedness !== 'left'),
  ];
  for (const input of byHand) {
    const handedness = handednessOf(input);
    if (input.joints === undefined || handedness === undefined || hands.get(input.id)?.wristRaised !== true) continue;
    const position = wristButtonPosition(input.joints, handedness);
    if (position === undefined) continue;
    const other = tracked.find((candidate) => candidate !== input);
    return { position, touched: isPressingWristButton(position, other?.joints?.['index-finger-tip']) };
  }
  return { touched: false };
}

/** Every tracked hand's index tip, for pressing the drawer's buttons with a finger. */
export function indexTipsFrom(inputs: readonly InputSnapshot[]): { id: string; tip: Vector3Like }[] {
  const tips: { id: string; tip: Vector3Like }[] = [];
  for (const input of inputs) {
    const tip = input.joints?.['index-finger-tip'];
    if (input.kind === 'hand' && tip !== undefined) tips.push({ id: input.id, tip });
  }
  return tips;
}
