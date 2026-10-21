/**
 * The one thing that thins him on the headset: a backstop for frames that are being dropped.
 *
 * The phone steers its particle count by how long a picture takes to build on the CPU
 * (`density-control.ts`); here the body is built on the GPU, so that signal is about nothing and
 * the only one left is the frame interval, which a headset quantises — 90 Hz falls straight to 45.
 * A controller cannot steer against a cliff like that, and the body at full density is a few
 * thousand small quads, which should be cheap. So he is drawn in full, and the share is halved only
 * when frames are seen to drop: an interval half again longer than the shortest in its window,
 * three times in thirty frames, in two windows running.
 *
 * **It used to halve on one such window, and for good,** on the grounds that flickering back up
 * would only find the cliff again. But a summon is full of hitches that are no GPU falling behind:
 * nothing compiles his shaders before his first frame, CanvasKit compiles its own programs as it
 * first meets each kind of path, the display switches from 72 Hz to 90 as he is summoned, and
 * placement, the greeting and the call all start in the same second or two. Three late frames in
 * any third of a second of that thinned him for the rest of the room, and nothing ever gave the
 * particles back. So now:
 *
 * - **What is known to hitch is not judged.** `settle` lets the next {@link BACKSTOP_SETTLE_SECONDS}
 *   of frames go by unread and starts the window afresh. Every summon calls it (`arrive`), and the
 *   room calls it when it asks for a new display rate, whenever the session is hidden, blurred or
 *   shown again, and on every frame the headset's own panels are drawn over the room (blurred).
 * - **A lone bad window is a hitch.** A GPU that cannot hold the count drops frames in the next
 *   window too, so it takes two running to halve him, and a halving starts the count afresh: the
 *   next one needs two more, at the new share. A lone bad window neither thins him nor holds back
 *   the share coming back.
 * - **The share comes back, carefully.** After {@link BACKSTOP_FIRST_WAIT_SECONDS} of frames without
 *   a drop it is doubled, never past all of them. That is a probe, and the cliff may still be there,
 *   so the share given back is on trial for as long as it was waited for: if frames drop during the
 *   trial he is halved again and the next wait is twice as long, up to
 *   {@link BACKSTOP_LONGEST_WAIT_SECONDS}. A headset that really cannot hold the count pays one
 *   hitch — two windows of dropped frames, under a second — every few minutes at most, never the
 *   climb-lag-shed cycle the old rule was afraid of; one that was only busy for a moment has every
 *   particle back ten seconds later. A share that holds through its trial puts the wait back to ten
 *   seconds, since whatever made the last one fail has passed.
 *
 * Every wait and trial is counted in seconds of frames judged, so the time he is away, a stall and a
 * settled second all count for nothing, and nothing here allocates: it is fed every frame.
 */
export interface DensityBackstop {
  /** Records one frame's interval and says what share of the particles to draw from now on. */
  observe(deltaSeconds: number): number;
  /**
   * Leaves the next {@link BACKSTOP_SETTLE_SECONDS} of frames unjudged and starts the window
   * afresh: for whatever is known to hitch, which is not the GPU falling behind.
   */
  settle(): void;
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
 * How long after `settle` frames go unjudged, in seconds of frames.
 *
 * A second covers the switch to a new display rate and the compiles of his first frames, and is
 * still short enough that a GPU really falling behind is caught within two seconds of a summon:
 * the second, then two windows.
 */
export const BACKSTOP_SETTLE_SECONDS = 1;
/** How long the share has to go without frames dropping before it is doubled, the first time. */
export const BACKSTOP_FIRST_WAIT_SECONDS = 10;
/**
 * The longest that wait grows to, doubling each time a share given back dropped frames again: a
 * headset that never holds the count pays for a probe every 160 seconds, and no more often.
 */
export const BACKSTOP_LONGEST_WAIT_SECONDS = 160;
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
  // The window's intervals, in one array for the backstop's whole life.
  const intervals = new Float64Array(BACKSTOP_WINDOW);
  let filled = 0;
  let unjudgedSeconds = 0;
  let lastWindowLate = false;
  let waitSeconds = BACKSTOP_FIRST_WAIT_SECONDS;
  /** Seconds of frames judged since frames last dropped or the share was last given back. */
  let steadySeconds = 0;
  /** Whether the share was given back and has not yet held for as long as it was waited for. */
  let onTrial = false;

  /** How many of the window's frames are late, against the fastest of them. */
  function lateFrames() {
    let shortest = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < BACKSTOP_WINDOW; frame++) shortest = Math.min(shortest, intervals[frame]);
    let late = 0;
    for (let frame = 0; frame < BACKSTOP_WINDOW; frame++) {
      if (intervals[frame] > shortest * BACKSTOP_LATE_SHARE) late += 1;
    }
    return late;
  }

  function windowSeconds() {
    let seconds = 0;
    for (let frame = 0; frame < BACKSTOP_WINDOW; frame++) seconds += intervals[frame];
    return seconds;
  }

  /** Frames dropped: the share is halved, and if it was a share given back still on trial, the next wait doubles. */
  function halve() {
    density = Math.max(BACKSTOP_FLOOR, density / 2);
    steadySeconds = 0;
    if (onTrial) waitSeconds = Math.min(BACKSTOP_LONGEST_WAIT_SECONDS, waitSeconds * 2);
    onTrial = false;
  }

  /** Another window without frames dropping: once there have been enough of them, the share comes back. */
  function holdSteady(seconds: number) {
    steadySeconds += seconds;
    if (steadySeconds < waitSeconds) return;
    if (onTrial) {
      // Held for as long as it was waited for: whatever made the last share fail has passed.
      onTrial = false;
      waitSeconds = BACKSTOP_FIRST_WAIT_SECONDS;
    }
    if (density >= 1) return;
    density = Math.min(1, density * 2);
    steadySeconds = 0;
    onTrial = true;
  }

  function judgeWindow() {
    const windowLate = lateFrames() >= BACKSTOP_LATE_FRAMES;
    const dropping = windowLate && lastWindowLate;
    // A halving starts the count afresh: the next takes two more bad windows, at the new share.
    lastWindowLate = windowLate && !dropping;
    if (dropping) halve();
    else holdSteady(windowSeconds());
    filled = 0;
  }

  return {
    observe(deltaSeconds) {
      if (!(deltaSeconds > 0)) return density;
      if (unjudgedSeconds > 0) {
        unjudgedSeconds -= deltaSeconds;
        return density;
      }
      if (deltaSeconds >= STALL_SECONDS) return density;
      intervals[filled] = deltaSeconds;
      filled += 1;
      if (filled === BACKSTOP_WINDOW) judgeWindow();
      return density;
    },
    settle() {
      unjudgedSeconds = BACKSTOP_SETTLE_SECONDS;
      filled = 0;
      lastWindowLate = false;
    },
    get density() {
      return density;
    },
  };
}
