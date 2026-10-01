import { describe, expect, it } from 'bun:test';
import type { Ray, Vector3Like } from '../xr/ray';
import {
  angleToTarget,
  CLEAR_AFTER_SECONDS,
  CONTROLLER_CONE_DEGREES,
  DROP_CONE_FACTOR,
  DROP_GRACE_SECONDS,
  DWELL_SECONDS,
  HAND_CONE_DEGREES,
  MIN_SEND_INTERVAL_SECONDS,
  NOT_POINTING,
  NOTHING_TOLD,
  OCCLUSION_SLACK_METRES,
  type PointedEntity,
  type PointerKind,
  type PointerSource,
  type PointingState,
  type PointingTarget,
  type PointingUpdateState,
  pendingPointingUpdate,
  QUEUED_FOR_SECONDS,
  SWITCH_MARGIN_DEGREES,
  stepPointing,
  stepPointingUpdate,
} from './pointing';

const EYE = { x: 0, y: 1.5, z: 0 };

/** A ray from the eye, `degrees` to the right of straight ahead (−z), level. */
function rayAt(degrees: number, origin: Vector3Like = EYE): Ray {
  const radians = (degrees * Math.PI) / 180;
  return { origin, direction: { x: Math.sin(radians), y: 0, z: -Math.cos(radians) } };
}

function source(degrees: number, kind: PointerKind = 'hand', hitDistance?: number): PointerSource {
  return { id: kind === 'hand' ? 'right-hand' : 'right-controller', kind, ray: rayAt(degrees), hitDistance };
}

/** An entity `distance` metres from the eye, `degrees` to the right of straight ahead. */
function target(id: string, degrees: number, distance = 3): PointingTarget {
  const radians = (degrees * Math.PI) / 180;
  return {
    id,
    position: { x: EYE.x + Math.sin(radians) * distance, y: EYE.y, z: EYE.z - Math.cos(radians) * distance },
  };
}

/** Steps pointing from `from` to `to` at 72 frames a second with the same rays and targets throughout. */
function hold(
  state: PointingState,
  sources: PointerSource[],
  targets: PointingTarget[],
  from: number,
  to: number,
): PointingState {
  let current = state;
  const frame = 1 / 72;
  for (let now = from; now <= to + 1e-9; now += frame) current = stepPointing(current, sources, targets, now);
  return current;
}

describe('angleToTarget', () => {
  it('is 0 along the ray, 90 square to it, and 180 behind it', () => {
    const ray = rayAt(0);
    expect(angleToTarget(ray, { x: 0, y: 1.5, z: -4 })).toBeCloseTo(0, 6);
    expect(angleToTarget(ray, { x: 2, y: 1.5, z: 0 })).toBeCloseTo(90, 6);
    expect(angleToTarget(ray, { x: 0, y: 1.5, z: 2 })).toBeCloseTo(180, 6);
    expect(angleToTarget(ray, EYE)).toBe(0);
  });
});

describe('choosing what is pointed at', () => {
  const LAMP = target('light.lamp', 0);

  it(`commits a target only after it has stayed the best for ${DWELL_SECONDS} s`, () => {
    let state = stepPointing(NOT_POINTING, [source(1)], [LAMP], 0);
    expect(state.pointed).toBeUndefined();
    expect(state.candidate?.id).toBe('light.lamp');
    state = hold(state, [source(1)], [LAMP], 0, DWELL_SECONDS - 0.03);
    expect(state.pointed).toBeUndefined();
    state = hold(state, [source(1)], [LAMP], DWELL_SECONDS - 0.02, DWELL_SECONDS + 0.02);
    expect(state.pointed?.id).toBe('light.lamp');
    expect(state.candidate).toBeUndefined();
  });

  it(`gives a hand a ${HAND_CONE_DEGREES}° cone and a controller a ${CONTROLLER_CONE_DEGREES}° one`, () => {
    const handInside = hold(NOT_POINTING, [source(HAND_CONE_DEGREES - 0.5)], [LAMP], 0, 1);
    expect(handInside.pointed?.id).toBe('light.lamp');
    const handOutside = hold(NOT_POINTING, [source(HAND_CONE_DEGREES + 0.5)], [LAMP], 0, 1);
    expect(handOutside.pointed).toBeUndefined();
    const controllerOutside = hold(NOT_POINTING, [source(CONTROLLER_CONE_DEGREES + 0.5, 'controller')], [LAMP], 0, 1);
    expect(controllerOutside.pointed).toBeUndefined();
  });

  it('reaches a lamp across the room as easily as one on the desk', () => {
    const far = target('light.far', 0, 6);
    const near = target('light.near', 0, 0.8);
    expect(hold(NOT_POINTING, [source(5)], [far], 0, 1).pointed?.id).toBe('light.far');
    expect(hold(NOT_POINTING, [source(5)], [near], 0, 1).pointed?.id).toBe('light.near');
  });

  it('picks the entity nearest the axis', () => {
    const state = hold(NOT_POINTING, [source(2)], [target('light.a', -1), target('light.b', 3)], 0, 1);
    expect(state.pointed?.id).toBe('light.b');
  });

  it(`keeps the current target until another is ${SWITCH_MARGIN_DEGREES}° nearer the axis`, () => {
    const targets = [target('light.a', 0), target('light.b', 4)];
    let state = hold(NOT_POINTING, [source(0)], targets, 0, 1);
    expect(state.pointed?.id).toBe('light.a');
    // Halfway, then a little past: b is nearer, but not by the margin.
    state = hold(state, [source(2.9)], targets, 1, 2);
    expect(state.pointed?.id).toBe('light.a');
    state = hold(state, [source(3.6)], targets, 2, 3);
    expect(state.pointed?.id).toBe('light.b');
  });

  it(`keeps a target that strays into the wider cone, and drops it outside that after ${DROP_GRACE_SECONDS} s`, () => {
    let state = hold(NOT_POINTING, [source(0)], [LAMP], 0, 1);
    const wider = HAND_CONE_DEGREES * DROP_CONE_FACTOR;
    state = hold(state, [source(wider - 0.5)], [LAMP], 1, 3);
    expect(state.pointed?.id).toBe('light.lamp');
    state = hold(state, [source(wider + 1)], [LAMP], 3, 3 + DROP_GRACE_SECONDS - 0.05);
    expect(state.pointed?.id).toBe('light.lamp');
    state = hold(state, [source(wider + 1)], [LAMP], 3 + DROP_GRACE_SECONDS - 0.04, 3 + DROP_GRACE_SECONDS + 0.05);
    expect(state.pointed).toBeUndefined();
  });

  it('rides out a hand lost for a frame or two', () => {
    let state = hold(NOT_POINTING, [source(0)], [LAMP], 0, 1);
    state = hold(state, [], [LAMP], 1.01, 1.1);
    state = hold(state, [source(0)], [LAMP], 1.11, 1.3);
    expect(state.pointed?.id).toBe('light.lamp');
  });

  it('drops the target when pointing stops for longer', () => {
    let state = hold(NOT_POINTING, [source(0)], [LAMP], 0, 1);
    state = hold(state, [], [LAMP], 1.01, 2);
    expect(state.pointed).toBeUndefined();
  });

  it('passes over an entity beyond the surface the ray hit', () => {
    const behind = target('light.next-room', 0, 4);
    const hidden = hold(NOT_POINTING, [source(0, 'hand', 4 - OCCLUSION_SLACK_METRES - 0.3)], [behind], 0, 1);
    expect(hidden.pointed).toBeUndefined();
    const onSurface = hold(NOT_POINTING, [source(0, 'hand', 4 - 0.1)], [behind], 0, 1);
    expect(onSurface.pointed?.id).toBe('light.next-room');
  });

  it('takes the best of several rays', () => {
    const state = hold(NOT_POINTING, [source(30), source(1, 'controller')], [LAMP], 0, 1);
    expect(state.pointed?.id).toBe('light.lamp');
  });

  it('restarts the dwell when the best target changes before it commits', () => {
    let state = stepPointing(NOT_POINTING, [source(0)], [target('light.a', 0), target('light.b', 10)], 0);
    state = stepPointing(state, [source(10)], [target('light.a', 0), target('light.b', 10)], DWELL_SECONDS * 0.8);
    expect(state.candidate).toEqual({ id: 'light.b', since: DWELL_SECONDS * 0.8 });
    state = stepPointing(state, [source(10)], [target('light.a', 0), target('light.b', 10)], DWELL_SECONDS * 1.2);
    expect(state.pointed).toBeUndefined();
  });
});

describe('telling the server', () => {
  const LAMP: PointedEntity = { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light' };
  const INBOX: PointedEntity = { id: 'inbox:work', name: 'Work inbox' };

  /** Steps the policy through `steps`, collecting what it sends and when (`null`: nothing pointed at). */
  function run(
    steps: { at: number; pointed?: PointedEntity; live: boolean }[],
    start: PointingUpdateState = NOTHING_TOLD,
  ) {
    let state = start;
    const sent: { at: number; entity: PointedEntity | null }[] = [];
    for (const step of steps) {
      const result = stepPointingUpdate(state, step.pointed, step.live, step.at);
      state = result.state;
      if (result.send !== undefined) sent.push({ at: step.at, entity: result.send.entity ?? null });
    }
    return { state, sent };
  }

  it('sends a target the moment it is pointed at while the call is live, once', () => {
    const { sent } = run([
      { at: 0, live: true },
      { at: 1, pointed: LAMP, live: true },
      { at: 2, pointed: LAMP, live: true },
      { at: 3, pointed: LAMP, live: true },
    ]);
    expect(sent).toEqual([{ at: 1, entity: LAMP }]);
  });

  it('sends nothing while the call is not live, and the latest target once it is', () => {
    const { sent } = run([
      { at: 0, pointed: LAMP, live: false },
      { at: 1, live: false },
      { at: 6, live: true },
    ]);
    expect(sent).toEqual([{ at: 6, entity: LAMP }]);
  });

  it(`drops a target pointed at more than ${QUEUED_FOR_SECONDS} s before the call went live`, () => {
    const { sent } = run([
      { at: 0, pointed: LAMP, live: false },
      { at: QUEUED_FOR_SECONDS + 0.5, live: true },
      { at: QUEUED_FOR_SECONDS + 5, live: true },
    ]);
    expect(sent).toEqual([]);
  });

  it(`clears the target ${CLEAR_AFTER_SECONDS} s after the pointing stops`, () => {
    const { sent } = run([
      { at: 0, live: true },
      { at: 1, pointed: LAMP, live: true },
      { at: 2, pointed: LAMP, live: true },
      { at: 2 + CLEAR_AFTER_SECONDS - 0.5, live: true },
      { at: 2 + CLEAR_AFTER_SECONDS + 0.1, live: true },
      { at: 2 + CLEAR_AFTER_SECONDS + 5, live: true },
    ]);
    expect(sent).toEqual([
      { at: 1, entity: LAMP },
      { at: 2 + CLEAR_AFTER_SECONDS + 0.1, entity: null },
    ]);
  });

  it('keeps a target sent late for the whole grace, rather than clearing it straight after', () => {
    const { sent } = run([
      { at: 0, pointed: LAMP, live: false },
      { at: 11, live: true },
      { at: 13, live: true },
      { at: 11 + CLEAR_AFTER_SECONDS + 0.1, live: true },
    ]);
    expect(sent).toEqual([
      { at: 11, entity: LAMP },
      { at: 11 + CLEAR_AFTER_SECONDS + 0.1, entity: null },
    ]);
  });

  it(`sends the newer target, never more often than every ${MIN_SEND_INTERVAL_SECONDS} s`, () => {
    const { sent } = run([
      { at: 0, live: true },
      { at: 1, pointed: LAMP, live: true },
      { at: 1.4, pointed: INBOX, live: true },
      { at: 1.8, pointed: INBOX, live: true },
      { at: 2.1, pointed: INBOX, live: true },
    ]);
    expect(sent).toEqual([
      { at: 1, entity: LAMP },
      { at: 2.1, entity: INBOX },
    ]);
  });

  it('never sends a clear when nothing was said', () => {
    const { sent } = run([
      { at: 0, live: true },
      { at: 30, live: true },
    ]);
    expect(sent).toEqual([]);
  });

  it('says nothing to a conversation that has ended, and leaves a new one to the line, which remembers', () => {
    const { sent } = run([
      { at: 0, live: true },
      { at: 1, pointed: LAMP, live: true },
      { at: 2, pointed: LAMP, live: false },
      { at: 3, pointed: LAMP, live: false },
      { at: 5, pointed: LAMP, live: true },
    ]);
    expect(sent).toEqual([{ at: 1, entity: LAMP }]);
  });

  it('clears a target a new conversation would inherit once it has gone stale, the moment it is live', () => {
    const { sent } = run([
      { at: 0, live: true },
      { at: 1, pointed: LAMP, live: true },
      { at: 2, live: false },
      { at: 60, live: true },
      { at: 61, live: true },
    ]);
    expect(sent).toEqual([
      { at: 1, entity: LAMP },
      { at: 60, entity: null },
    ]);
  });

  it('shows the debug hook what would be sent once the call is live', () => {
    const { state } = run([{ at: 0, pointed: LAMP, live: false }]);
    expect(pendingPointingUpdate(state, 5)).toEqual(LAMP);
    expect(pendingPointingUpdate(state, QUEUED_FOR_SECONDS + 1)).toBeUndefined();
    const told = run([{ at: 0, pointed: LAMP, live: true }]).state;
    expect(pendingPointingUpdate(told, 1)).toBeUndefined();
    expect(pendingPointingUpdate(NOTHING_TOLD, 0)).toBeUndefined();
  });
});
