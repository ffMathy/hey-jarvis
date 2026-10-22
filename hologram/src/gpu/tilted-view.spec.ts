import { describe, expect, it } from 'bun:test';
import { advanceTiltBy, createTiltState, type Gravity, PHONE_EYE_SQUARES, type TiltState } from '../tilt';
import { createFlatCamera, type FlatScreen, placeFlatCamera } from './flat-camera';
import { FRONT_VIEW } from './fragment-3d';
import { type EyeView, STRAIGHT_ON, tiltedView } from './tilted-view';

/**
 * The phone's tilt carried through to the camera the GPU body is drawn with, as the view carries it:
 * a reading handed over as the sensor hands it, the tilt stepped by it, the eye it puts there, and
 * the camera placed by that. Each gesture is judged by which of his sides it brings nearer the eye,
 * which a sign flipped or a pair of axes swapped anywhere on the way turns round.
 */

const DEGREES = Math.PI / 180;
const GRAVITY = 9.81;
const SCREEN: FlatScreen = { width: 540, height: 540, squareX: 270, squareY: 270, squareSide: 540 };
/** His radius as a share of the square, at rest. */
const RADIUS_SHARE = 0.27;

/** Gravity on a phone held upright, its top edge tipped away from the person by `away` degrees. */
function tippedAway(away: number): Gravity {
  return { x: 0, y: -GRAVITY * Math.cos(away * DEGREES), z: -GRAVITY * Math.sin(away * DEGREES) };
}

/** Gravity on an upright phone rolled `roll` degrees anticlockwise, as the person sees it (a wheel turned left). */
function rolledLeft(roll: number): Gravity {
  return { x: -GRAVITY * Math.sin(roll * DEGREES), y: -GRAVITY * Math.cos(roll * DEGREES), z: 0 };
}

const NO_READING: Gravity = { x: 0, y: 0, z: 0 };

/** Steps the tilt for `seconds` at sixty frames a second with `gravity` throughout, as the view does. */
function hold(state: TiltState, seconds: number, gravity: Gravity): void {
  for (let frame = 0; frame < seconds * 60; frame++) {
    advanceTiltBy(state, 1 / 60, gravity, 0);
  }
}

/**
 * How far a point of his — in his radii, x right, y up, z towards the person at rest — is from the
 * eye along its line of sight, with the camera placed where `view` puts the eye.
 */
function distanceFromTheEye(view: EyeView, x: number, y: number, z: number): number {
  const { modelView } = placeFlatCamera(createFlatCamera(), SCREEN, RADIUS_SHARE, view.basis, view.eyeSquares);
  // The eye looks down its own -z, so the further in front of it, the more negative.
  return -((modelView[2] ?? 0) * x + (modelView[6] ?? 0) * y + (modelView[10] ?? 0) * z + (modelView[14] ?? 0));
}

describe('the eye the tilt puts the camera at', () => {
  it('shows him straight on, from the phone’s eye, to a phone held still', () => {
    const state = createTiltState();
    hold(state, 1, tippedAway(0));
    const view = tiltedView(state, null);
    for (const axis of ['right', 'up', 'front'] as const) {
      for (const [index, component] of view.basis[axis].entries()) {
        expect(component).toBeCloseTo(FRONT_VIEW[axis][index] ?? Number.NaN, 12);
      }
    }
    expect(view.eyeSquares).toBe(PHONE_EYE_SQUARES);
    const camera = placeFlatCamera(createFlatCamera(), SCREEN, RADIUS_SHARE, view.basis, view.eyeSquares);
    expect(camera.eyeDistance).toBeCloseTo(PHONE_EYE_SQUARES / RADIUS_SHARE, 9);
  });

  it('brings his top nearer than his bottom when the top edge goes away, and neither side nearer', () => {
    const state = createTiltState();
    hold(state, 1, tippedAway(0));
    hold(state, 0.4, tippedAway(15));
    const view = tiltedView(state, null);
    const top = distanceFromTheEye(view, 0, 1, 0);
    const bottom = distanceFromTheEye(view, 0, -1, 0);
    // About 2 sin(pitch) radii apart, with the eye some ten degrees above him.
    expect(bottom - top).toBeGreaterThan(2 * Math.sin(5 * DEGREES));
    expect(distanceFromTheEye(view, -1, 0, 0)).toBeCloseTo(distanceFromTheEye(view, 1, 0, 0), 6);
  });

  it('brings his left nearer than his right when an upright phone is turned like a wheel to the left', () => {
    const state = createTiltState();
    hold(state, 1, rolledLeft(0));
    hold(state, 0.4, rolledLeft(15));
    const view = tiltedView(state, null);
    const left = distanceFromTheEye(view, -1, 0, 0);
    const right = distanceFromTheEye(view, 1, 0, 0);
    expect(right - left).toBeGreaterThan(2 * Math.sin(5 * DEGREES));
    expect(distanceFromTheEye(view, 0, 1, 0)).toBeCloseTo(distanceFromTheEye(view, 0, -1, 0), 6);
  });

  it('shows him as the flat drawing does with no reading, and keeps the last view plane where there is none', () => {
    const state = createTiltState();
    hold(state, 1, NO_READING);
    const view = tiltedView(state, STRAIGHT_ON.basis);
    expect(view.eyeSquares).toBe(STRAIGHT_ON.eyeSquares);
    const camera = placeFlatCamera(createFlatCamera(), SCREEN, RADIUS_SHARE, view.basis, view.eyeSquares);
    expect(camera.eyeDistance).toBe(Number.POSITIVE_INFINITY);
    expect(STRAIGHT_ON.basis).toBe(FRONT_VIEW);
  });
});
