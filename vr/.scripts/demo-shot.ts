import { Matrix4, Quaternion, Vector3 } from 'three';
import type { RoomPoint } from '../src/debug-hook';

/**
 * The demo video's shot: when things happen, and where the emulated head is at every moment.
 *
 * Everything here is a pure function of the video's clock, so the same script renders the same
 * camera move frame for frame however slowly the emulator draws. The renderer
 * (`render-demo.ts`) asks for the head's pose and the controller's once per video frame and hands
 * them to the emulated Quest 3; nothing in here knows about the browser.
 *
 * The move, in the default 36 seconds:
 *
 * - **0–3.5 s** the living room waiting for "Hey Jarvis", its hint up, the head glancing a little
 *   to the left and back so the hint is seen trailing the gaze;
 * - **3.5 s** the cut to sample mode, from the same pose: he is placed 1.6 m ahead, arrives, and
 *   speaks (sample mode's speaking is the recorded greeting, repeated);
 * - **5.8–8.4 s** a glance away to the right and back while he greets, so that for a moment he is
 *   to the left of the view — the one stretch in which his voice, which the soundtrack places where
 *   he stands (`demo-soundtrack.ts`), is heard from one side;
 * - **7.6–11.8 s** a walk up to arm's length;
 * - **11–27.5 s** one full turn around him at that distance, starting before the walk has quite
 *   ended so the path curves in rather than stopping, while selects on him walk his moods —
 *   listening, thinking, idle, and speaking again;
 * - **27–31.8 s** backing away to a little further than he was placed;
 * - then a hold on him, and the fade out.
 */

export type Orientation = { x: number; y: number; z: number; w: number };

export interface Pose {
  position: RoomPoint;
  orientation: Orientation;
}

/** The moods sample mode walks through, in the order a select on him steps through them. */
export type DemoMood = 'speaking' | 'listening' | 'thinking' | 'idle';

export interface TimeWindow {
  start: number;
  end: number;
}

export interface DemoScript {
  /** How long the video is, in seconds. */
  seconds: number;
  /** How long the waiting room with its hint is shown before the cut to sample mode. */
  hintSeconds: number;
  /** The glance away from him and back, before the walk has got going. */
  glance: TimeWindow;
  approach: TimeWindow;
  orbit: TimeWindow;
  retreat: TimeWindow;
  /** When he is selected, and the mood that select should bring. */
  selects: readonly { at: number; mood: DemoMood }[];
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

/** The length every time in {@link demoScript} is written for; other lengths scale all of them. */
export const DEFAULT_SECONDS = 36;

/**
 * The shot, stretched or squeezed to `seconds`.
 *
 * Everything scales together, so a short draft still shows every beat — only faster. The fades
 * are the exception: they are there to open and close the film, not to pace it.
 */
export function demoScript(seconds = DEFAULT_SECONDS): DemoScript {
  const scale = seconds / DEFAULT_SECONDS;
  const at = (time: number) => time * scale;
  const window = (start: number, end: number): TimeWindow => ({ start: at(start), end: at(end) });
  return {
    seconds,
    hintSeconds: at(3.5),
    glance: window(5.8, 8.4),
    approach: window(7.6, 11.8),
    orbit: window(11, 27.5),
    retreat: window(27, 31.8),
    selects: [
      { at: at(12.4), mood: 'listening' },
      { at: at(16.6), mood: 'thinking' },
      { at: at(20.8), mood: 'idle' },
      { at: at(26.2), mood: 'speaking' },
    ],
    fadeInSeconds: Math.min(0.6, seconds / 10),
    fadeOutSeconds: Math.min(1, seconds / 10),
  };
}

/**
 * How near the walk comes to his centre, measured along the floor.
 *
 * Arm's length: close enough to see that he is a volume and not a picture, and well outside the
 * distance at which he fades so that nobody walks into him (see {@link closestApproachMetres}).
 */
export const ARM_LENGTH_METRES = 0.8;

/** How far away along the floor the walk back ends: a little further than he was placed. */
export const RETREAT_METRES = 1.9;

/**
 * He fades out when the head comes within 2.5 of his radii of his centre (vr/AGENTS.md, "How
 * he is drawn"), and a walk that grazed that distance would dim him mid-shot.
 */
export const FADE_STARTS_AT_RADII = 2.5;

/** How much further out than the fade the walk stays, as a share of that distance. */
const FADE_MARGIN_SHARE = 0.25;

/**
 * The nearest the head comes to his centre, along the floor: arm's length, unless he was placed so
 * large that arm's length would be inside his fade.
 */
export function closestApproachMetres(radius: number): number {
  return Math.max(ARM_LENGTH_METRES, FADE_STARTS_AT_RADII * radius * (1 + FADE_MARGIN_SHARE));
}

/**
 * How far below the eyes placement puts him when there is room: clamp(eyes − 0.15, 1.1, 1.6) m
 * (vr/AGENTS.md, "Where he stands"). Before he is placed the head looks where he will be, so
 * turning to look at him once he is there is a small correction rather than a swing.
 */
const PLACEMENT_DROP_METRES = 0.15;
const PLACEMENT_LOWEST_METRES = 1.1;
const PLACEMENT_HIGHEST_METRES = 1.6;

/** How far ahead he is placed, which is also how far ahead the head looks before he is there. */
const PLACEMENT_DISTANCE_METRES = 1.6;

/** How long the gaze takes to settle on his centre once he has been placed, in seconds. */
export const LOOK_SETTLE_SECONDS = 1.2;

/** The glance while the room waits: how far to the left the head turns, in radians. */
const GLANCE_RADIANS = 0.09;

/**
 * The glance away from him while he greets: how far the head turns, in radians (negative is to the
 * right, which leaves him on the left of the view).
 *
 * About 29°: far enough that his voice is plainly heard from the left, near enough that he stays
 * well inside the picture's 98° — a look at the room beside him, not a look away from him.
 */
export const LOOK_AWAY_RADIANS = -0.5;

/**
 * How much of the glance's window is spent turning away, and again turning back; the rest is held.
 * The hold is placed on the second greeting, so its first words are heard from the side.
 */
const LOOK_AWAY_TURN_SHARE = 0.3;

/** One step's length, for the walking bob: short, as steps are indoors around something. */
const STRIDE_METRES = 0.34;
/** How far the eyes dip on each step, sway at each stride, and roll with the sway, at full walking speed. */
const BOB_METRES = 0.011;
const SWAY_METRES = 0.006;
const ROLL_RADIANS = 0.004;
/** The speed at which the bob reaches its full size; slower walking bobs proportionally less. */
const WALKING_SPEED_METRES_PER_SECOND = 0.3;

/** Standing still is not frozen: a slow breath, and the drift of a head nobody is holding still. */
const BREATH_METRES = 0.0025;
const BREATH_HERTZ = 0.23;
const DRIFT_METRES = { x: 0.006, y: 0.004 };
const DRIFT_HERTZ = { x: 0.11, y: 0.17 };

/** Where the right controller is held relative to the head: right of, below and ahead of the eyes. */
const HAND_OFFSET = { right: 0.18, down: 0.32, ahead: 0.3 };

/** How finely the walked distance is tabulated for the bob, in samples per second. */
const DISTANCE_SAMPLES_PER_SECOND = 240;

/** How far through `window` the clock is, from 0 to 1. */
function progress(window: TimeWindow, seconds: number): number {
  if (window.end <= window.start) return seconds >= window.end ? 1 : 0;
  const share = (seconds - window.start) / (window.end - window.start);
  return share < 0 ? 0 : share > 1 ? 1 : share;
}

/** Ken Perlin's smootherstep: 0 to 1 with no jolt in speed or acceleration at either end. */
export function smootherstep(share: number): number {
  const clamped = share < 0 ? 0 : share > 1 ? 1 : share;
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

/**
 * 0 to 1 at a steady speed, eased in and out over `rampShare` of the way at each end.
 *
 * A turn eased from end to end (as {@link smootherstep} does) is at almost twice its average
 * speed halfway round; an orbit wants to glide at one speed and only start and stop gently. The
 * speed rises as half a cosine, stays level, and falls again.
 */
export function steadyRamp(share: number, rampShare: number): number {
  const clamped = share < 0 ? 0 : share > 1 ? 1 : share;
  const ramp = Math.min(0.5, Math.max(1e-6, rampShare));
  const speed = 1 / (1 - ramp);
  const rampedPart = (part: number) => part / 2 - (ramp / (2 * Math.PI)) * Math.sin((Math.PI * part) / ramp);
  if (clamped <= ramp) return speed * rampedPart(clamped);
  if (clamped >= 1 - ramp) return 1 - speed * rampedPart(1 - clamped);
  return speed * (ramp / 2 + (clamped - ramp));
}

/** How much of the orbit's time is spent easing in, and again easing out. */
const ORBIT_RAMP_SHARE = 0.2;

/** The head at the start: where the harness stood it, and which way it faces (radians about +Y; 0 is −Z). */
export interface HeadStart {
  position: RoomPoint;
  yaw: number;
}

/** Where he was placed, and when in the video. */
export interface Placement {
  centre: RoomPoint;
  radius: number;
  /** Video seconds at which he was placed. */
  at: number;
}

export interface CameraPath {
  headAt(seconds: number): Pose;
  /** The right controller held in front of the chest, pointing at his centre; undefined before he is placed. */
  handAt(seconds: number): Pose | undefined;
}

function point(x: number, y: number, z: number): RoomPoint {
  return { x, y, z };
}

/** The orientation of something at `eye` looking at `target`, rolled by `roll` radians about the view. */
export function lookingAt(eye: RoomPoint, target: RoomPoint, roll = 0): Orientation {
  const from = new Vector3(eye.x, eye.y, eye.z);
  const to = new Vector3(target.x, target.y, target.z);
  const forward = to.clone().sub(from).normalize();
  const up = new Vector3(0, 1, 0).applyAxisAngle(forward, -roll);
  // Matrix4.lookAt turns +Z away from the target, so −Z — the direction an XR view looks — faces it.
  const rotation = new Matrix4().lookAt(from, to, up);
  const quaternion = new Quaternion().setFromRotationMatrix(rotation);
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

/** The unit direction along the floor that the head faces at `yaw`. */
function facing(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** The slow sway of a head standing still, as an offset of what it looks at. */
function drift(seconds: number): { x: number; y: number } {
  return {
    x: DRIFT_METRES.x * Math.sin(2 * Math.PI * DRIFT_HERTZ.x * seconds + 1.3),
    y: DRIFT_METRES.y * Math.sin(2 * Math.PI * DRIFT_HERTZ.y * seconds + 0.4),
  };
}

function breath(seconds: number): number {
  return BREATH_METRES * Math.sin(2 * Math.PI * BREATH_HERTZ * seconds);
}

/** How far the head has turned away from him at `seconds`, in radians about +Y. */
function lookAwayAt(script: DemoScript, seconds: number): number {
  const share = progress(script.glance, seconds);
  const away = smootherstep(share / LOOK_AWAY_TURN_SHARE) * smootherstep((1 - share) / LOOK_AWAY_TURN_SHARE);
  return LOOK_AWAY_RADIANS * away;
}

/** `target`, swung about the vertical through `eye` by `radians`: the same look, turned. */
function turnedAbout(eye: RoomPoint, target: RoomPoint, radians: number): RoomPoint {
  if (radians === 0) return target;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const alongX = target.x - eye.x;
  const alongZ = target.z - eye.z;
  // A turn about +Y by a positive angle takes −Z towards −X: to the left, as yaw does here.
  return point(eye.x + alongX * cosine + alongZ * sine, target.y, eye.z - alongX * sine + alongZ * cosine);
}

/**
 * The camera for `script`, starting at `start`, around `placement` once he has been placed.
 *
 * Before the placement is known the head stays where the harness stood it, glancing while the room
 * waits and then looking where he will appear. Once it is known the head walks in polar
 * co-ordinates around his centre — distance and bearing, each eased on its own window — so the
 * walk up, the turn and the walk back blend into one curve. The path before the walk is the same
 * with or without the placement, so the path can be rebuilt the moment he is placed without the
 * picture jumping.
 */
export function createCameraPath(script: DemoScript, start: HeadStart, placement?: Placement): CameraPath {
  const eyeHeight = start.position.y;
  const expectedHeight = Math.min(
    PLACEMENT_HIGHEST_METRES,
    Math.max(PLACEMENT_LOWEST_METRES, eyeHeight - PLACEMENT_DROP_METRES),
  );

  /** Where the head looks before he is there: ahead, at the height he will be placed, glancing while the room waits. */
  function lookAheadAt(seconds: number, eye: RoomPoint): RoomPoint {
    const glance = GLANCE_RADIANS * ((1 - Math.cos((2 * Math.PI * seconds) / script.hintSeconds)) / 2);
    const direction = facing(start.yaw + (seconds < script.hintSeconds ? glance : 0));
    return point(
      eye.x + direction.x * PLACEMENT_DISTANCE_METRES,
      expectedHeight,
      eye.z + direction.z * PLACEMENT_DISTANCE_METRES,
    );
  }

  if (placement === undefined) {
    return {
      headAt(seconds) {
        const eye = point(start.position.x, eyeHeight + breath(seconds), start.position.z);
        const sway = drift(seconds);
        const ahead = lookAheadAt(seconds, eye);
        const target = turnedAbout(
          eye,
          point(ahead.x + sway.x, ahead.y + sway.y, ahead.z),
          lookAwayAt(script, seconds),
        );
        return { position: eye, orientation: lookingAt(eye, target) };
      },
      handAt: () => undefined,
    };
  }

  const centre = placement.centre;
  const placedAt = placement.at;
  const startDistance = Math.hypot(start.position.x - centre.x, start.position.z - centre.z);
  const startBearing = Math.atan2(start.position.x - centre.x, start.position.z - centre.z);
  const near = closestApproachMetres(placement.radius);

  /** The head's spot on the floor, before any bob. */
  function groundAt(seconds: number): { x: number; z: number } {
    const distance =
      startDistance +
      (near - startDistance) * smootherstep(progress(script.approach, seconds)) +
      (RETREAT_METRES - near) * smootherstep(progress(script.retreat, seconds));
    const bearing = startBearing + 2 * Math.PI * steadyRamp(progress(script.orbit, seconds), ORBIT_RAMP_SHARE);
    return { x: centre.x + distance * Math.sin(bearing), z: centre.z + distance * Math.cos(bearing) };
  }

  // The distance walked and the speed at every sample, for the bob: its phase follows the steps
  // actually taken, and its size the speed they are taken at, so it fades in and out with the walk.
  const sampleCount = Math.ceil(script.seconds * DISTANCE_SAMPLES_PER_SECOND) + 2;
  const walked = new Float64Array(sampleCount);
  const speeds = new Float64Array(sampleCount);
  let previous = groundAt(0);
  for (let index = 1; index < sampleCount; index += 1) {
    const here = groundAt(index / DISTANCE_SAMPLES_PER_SECOND);
    const step = Math.hypot(here.x - previous.x, here.z - previous.z);
    walked[index] = (walked[index - 1] ?? 0) + step;
    speeds[index] = step * DISTANCE_SAMPLES_PER_SECOND;
    previous = here;
  }
  const sampled = (table: Float64Array, seconds: number) => {
    const position = Math.max(0, Math.min(sampleCount - 1, seconds * DISTANCE_SAMPLES_PER_SECOND));
    const below = Math.floor(position);
    const above = Math.min(sampleCount - 1, below + 1);
    const share = position - below;
    return (table[below] ?? 0) * (1 - share) + (table[above] ?? 0) * share;
  };

  function headAt(seconds: number): Pose {
    const ground = groundAt(seconds);
    const strength = Math.min(1, sampled(speeds, seconds) / WALKING_SPEED_METRES_PER_SECOND);
    const stepPhase = (Math.PI * sampled(walked, seconds)) / STRIDE_METRES;
    const dip = BOB_METRES * strength * ((1 - Math.cos(2 * stepPhase)) / 2);
    const swing = Math.sin(stepPhase);
    const base = point(ground.x, eyeHeight + breath(seconds) - dip, ground.z);

    const sway = drift(seconds);
    const settle = smootherstep((seconds - placedAt) / LOOK_SETTLE_SECONDS);
    const before = lookAheadAt(seconds, base);
    const target = turnedAbout(
      base,
      point(
        before.x + (centre.x - before.x) * settle + sway.x,
        before.y + (centre.y - before.y) * settle + sway.y,
        before.z + (centre.z - before.z) * settle,
      ),
      lookAwayAt(script, seconds),
    );

    // The sway is sideways to where the head looks, so it is worked out from the look before it is applied.
    const lookX = target.x - base.x;
    const lookZ = target.z - base.z;
    const lookLength = Math.hypot(lookX, lookZ) || 1;
    const right = { x: -lookZ / lookLength, z: lookX / lookLength };
    const side = SWAY_METRES * strength * swing;
    const eye = point(base.x + right.x * side, base.y, base.z + right.z * side);
    return { position: eye, orientation: lookingAt(eye, target, ROLL_RADIANS * strength * swing) };
  }

  return {
    headAt,
    handAt(seconds) {
      if (seconds < placedAt) return undefined;
      const head = headAt(seconds).position;
      const alongX = centre.x - head.x;
      const alongZ = centre.z - head.z;
      const length = Math.hypot(alongX, alongZ) || 1;
      const forward = { x: alongX / length, z: alongZ / length };
      const right = { x: -forward.z, z: forward.x };
      const hand = point(
        head.x + right.x * HAND_OFFSET.right + forward.x * HAND_OFFSET.ahead,
        head.y - HAND_OFFSET.down,
        head.z + right.z * HAND_OFFSET.right + forward.z * HAND_OFFSET.ahead,
      );
      return { position: hand, orientation: lookingAt(hand, centre) };
    },
  };
}
