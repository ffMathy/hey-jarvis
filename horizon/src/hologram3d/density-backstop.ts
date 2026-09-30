/**
 * The one thing that thins him on the headset: a backstop for frames that are being dropped.
 *
 * The phone steers its particle count by how long a picture takes to build on the CPU
 * (`density-control.ts`); here the body is built on the GPU, so that signal is about nothing and
 * the only one left is the frame interval, which a headset quantises — 90 Hz falls straight to 45.
 * A controller cannot steer against a cliff like that, and the body at full density is a few
 * thousand small quads, which should be cheap. So he is drawn in full, and if frames are seen to
 * drop — an interval half again longer than the shortest recent one, three times in thirty frames
 * — the share is halved, and stays halved: flickering back up would only find the cliff again.
 */
export interface DensityBackstop {
  /** Records one frame's interval and says what share of the particles to draw from now on. */
  observe(deltaSeconds: number): number;
  readonly density: number;
}

/** How many frames are looked at together. */
export const BACKSTOP_WINDOW = 30;
/** How many of them have to be late. */
export const BACKSTOP_LATE_FRAMES = 3;
/** How much longer than the shortest interval in the window a late one is. */
export const BACKSTOP_LATE_SHARE = 1.5;
/** The fewest particles he is ever thinned to: an eighth still reads as him. */
export const BACKSTOP_FLOOR = 0.125;
/**
 * An interval this long is a stall — a tab switch, a shader compiled on first use, the headset
 * taken off — rather than a frame the GPU could not finish, and says nothing about the frame rate.
 *
 * No longer than the XR stage's LONGEST_FRAME_SECONDS, because that is where it caps every step
 * it hands on: a stall of any length arrives here as exactly that, and a threshold above it would
 * count every hitch of a summon as a dropped frame. A tenth of a second is still well clear of
 * the slowest real frames, 36 Hz with every other frame of 72 dropped.
 */
const STALL_SECONDS = 0.1;

export function createDensityBackstop(): DensityBackstop {
  let density = 1;
  let intervals: number[] = [];
  return {
    observe(deltaSeconds) {
      if (!(deltaSeconds > 0) || deltaSeconds >= STALL_SECONDS) return density;
      intervals.push(deltaSeconds);
      if (intervals.length < BACKSTOP_WINDOW) return density;
      const shortest = Math.min(...intervals);
      const late = intervals.filter((interval) => interval > shortest * BACKSTOP_LATE_SHARE).length;
      intervals = [];
      if (late >= BACKSTOP_LATE_FRAMES) {
        density = Math.max(BACKSTOP_FLOOR, density / 2);
      }
      return density;
    },
    get density() {
      return density;
    },
  };
}
