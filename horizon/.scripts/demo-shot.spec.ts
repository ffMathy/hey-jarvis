import { describe, expect, it } from 'bun:test';
import { Quaternion, Vector3 } from 'three';
import type { RoomPoint } from '../src/debug-hook';
import {
  closestApproachMetres,
  createCameraPath,
  DEFAULT_SECONDS,
  demoScript,
  FADE_STARTS_AT_RADII,
  lookingAt,
  type Orientation,
  RETREAT_METRES,
  smootherstep,
  steadyRamp,
} from './demo-shot';

const FRAMES_PER_SECOND = 30;
const START = { position: { x: 0, y: 1.6, z: 1.2 }, yaw: 0 };
const CENTRE = { x: 0, y: 1.45, z: -0.4 };
const RADIUS = 0.22;

/** Where an XR view with `orientation` looks: its −Z. */
function viewDirection(orientation: Orientation): Vector3 {
  const { x, y, z, w } = orientation;
  return new Vector3(0, 0, -1).applyQuaternion(new Quaternion(x, y, z, w));
}

function towards(from: RoomPoint, to: RoomPoint): Vector3 {
  return new Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
}

function distance(first: RoomPoint, second: RoomPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function frameTimes(seconds: number, from = 0): number[] {
  const times: number[] = [];
  for (let frame = Math.ceil(from * FRAMES_PER_SECOND); frame < seconds * FRAMES_PER_SECOND; frame += 1)
    times.push(frame / FRAMES_PER_SECOND);
  return times;
}

describe('the demo script', () => {
  it('runs its beats in order, with every select made during the turn', () => {
    const script = demoScript();
    expect(script.seconds).toBe(DEFAULT_SECONDS);
    expect(script.hintSeconds).toBeLessThan(script.approach.start);
    expect(script.approach.start).toBeLessThan(script.orbit.start);
    expect(script.orbit.end).toBeLessThan(script.retreat.end);
    expect(script.retreat.end).toBeLessThan(script.seconds - script.fadeOutSeconds);
    for (const select of script.selects) {
      expect(select.at).toBeGreaterThan(script.orbit.start);
      expect(select.at).toBeLessThan(script.orbit.end);
    }
    expect(script.selects.map((select) => select.mood)).toEqual(['listening', 'thinking', 'idle', 'speaking']);
  });

  it('scales every beat with the length asked for', () => {
    const half = demoScript(DEFAULT_SECONDS / 2);
    const full = demoScript();
    expect(half.orbit.start).toBeCloseTo(full.orbit.start / 2, 9);
    expect(half.selects[2]?.at).toBeCloseTo((full.selects[2]?.at ?? 0) / 2, 9);
  });
});

describe('easing', () => {
  it('smootherstep starts at 0 and ends at 1, and holds outside', () => {
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 12);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(2)).toBe(1);
  });

  it('steadyRamp is continuous and never faster than its level speed', () => {
    const ramp = 0.2;
    expect(steadyRamp(0, ramp)).toBe(0);
    expect(steadyRamp(1, ramp)).toBeCloseTo(1, 12);
    expect(steadyRamp(0.5, ramp)).toBeCloseTo(0.5, 12);
    const step = 1e-4;
    let previous = 0;
    for (let share = step; share <= 1; share += step) {
      const value = steadyRamp(share, ramp);
      const speed = (value - previous) / step;
      expect(speed).toBeGreaterThanOrEqual(0);
      expect(speed).toBeLessThanOrEqual(1 / (1 - ramp) + 1e-3);
      previous = value;
    }
  });
});

describe('lookingAt', () => {
  it('turns an XR view to face the target', () => {
    const eye = { x: 1, y: 1.6, z: 2 };
    const target = { x: -0.5, y: 1.2, z: -1 };
    expect(viewDirection(lookingAt(eye, target)).angleTo(towards(eye, target))).toBeLessThan(1e-6);
  });
});

describe('the camera path', () => {
  const script = demoScript();
  const placedAt = script.hintSeconds + 1 / FRAMES_PER_SECOND;
  const before = createCameraPath(script, START);
  const after = createCameraPath(script, START, { centre: CENTRE, radius: RADIUS, at: placedAt });

  it('is the same before the placement whether or not the placement is known, so rebuilding it never jumps', () => {
    for (const seconds of frameTimes(script.approach.start)) {
      const unknown = before.headAt(seconds);
      const known = after.headAt(seconds);
      expect(distance(unknown.position, known.position)).toBeLessThan(1e-9);
      expect(viewDirection(unknown.orientation).angleTo(viewDirection(known.orientation))).toBeLessThan(1e-6);
    }
  });

  it('stays outside the distance at which he fades, all the way round', () => {
    const fade = FADE_STARTS_AT_RADII * RADIUS;
    for (const seconds of frameTimes(script.seconds)) {
      expect(distance(after.headAt(seconds).position, CENTRE)).toBeGreaterThan(fade);
    }
  });

  it('walks up to arm’s length, goes once all the way round him there, and ends further back', () => {
    const along = (seconds: number) => {
      const { position } = after.headAt(seconds);
      return {
        distance: Math.hypot(position.x - CENTRE.x, position.z - CENTRE.z),
        bearing: Math.atan2(position.x - CENTRE.x, position.z - CENTRE.z),
      };
    };
    expect(along(script.orbit.start + 1).distance).toBeCloseTo(closestApproachMetres(RADIUS), 1);
    let turned = 0;
    let bearing = along(script.orbit.start).bearing;
    for (const seconds of frameTimes(script.orbit.end + 1 / FRAMES_PER_SECOND, script.orbit.start)) {
      const next = along(seconds).bearing;
      let change = next - bearing;
      if (change > Math.PI) change -= 2 * Math.PI;
      if (change < -Math.PI) change += 2 * Math.PI;
      turned += change;
      bearing = next;
    }
    expect(turned).toBeCloseTo(2 * Math.PI, 2);
    expect(along(script.seconds - 0.01).distance).toBeCloseTo(RETREAT_METRES, 1);
  });

  it('moves smoothly: never faster than a stroll between two frames', () => {
    const times = frameTimes(script.seconds);
    for (let index = 1; index < times.length; index += 1) {
      const step = distance(after.headAt(times[index] ?? 0).position, after.headAt(times[index - 1] ?? 0).position);
      expect(step * FRAMES_PER_SECOND).toBeLessThan(0.6);
    }
  });

  it('looks at his centre once it has settled on him, give or take a head’s drift', () => {
    for (const seconds of frameTimes(script.seconds, placedAt + 1.5)) {
      const head = after.headAt(seconds);
      expect(viewDirection(head.orientation).angleTo(towards(head.position, CENTRE))).toBeLessThan(0.03);
    }
  });

  it('points the controller straight at him, and holds none before he is there', () => {
    expect(after.handAt(placedAt - 0.5)).toBeUndefined();
    for (const seconds of frameTimes(script.seconds, placedAt)) {
      const hand = after.handAt(seconds);
      if (hand === undefined) throw new Error(`No hand at ${seconds} s.`);
      expect(viewDirection(hand.orientation).angleTo(towards(hand.position, CENTRE))).toBeLessThan(1e-6);
    }
  });
});
