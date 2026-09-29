/**
 * What the app shows the browser tests through `window.__jarvis`.
 *
 * The room is a WebGL canvas, so there is nothing in the DOM a test can read to see whether
 * Jarvis is where he should be or is still being drawn. This is that window: a plain object
 * the app keeps current and a Playwright spec reads with `page.evaluate`. It is on in every
 * build, because it costs one assignment a frame and the published site is exactly what the
 * e2e suite exercises; nothing reads it but the tests.
 */

/** Where the app is: on the 2D page, getting into the room, or in it. */
export type JarvisPhase = 'loading' | 'unsupported' | 'ready' | 'entering' | 'in-room' | 'failed';

/** Which kind of surface CanvasKit is drawing the hologram into. */
export type HologramSurfaceKind = 'webgl' | 'cpu';

/** A point in the session's `local-floor` space, in metres. */
export interface RoomPoint {
  x: number;
  y: number;
  z: number;
}

export interface JarvisDebugState {
  phase: JarvisPhase;
  /** Frames drawn in the room since the session started. */
  frames: number;
  /** Where the centre of the hologram is, once he has been placed. */
  hologramPosition: RoomPoint | null;
  /** Where the viewer's head was when he was placed. */
  headPositionAtPlacement: RoomPoint | null;
  surface: HologramSurfaceKind | null;
  /** The last thing that went wrong, as shown on the page. */
  problem: string | null;
}

declare global {
  interface Window {
    __jarvis?: JarvisDebugState;
  }
}

/** The state the page starts in, before anything has been checked. */
export function initialDebugState(): JarvisDebugState {
  return {
    phase: 'loading',
    frames: 0,
    hologramPosition: null,
    headPositionAtPlacement: null,
    surface: null,
    problem: null,
  };
}

/** A plain copy of `point`, so the hook holds data rather than a live three.js vector. */
export function toRoomPoint(point: RoomPoint): RoomPoint {
  return { x: point.x, y: point.y, z: point.z };
}

/** Publishes `state` as `window.__jarvis`, and returns it so the caller keeps writing to the same object. */
export function publishDebugState(state: JarvisDebugState): JarvisDebugState {
  window.__jarvis = state;
  return state;
}
