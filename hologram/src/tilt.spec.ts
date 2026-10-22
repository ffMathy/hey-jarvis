import { describe, expect, it } from 'bun:test';
import {
  advanceTilt,
  createTiltState,
  EYE_DISTANCE_FADE_SECONDS,
  PHONE_EYE_DISTANCE,
  resetTilt,
  TILT_DEADBAND_DEGREES,
  TILT_LARGEST_DEGREES,
  type TiltState,
  tiltEyeDistance,
  tiltFront,
} from './tilt';

/**
 * Tilt to look around, stepped the way the phone's frame callback steps it: once a frame, with
 * whatever the gravity sensor last said, in Reanimated's coordinates (x right, y up the screen, z out
 * of it, gravity pointing at the ground).
 */

const DEGREES = Math.PI / 180;
const GRAVITY = 9.81;

type Gravity = [number, number, number];

/** Gravity on a phone held upright, then with its top edge tipped away from the person by `away` degrees. */
function tippedAway(away: number): Gravity {
  return [0, -GRAVITY * Math.cos(away * DEGREES), -GRAVITY * Math.sin(away * DEGREES)];
}

/** Gravity on a phone reclined `recline` degrees from upright, its right edge turned `turn` degrees away. */
function turnedAway(recline: number, turn: number): Gravity {
  const cosine = Math.cos(recline * DEGREES);
  const sine = Math.sin(recline * DEGREES);
  return [GRAVITY * sine * Math.sin(turn * DEGREES), -GRAVITY * cosine, -GRAVITY * sine * Math.cos(turn * DEGREES)];
}

/** Gravity on an upright phone rolled `roll` degrees anticlockwise, as the person sees it (a wheel turned left). */
function rolledLeft(roll: number): Gravity {
  return [-GRAVITY * Math.sin(roll * DEGREES), -GRAVITY * Math.cos(roll * DEGREES), 0];
}

/** Gravity on a phone lying on its left side, its screen turned `away` degrees from facing the person. */
function onItsSide(away: number): Gravity {
  return [-GRAVITY * Math.cos(away * DEGREES), 0, -GRAVITY * Math.sin(away * DEGREES)];
}

interface Step {
  time: number;
  /** Degrees. */
  yaw: number;
  /** Degrees. */
  pitch: number;
  eyeDistance: number;
}

/**
 * Steps the tilt for `seconds` at `hertz`, with gravity from `at(time)` and `hearing` throughout;
 * returns the eye's path.
 */
function run(
  state: TiltState,
  seconds: number,
  hertz: number,
  at: (time: number) => Gravity,
  start = 0,
  hearing = 0,
): Step[] {
  const path: Step[] = [];
  const step = 1 / hertz;
  for (let time = start + step; time <= start + seconds + 1e-9; time += step) {
    const [x, y, z] = at(time);
    advanceTilt(state, step, x, y, z, hearing);
    path.push({ time, yaw: state.yaw / DEGREES, pitch: state.pitch / DEGREES, eyeDistance: tiltEyeDistance(state) });
  }
  return path;
}

function furthest(path: Step[]): number {
  return Math.max(...path.map((step) => Math.hypot(step.yaw, step.pitch)));
}

describe('a phone held still', () => {
  it('shows him straight on, however it is held', () => {
    for (const gravity of [tippedAway(0), tippedAway(40), tippedAway(85), turnedAway(50, 30), rolledLeft(20)]) {
      const state = createTiltState();
      run(state, 3, 60, () => gravity);
      expect(Math.abs(state.yaw)).toBeLessThan(1e-9);
      expect(Math.abs(state.pitch)).toBeLessThan(1e-9);
    }
  });

  it('ignores a tremor smaller than the deadband', () => {
    const state = createTiltState();
    const path = run(state, 4, 120, (time) => tippedAway(40 + 0.9 * Math.sin(2 * Math.PI * 9 * time)));
    expect(furthest(path)).toBe(0);
  });
});

describe('a tilt', () => {
  it('shows him from above when the top edge goes away, and settles back to the front', () => {
    const state = createTiltState();
    run(state, 1, 60, () => tippedAway(30));
    const path = run(state, 6, 60, () => tippedAway(45), 1);
    const highest = Math.max(...path.map((step) => step.pitch));
    // Most of the 15 degrees less the deadband, before the rest pose catches up.
    expect(highest).toBeGreaterThan(9);
    expect(highest).toBeLessThan(15 - TILT_DEADBAND_DEGREES);
    expect(Math.max(...path.map((step) => Math.abs(step.yaw)))).toBeLessThan(1e-6);
    // Back in front within a few rest time constants.
    expect(Math.abs(path.at(-1)?.pitch ?? 99)).toBeLessThan(0.05);
  });

  it('shows his right side when the right edge of a reclined phone goes away', () => {
    const state = createTiltState();
    run(state, 1, 60, () => turnedAway(45, 0));
    run(state, 0.4, 60, () => turnedAway(45, 15), 1);
    expect(state.yaw).toBeGreaterThan(5 * DEGREES);
    expect(Math.abs(state.pitch)).toBeLessThan(1.5 * DEGREES);
    expect(tiltFront(state)[0]).toBeGreaterThan(0);
  });

  it('looks left when an upright phone is turned like a wheel to the left', () => {
    const state = createTiltState();
    run(state, 1, 60, () => rolledLeft(0));
    run(state, 0.4, 60, () => rolledLeft(15), 1);
    expect(state.yaw).toBeLessThan(-5 * DEGREES);
    expect(Math.abs(state.pitch)).toBeLessThan(1e-6);
  });

  it('cannot see an upright phone turned about the vertical, so does nothing', () => {
    const state = createTiltState();
    run(state, 2, 60, () => tippedAway(0));
    // Turning on the spot leaves gravity where it was in the phone's own frame.
    run(state, 2, 60, () => tippedAway(0), 2);
    expect(state.yaw).toBe(0);
    expect(state.pitch).toBe(0);
  });

  it('never goes further round than the largest angle, whichever way', () => {
    for (const gravity of [tippedAway(80), turnedAway(60, 70), rolledLeft(-70)]) {
      const state = createTiltState();
      run(state, 1, 60, () => tippedAway(10));
      const path = run(state, 1, 60, () => gravity, 1);
      expect(furthest(path)).toBeLessThanOrEqual(TILT_LARGEST_DEGREES + 1e-9);
      // And it does get there: the clamp, not the ease, is what stops it.
      expect(furthest(path)).toBeGreaterThan(TILT_LARGEST_DEGREES - 1);
    }
  });

  it('moves the eye the same way at 60 and at 120 frames a second', () => {
    const at = (time: number) => turnedAway(40, 20 * Math.sin(time * 2));
    const slow = createTiltState();
    const fast = createTiltState();
    run(slow, 3, 60, at);
    run(fast, 3, 120, at);
    expect(Math.abs(slow.yaw - fast.yaw) / DEGREES).toBeLessThan(0.3);
    expect(Math.abs(slow.pitch - fast.pitch) / DEGREES).toBeLessThan(0.3);
  });

  it('points the front where the eye is after every step: straight on at rest, and a unit vector always', () => {
    const state = createTiltState();
    expect(tiltFront(state)).toEqual([0, 0, 1]);
    run(state, 1, 60, () => turnedAway(40, 0));
    const path = run(state, 0.5, 60, () => turnedAway(55, 20), 1);
    expect(furthest(path)).toBeGreaterThan(5);
    // As the step left it, without asking tiltFront again: the GPU body reads it straight off the state.
    const [across, up, out] = state.front;
    expect(Math.hypot(across ?? 0, up ?? 0, out ?? 0)).toBeCloseTo(1, 12);
    expect(across).toBeCloseTo(Math.sin(state.yaw) * Math.cos(state.pitch), 12);
    expect(up).toBeCloseTo(Math.sin(state.pitch), 12);
  });
});

describe('while someone talks to him', () => {
  it('stays in front, so the listening lattice does not reshuffle as the phone moves', () => {
    const state = createTiltState();
    run(state, 1, 60, () => turnedAway(45, 0), 0, 1);
    const path = run(state, 1, 60, () => turnedAway(45, 20), 1, 1);
    expect(furthest(path)).toBe(0);
  });

  it('turns only as far as he is not listening, and back to face them as they start', () => {
    const listening = createTiltState();
    const notListening = createTiltState();
    run(listening, 1, 60, () => tippedAway(30), 0, 0.5);
    run(notListening, 1, 60, () => tippedAway(30));
    run(listening, 0.3, 60, () => tippedAway(45), 1, 0.5);
    run(notListening, 0.3, 60, () => tippedAway(45), 1);
    expect(listening.targetPitch).toBeCloseTo(notListening.targetPitch * 0.5, 12);
    expect(listening.pitch).toBeGreaterThan(2 * DEGREES);

    // Someone starts talking with the phone still tipped: he swings back to the front.
    run(notListening, 1, 60, () => tippedAway(45), 1.3, 1);
    expect(Math.abs(notListening.pitch)).toBeLessThan(0.01 * DEGREES);
  });

  it('treats a hearing that is not a number as nobody talking', () => {
    const state = createTiltState();
    run(state, 1, 60, () => tippedAway(30));
    run(state, 0.3, 60, () => tippedAway(45), 1, Number.NaN);
    expect(state.pitch).toBeGreaterThan(5 * DEGREES);
  });
});

describe('a phone on its side, or no sensor', () => {
  it('shows him straight on when the phone lies on its side', () => {
    const state = createTiltState();
    run(state, 1, 60, () => onItsSide(0));
    run(state, 1, 60, () => onItsSide(17), 1);
    expect(Math.hypot(state.yaw, state.pitch)).toBeLessThan(1e-9);
  });

  it('takes the first reading off its side as the rest pose, so nothing jumps', () => {
    const state = createTiltState();
    run(state, 1, 60, () => tippedAway(20));
    run(state, 0.2, 60, () => tippedAway(35), 1);
    expect(state.pitch).toBeGreaterThan(5 * DEGREES);
    run(state, 1, 60, () => onItsSide(0), 1.2);
    expect(state.rested).toBe(false);
    expect(Math.abs(state.pitch)).toBeLessThan(0.01 * DEGREES);
    // Picked up again and held upright, reclined: no swing on the way back.
    const path = run(state, 0.5, 60, () => tippedAway(60), 2.2);
    expect(furthest(path)).toBeLessThan(0.01);
  });

  it('goes back to the front with no reading, and takes the next reading as the new rest', () => {
    const state = createTiltState();
    run(state, 1, 60, () => tippedAway(20));
    run(state, 0.2, 60, () => tippedAway(40), 1);
    expect(state.pitch).toBeGreaterThan(5 * DEGREES);
    run(state, 2, 60, () => [0, 0, 0], 1.2);
    expect(Math.abs(state.pitch)).toBeLessThan(0.01 * DEGREES);
    expect(state.rested).toBe(false);
    // The sensor comes back with the phone held somewhere else: no jump.
    const path = run(state, 0.5, 60, () => tippedAway(70), 3.2);
    expect(Math.max(...path.map((step) => Math.abs(step.pitch)))).toBeLessThan(0.01);
  });

  it('treats a reading that is not a number, or not finite, as no reading', () => {
    for (const reading of [
      [Number.NaN, 0, 0],
      [0, Number.POSITIVE_INFINITY, 0],
      [0, -GRAVITY, Number.NaN],
    ]) {
      const state = createTiltState();
      run(state, 1, 60, () => tippedAway(20));
      advanceTilt(state, 1 / 60, reading[0] ?? 0, reading[1] ?? 0, reading[2] ?? 0, 0);
      expect(state.rested).toBe(false);
      expect(Number.isFinite(state.yaw) && Number.isFinite(state.pitch)).toBe(true);
      expect(tiltFront(state).every(Number.isFinite)).toBe(true);
    }
  });

  it('puts everything back as a new state has it on a reset, keeping the same objects', () => {
    const state = createTiltState();
    const front = state.front;
    run(state, 1, 60, () => tippedAway(20));
    run(state, 0.3, 60, () => tippedAway(40), 1);
    expect(state.pitch).toBeGreaterThan(5 * DEGREES);
    expect(resetTilt(state)).toBe(state);
    expect(state).toEqual(createTiltState());
    expect(state.front).toBe(front);
  });
});

describe('how far away the eye is', () => {
  it('is infinitely far, as the flat drawing is seen, until a reading arrives', () => {
    const state = createTiltState();
    expect(tiltEyeDistance(state)).toBe(Number.POSITIVE_INFINITY);
    run(state, 1, 60, () => [0, 0, 0]);
    expect(tiltEyeDistance(state)).toBe(Number.POSITIVE_INFINITY);
  });

  it('comes in to the phone distance over the fade once readings arrive, evenly in its inverse', () => {
    const state = createTiltState();
    const path = run(state, EYE_DISTANCE_FADE_SECONDS + 0.05, 60, () => tippedAway(30));
    expect(path.at(-1)?.eyeDistance).toBe(PHONE_EYE_DISTANCE);
    // From where it was before the first reading, infinitely far.
    const inverses = [0, ...path.map((step) => 1 / step.eyeDistance)];
    for (let index = 1; index < inverses.length; index++) {
      const step = (inverses[index] ?? 0) - (inverses[index - 1] ?? 0);
      expect(step).toBeGreaterThanOrEqual(0);
      // No frame takes more than a tenth of the way: it is a fade, not a step.
      expect(step).toBeLessThan(0.1 / PHONE_EYE_DISTANCE);
    }
  });

  it('goes back out to infinitely far once readings stop, and stays near while the phone lies on its side', () => {
    const state = createTiltState();
    run(state, 1, 60, () => onItsSide(0));
    expect(tiltEyeDistance(state)).toBe(PHONE_EYE_DISTANCE);
    run(state, EYE_DISTANCE_FADE_SECONDS + 0.05, 60, () => [0, 0, 0], 1);
    expect(tiltEyeDistance(state)).toBe(Number.POSITIVE_INFINITY);
  });

  it('starts from infinitely far again after a reset', () => {
    const state = createTiltState();
    run(state, 1, 60, () => tippedAway(30));
    resetTilt(state);
    expect(tiltEyeDistance(state)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('stepping it every frame', () => {
  it('works in place on the one state and its one front, so a frame allocates nothing of its own', () => {
    const state = createTiltState();
    const front = state.front;
    for (const gravity of [tippedAway(10), tippedAway(30), [0, 0, 0] as Gravity, onItsSide(0)]) {
      expect(advanceTilt(state, 1 / 60, gravity[0], gravity[1], gravity[2], 0)).toBe(state);
      expect(tiltFront(state)).toBe(front);
    }
  });

  it('moves nothing for a step of no time, or of a time that is not a number', () => {
    const state = createTiltState();
    run(state, 1, 60, () => tippedAway(20));
    run(state, 0.2, 60, () => tippedAway(40), 1);
    const before = { ...state, front: [...state.front] };
    for (const deltaSeconds of [0, -1, Number.NaN]) {
      const [x, y, z] = tippedAway(40);
      advanceTilt(state, deltaSeconds, x, y, z, 0);
    }
    expect(state).toEqual(before);
  });
});
