import { SPHERE_FRACTION } from './hologram-drawing';

/**
 * Tilt to look around: the phone's gravity, as Reanimated's GRAVITY sensor reports it, turned into
 * where the eye is round him, and how far away it is.
 *
 * The phone and the watch do this. A desktop browser, which has no sensor, shows him straight on
 * and never steps this state.
 *
 * **Built for the phone's UI thread, like the frame clock.** The view steps it once a frame inside
 * its own `modify`, beside the clock's, with the latest reading as positional arguments, so a frame
 * allocates nothing; and only the GPU body reads it, never the Skia picture, so a reading arriving
 * does not rebuild the picture. Every function here closes over nothing but module-level constants
 * and the worklets declared above it — see `.claude/rules/hologram-worklets.md`, "Worklets".
 *
 * Device coordinates are Reanimated's: x right, y up the screen, z out of the screen towards the
 * person, and gravity pointing at the ground — (0, -g, 0) held upright, (0, 0, -g) lying on its back.
 *
 * - **Rest follows the phone.** The rest pose is gravity low-passed over {@link TILT_REST_SECONDS},
 *   so a phone held still, however it is held, shows him straight on, and a tilt shows him from the
 *   side for a moment and then settles back to the front.
 * - **What a tilt is.** The turn taking rest gravity to this gravity, about the axis rest × now. Its
 *   part about the screen's x (squared to rest) tips the eye up or down — the top edge going away
 *   shows him from above — and its part about the other axis square to rest (the screen's normal on
 *   an upright phone, its long side on one lying flat) swings the eye left or right. On an upright
 *   phone that second one is the steering-wheel roll: gravity cannot see a turn about the vertical,
 *   so the roll is what is left to look sideways with.
 * - **A tremor is ignored**, softly: {@link TILT_DEADBAND_DEGREES} comes off the size of every tilt.
 * - **No further round than {@link TILT_LARGEST_DEGREES}**, whichever way.
 * - **Not while someone is talking to him.** The listening lattice snaps in the plane that faces the
 *   eye, and while it shows about 7% of its lit fragments jump to another knot for every degree the
 *   view turns — a shimmer that reads as noise. So the tilt is scaled by how much he is listening,
 *   and he turns to face whoever is talking.
 * - **Eased** over {@link TILT_EASE_SECONDS}, so the sensor's steps never reach the screen.
 * - **Seen from {@link PHONE_EYE_DISTANCE} while readings arrive**, and from infinitely far
 *   otherwise, which is exactly what the flat drawing shows. The distance is handed out in sides of
 *   the drawing's square ({@link tiltEyeSquares}), the unit `placeFlatCamera` takes it in, so that
 *   as he swells with his voice he grows towards the eye rather than the eye backing off with him.
 */

/** The furthest round him the eye goes, in degrees. */
export const TILT_LARGEST_DEGREES = 25;
/** How long the rest pose takes to follow the phone: the time constant of its low-pass, in seconds. */
export const TILT_REST_SECONDS = 1.5;
/** What comes off every tilt before it moves the eye, in degrees: a hand's tremor, a breath. */
export const TILT_DEADBAND_DEGREES = 1.5;
/** How quickly the eye follows the tilt: the time constant of its ease, in seconds. */
export const TILT_EASE_SECONDS = 0.12;
/**
 * Degrees of eye per degree of tilt. One is a window held in the hand; a moderate tip then feels
 * small, and a little more may suit a phone better, which only a phone in the hand can say.
 */
export const TILT_GAIN = 1;
/**
 * How often the gravity sensor is asked for a reading, in milliseconds: about thirty a second.
 *
 * Every reading runs a worklet on Android's main thread the moment it arrives, and that is the thread
 * that draws him, so a reading nobody needed is time taken from a frame. Left to `'auto'`, Reanimated
 * registers at 8 ms and never throttles: 125 of them a second. Thirty is plenty. A deliberate tilt
 * takes a few tenths of a second, the eye's own ease ({@link TILT_EASE_SECONDS}, about four of these
 * intervals) smooths the steps between readings, and each frame only reads the latest reading anyway.
 * It is also more than twice the fastest hand tremor, about 12 Hz, so a tremor cannot fold down into a
 * slow sway that the deadband would let through. Twenty milliseconds would show nothing more on the
 * screen for two thirds as many worklets again.
 */
export const TILT_SENSOR_INTERVAL_MS = 33;
/**
 * How far away the eye is on a phone while its sensor is reading, in his resting radii: the radius
 * he is drawn at when he is wholly here and silent, which the figures below are measured at.
 *
 * Near enough for him to have a front and a back as the view turns — at this distance the front of
 * him is drawn 13% larger than the back — and far enough that, straight on, he looks like the flat
 * drawing: the nearer the eye, the brighter the outer annulus comes out against it, 30% at four radii
 * and 3% at eighteen. The front of him never reaches past the rim at any of them.
 */
export const PHONE_EYE_DISTANCE = 8;
/** {@link PHONE_EYE_DISTANCE} in sides of the drawing's square, which his resting radius is SPHERE_FRACTION of. */
export const PHONE_EYE_SQUARES = PHONE_EYE_DISTANCE * SPHERE_FRACTION;
/**
 * How long the eye takes to come in from infinitely far to {@link PHONE_EYE_DISTANCE} once readings
 * arrive, and to go back out once they stop, in seconds. Eased through the inverse of the distance,
 * which is what the drawing's perspective scales with, so the change is even from end to end.
 */
export const EYE_DISTANCE_FADE_SECONDS = 0.3;
/**
 * How far from lying on its side the phone must be for a tilt to mean anything: the screen's x,
 * squared to gravity, has to keep this much of its length. On its side there is no "up the screen"
 * left to tip about.
 */
const SIDEWAYS_LIMIT = 0.3;
/** Shorter than this, a gravity reading is no reading: a sensor not started, stopped or missing. */
const SHORTEST_READING = 1e-3;
const DEGREES_TO_RADIANS = Math.PI / 180;

/** A gravity reading, as Reanimated's GRAVITY sensor hands it over: in the device coordinates above. */
export interface Gravity {
  x: number;
  y: number;
  z: number;
}

/** Everything the tilt carries from one frame to the next. */
export interface TiltState {
  /** Rest gravity, a unit vector in device coordinates; meaningless until `rested`. */
  restX: number;
  restY: number;
  restZ: number;
  /** Whether there is a rest pose: the first reading after none, or after the phone lay on its side, becomes it. */
  rested: boolean;
  /** Where the eye is heading, before the ease, in radians: right of the front, and above it. */
  targetYaw: number;
  targetPitch: number;
  /** Where the eye is now, eased, in radians. */
  yaw: number;
  pitch: number;
  /** The same as a unit vector, as {@link tiltFront} writes it: kept here so reading it allocates nothing. */
  front: number[];
  /** 0–1: how far the eye has come in from infinitely far toward {@link PHONE_EYE_DISTANCE}. */
  perspective: number;
}

/** Straight on, from infinitely far, with no rest pose yet: as a phone with no reading shows him. */
export function createTiltState(): TiltState {
  return {
    restX: 0,
    restY: -1,
    restZ: 0,
    rested: false,
    targetYaw: 0,
    targetPitch: 0,
    yaw: 0,
    pitch: 0,
    front: [0, 0, 1],
    perspective: 0,
  };
}

/**
 * Where the eye is, as a unit vector in his frame — x right, y up, z out of the screen at rest —
 * written into the state's own `front` and returned: the direction a view is built towards. Straight
 * on is (0, 0, 1). Every step and reset here ends by calling it, so `front` is always current.
 */
export function tiltFront(state: TiltState): number[] {
  'worklet';
  const cosinePitch = Math.cos(state.pitch);
  state.front[0] = Math.sin(state.yaw) * cosinePitch;
  state.front[1] = Math.sin(state.pitch);
  state.front[2] = Math.cos(state.yaw) * cosinePitch;
  return state.front;
}

/**
 * How far away the eye is now, in sides of the drawing's square — what `placeFlatCamera` takes as
 * its `eyeSquares`: {@link PHONE_EYE_SQUARES} while readings arrive, `Infinity` — the flat drawing's
 * view — while none do, and in between on the way from one to the other.
 */
export function tiltEyeSquares(state: TiltState): number {
  'worklet';
  const share = state.perspective;
  const eased = share * share * (3 - 2 * share);
  return eased > 0 ? PHONE_EYE_SQUARES / eased : Number.POSITIVE_INFINITY;
}

/**
 * Back to how {@link createTiltState} makes it, in place: on coming back to the foreground, so he
 * arrives straight on and the first reading from then on is the rest pose, wherever the phone went
 * while he was away.
 */
export function resetTilt(state: TiltState): TiltState {
  'worklet';
  state.restX = 0;
  state.restY = -1;
  state.restZ = 0;
  state.rested = false;
  state.targetYaw = 0;
  state.targetPitch = 0;
  state.yaw = 0;
  state.pitch = 0;
  state.perspective = 0;
  tiltFront(state);
  return state;
}

/** Moves the eye toward its target over `deltaSeconds`, and the perspective in or out at its fixed rate. */
function easeEye(state: TiltState, deltaSeconds: number, reading: boolean) {
  'worklet';
  if (!(deltaSeconds > 0)) return;
  const share = 1 - Math.exp(-deltaSeconds / TILT_EASE_SECONDS);
  state.yaw += (state.targetYaw - state.yaw) * share;
  state.pitch += (state.targetPitch - state.pitch) * share;
  const perspective = state.perspective + ((reading ? 1 : -1) * deltaSeconds) / EYE_DISTANCE_FADE_SECONDS;
  state.perspective = perspective > 1 ? 1 : perspective > 0 ? perspective : 0;
}

/** Heads the eye back to the front, and starts the rest pose again from the next usable reading. */
function forgetRest(state: TiltState, deltaSeconds: number, reading: boolean): TiltState {
  'worklet';
  state.rested = false;
  state.targetYaw = 0;
  state.targetPitch = 0;
  easeEye(state, deltaSeconds, reading);
  tiltFront(state);
  return state;
}

/** Moves the rest pose toward gravity `(x, y, z)`, a unit vector, over `deltaSeconds`; or starts it there. */
function followRest(state: TiltState, deltaSeconds: number, x: number, y: number, z: number) {
  'worklet';
  if (!state.rested) {
    state.restX = x;
    state.restY = y;
    state.restZ = z;
    state.rested = true;
    return;
  }
  if (!(deltaSeconds > 0)) return;
  const follow = 1 - Math.exp(-deltaSeconds / TILT_REST_SECONDS);
  const restX = state.restX + (x - state.restX) * follow;
  const restY = state.restY + (y - state.restY) * follow;
  const restZ = state.restZ + (z - state.restZ) * follow;
  const length = Math.sqrt(restX * restX + restY * restY + restZ * restZ);
  if (length > 1e-6) {
    state.restX = restX / length;
    state.restY = restY / length;
    state.restZ = restZ / length;
  } else {
    // Turned clean over in one frame: start again from here.
    state.restX = x;
    state.restY = y;
    state.restZ = z;
  }
}

/**
 * Where the eye should head for gravity `(x, y, z)`, a unit vector, against the rest pose: the turn
 * between them split into a tip and a swing, less the deadband, no further than the largest angle,
 * and scaled down by how much he is listening.
 */
function aimEye(state: TiltState, x: number, y: number, z: number, hearing: number) {
  'worklet';
  const restX = state.restX;
  const restY = state.restY;
  const restZ = state.restZ;
  // The axis of the turn from rest to now, its length the sine of the angle; and the angle itself.
  const axisX = restY * z - restZ * y;
  const axisY = restZ * x - restX * z;
  const axisZ = restX * y - restY * x;
  const sine = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
  const angle = Math.atan2(sine, restX * x + restY * y + restZ * z);
  // The screen's x squared to rest, and the axis square to both: rest × across.
  const acrossX = 1 - restX * restX;
  const acrossY = -restX * restY;
  const acrossZ = -restX * restZ;
  const acrossLength = Math.sqrt(acrossX * acrossX + acrossY * acrossY + acrossZ * acrossZ);
  if (acrossLength < SIDEWAYS_LIMIT || sine < 1e-9) {
    state.targetYaw = 0;
    state.targetPitch = 0;
    return;
  }
  const aroundX = (restY * acrossZ - restZ * acrossY) / acrossLength;
  const aroundY = (restZ * acrossX - restX * acrossZ) / acrossLength;
  const aroundZ = (restX * acrossY - restY * acrossX) / acrossLength;
  const anglePerSine = angle / sine;
  const pitch = ((axisX * acrossX + axisY * acrossY + axisZ * acrossZ) / acrossLength) * anglePerSine * TILT_GAIN;
  const yaw = (axisX * aroundX + axisY * aroundY + axisZ * aroundZ) * anglePerSine * TILT_GAIN;
  const size = Math.sqrt(yaw * yaw + pitch * pitch);
  const kept = size - TILT_DEADBAND_DEGREES * DEGREES_TO_RADIANS;
  const largest = TILT_LARGEST_DEGREES * DEGREES_TO_RADIANS;
  // Written so that a NaN lands on 0: neither comparison is true of one.
  const listening = hearing > 0 ? (hearing > 1 ? 1 : hearing) : 0;
  const scale = kept > 0 ? ((kept > largest ? largest : kept) / size) * (1 - listening) : 0;
  state.targetYaw = yaw * scale;
  state.targetPitch = pitch * scale;
}

/**
 * One frame, `deltaSeconds` long: the latest gravity reading moves the rest pose on, and the eye
 * toward where the tilt says it should be, less however much `hearing` (0–1, the frame clock's) says
 * he is listening.
 *
 * The reading may be any length. One that is nought or not a number is no reading at all — the
 * sensor is missing, not started yet, or stopped — and the eye heads back to the front and out to
 * infinitely far. So does a reading from a phone lying on its side, though the eye stays near. Either
 * way the next usable reading becomes the rest pose, so the eye never jumps when it comes back.
 */
export function advanceTilt(
  state: TiltState,
  deltaSeconds: number,
  gravityX: number,
  gravityY: number,
  gravityZ: number,
  hearing: number,
): TiltState {
  'worklet';
  const length = Math.sqrt(gravityX * gravityX + gravityY * gravityY + gravityZ * gravityZ);
  // Not `<`: a NaN fails every comparison, and a reading of NaN is no reading.
  if (!(length > SHORTEST_READING && length < Number.POSITIVE_INFINITY)) {
    return forgetRest(state, deltaSeconds, false);
  }
  const x = gravityX / length;
  const y = gravityY / length;
  const z = gravityZ / length;
  // The length the screen's x keeps squared to this gravity, squared: no square root to go NaN on.
  if (1 - x * x < SIDEWAYS_LIMIT * SIDEWAYS_LIMIT) {
    return forgetRest(state, deltaSeconds, true);
  }
  followRest(state, deltaSeconds, x, y, z);
  aimEye(state, x, y, z, hearing);
  easeEye(state, deltaSeconds, true);
  tiltFront(state);
  return state;
}

/**
 * {@link advanceTilt} with the reading as the sensor hands it over, which is how the view steps it:
 * the reading's axes are taken apart here, where the specs can see which goes where, rather than in
 * the view, where a swapped pair would turn him the wrong way with nothing to say so.
 */
export function advanceTiltBy(state: TiltState, deltaSeconds: number, gravity: Gravity, hearing: number): TiltState {
  'worklet';
  return advanceTilt(state, deltaSeconds, gravity.x, gravity.y, gravity.z, hearing);
}
