import { describe, expect, it } from 'bun:test';
import type { InputSnapshot } from '../xr/input-snapshots';
import type { QuaternionLike } from '../xr/ray';
import { emulated, held, PINCH_POSE, POINT_POSE, RELAXED_POSE, turn } from './emulated-hands.fakes';
import { grabbersFrom, indexTipsFrom, NO_HANDS, pointersFrom, readHands, wristButtonFrom } from './entity-input';
import { type Handedness, type HandJoints, pinchPoint, wristButtonPosition } from './hand-pose';

const EYES = { x: 0, y: 1.6, z: 0 };
const AHEAD = { origin: { x: 0.2, y: 1.2, z: -0.3 }, direction: { x: 0, y: 0, z: -1 } };

/** A hand snapshot: one of the emulator's poses, held at `position` turned by `orientation`. */
function hand(
  handedness: Handedness,
  joints: HandJoints | undefined,
  extra: Partial<InputSnapshot> = {},
): InputSnapshot {
  const snapshot: InputSnapshot = { id: `${handedness}-hand`, kind: 'hand', handedness, targetRay: AHEAD, ...extra };
  if (joints !== undefined) snapshot.joints = joints;
  return snapshot;
}

function controller(
  handedness: Handedness,
  buttons: Partial<NonNullable<InputSnapshot['buttons']>> = {},
): InputSnapshot {
  return {
    id: `${handedness}-controller`,
    kind: 'controller',
    handedness,
    targetRay: AHEAD,
    grip: { x: 0.2, y: 1.2, z: -0.3 },
    buttons: { trigger: false, squeeze: false, thumbstickForward: 0, ...buttons },
    hitDistance: 2.5,
  };
}

/** Where the ordinary hands are held: reaching forward and a little down, as for the drawer. */
const REACH = { x: 0.2, y: 1.1, z: -0.45 };
const REACHING = turn({ x: 1, y: 0, z: 0 }, -25);
const relaxed = (handedness: Handedness) => held(emulated(RELAXED_POSE, handedness), REACH, REACHING);
const pinching = (handedness: Handedness) => held(emulated(PINCH_POSE, handedness), REACH, REACHING);
const pointing = (handedness: Handedness) => held(emulated(POINT_POSE, handedness), REACH, REACHING);

/** `second` after `first`, as one turn. */
function then(first: QuaternionLike, second: QuaternionLike): QuaternionLike {
  return {
    w: second.w * first.w - second.x * first.x - second.y * first.y - second.z * first.z,
    x: second.w * first.x + second.x * first.w + second.y * first.z - second.z * first.y,
    y: second.w * first.y - second.x * first.z + second.y * first.w + second.z * first.x,
    z: second.w * first.z + second.x * first.y - second.y * first.x + second.z * first.w,
  };
}

/** The left hand turned to read a watch: its fingers across the chest, the back of the wrist to the eyes. */
function wristRaised(): HandJoints {
  const watch = then(turn({ x: 0, y: 1, z: 0 }, -90), turn({ x: 1, y: 0, z: 0 }, 50));
  return held(emulated(RELAXED_POSE, 'left'), { x: 0, y: 1.3, z: -0.35 }, watch);
}

describe('readHands', () => {
  it('reads the emulator’s pinch, point and relaxed hands', () => {
    const hands = readHands(NO_HANDS, [hand('left', pinching('left')), hand('right', pointing('right'))], EYES);
    expect(hands.get('left-hand')).toEqual({ pinching: true, pointing: false, wristRaised: false });
    expect(hands.get('right-hand')?.pointing).toBe(true);
    expect(readHands(NO_HANDS, [hand('left', relaxed('left'))], EYES).get('left-hand')?.pinching).toBe(false);
  });

  it('leaves out a hand whose joints are not tracked, and ignores controllers', () => {
    const hands = readHands(NO_HANDS, [hand('left', undefined), controller('right')], EYES);
    expect(hands.size).toBe(0);
  });

  it('finds the raised wrist', () => {
    expect(readHands(NO_HANDS, [hand('left', wristRaised())], EYES).get('left-hand')?.wristRaised).toBe(true);
  });
});

describe('grabbersFrom', () => {
  it('holds and selects with a hand’s pinch, at the point between its tips, along its system ray', () => {
    const joints = pinching('right');
    const input = hand('right', joints, { hitDistance: 1.8 });
    const [grabber] = grabbersFrom([input], readHands(NO_HANDS, [input], EYES));
    expect(grabber).toEqual({
      id: 'right-hand',
      kind: 'hand',
      grip: pinchPoint(joints),
      holding: true,
      selecting: true,
      ray: AHEAD,
      hitDistance: 1.8,
    });
  });

  it('holds with a controller’s grip, selects with its trigger and reaches with its thumbstick', () => {
    const [grabber] = grabbersFrom([controller('left', { squeeze: true, thumbstickForward: 0.5 })], NO_HANDS);
    expect(grabber).toMatchObject({
      kind: 'controller',
      holding: true,
      selecting: false,
      reach: 0.5,
      hitDistance: 2.5,
    });
    expect(grabbersFrom([controller('left', { trigger: true })], NO_HANDS)[0]?.selecting).toBe(true);
  });

  it('gives a hand lost to tracking nothing to hold with or point along', () => {
    expect(grabbersFrom([hand('left', undefined)], NO_HANDS)).toEqual([
      { id: 'left-hand', kind: 'hand', holding: false, selecting: false },
    ]);
  });
});

describe('pointersFrom', () => {
  it('points along every controller, with its depth hit', () => {
    expect(pointersFrom([controller('right')], NO_HANDS)).toEqual([
      { id: 'right-controller', kind: 'controller', ray: AHEAD, hitDistance: 2.5 },
    ]);
  });

  it('points along a hand’s index finger only while it is in a point pose', () => {
    const point = hand('right', pointing('right'));
    const rest = hand('left', relaxed('left'));
    const pointers = pointersFrom([point, rest], readHands(NO_HANDS, [point, rest], EYES));
    expect(pointers).toHaveLength(1);
    expect(pointers[0]?.id).toBe('right-hand');
    expect(pointers[0]?.kind).toBe('hand');
    // Along the finger, which the emulator's hands point down their own −z.
    expect(pointers[0]?.ray.direction.z).toBeLessThan(-0.5);
    expect(pointers[0]?.hitDistance).toBeUndefined();
  });
});

describe('wristButtonFrom', () => {
  it('stands the button off a raised wrist, touched by the other hand’s index tip', () => {
    const raised = wristRaised();
    const button = wristButtonPosition(raised, 'left');
    if (button === undefined) throw new Error('No button.');
    const tip = pointing('right')['index-finger-tip'];
    if (tip === undefined) throw new Error('No index tip.');
    // The right hand moved so its index tip is on the button.
    const onButton = held(
      emulated(POINT_POSE, 'right'),
      { x: button.x - tip.x + REACH.x, y: button.y - tip.y + REACH.y, z: button.z - tip.z + REACH.z },
      REACHING,
    );
    const inputs = [hand('left', raised), hand('right', onButton)];
    const reading = wristButtonFrom(inputs, readHands(NO_HANDS, inputs, EYES));
    expect(reading.position).toEqual(button);
    expect(reading.touched).toBe(true);

    const away = [hand('left', raised), hand('right', pointing('right'))];
    expect(wristButtonFrom(away, readHands(NO_HANDS, away, EYES)).touched).toBe(false);
  });

  it('stands nothing while no wrist is raised', () => {
    const inputs = [hand('left', relaxed('left'))];
    expect(wristButtonFrom(inputs, readHands(NO_HANDS, inputs, EYES))).toEqual({ touched: false });
  });
});

describe('indexTipsFrom', () => {
  it('has each tracked hand’s index tip, and no controller’s', () => {
    const joints = pointing('left');
    expect(indexTipsFrom([hand('left', joints), hand('right', undefined), controller('right')])).toEqual([
      { id: 'left-hand', tip: joints['index-finger-tip'] ?? { x: 0, y: 0, z: 0 } },
    ]);
  });
});
