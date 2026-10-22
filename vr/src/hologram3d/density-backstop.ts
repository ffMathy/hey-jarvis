/**
 * The one thing that thins him on the headset: a backstop for frames that are being dropped.
 *
 * The phone steers its particle count by how long a picture takes to build on the CPU
 * (`density-control.ts`); here the body is built on the GPU, so that signal is about nothing and
 * the only one left is the frame interval, which a headset quantises — 90 Hz falls straight to 45.
 * A controller cannot steer against a cliff like that, and the body at full density is a few
 * thousand small quads, which should be cheap. So he is drawn in full, and the share is halved only
 * when frames are seen to drop: an interval three quarters again longer than a frame on time (see
 * {@link BACKSTOP_LATE_SHARE}), three times in a window of thirty frames, beside a window with at
 * least two.
 *
 * **A frame on time is the display's own period, when the headset says what it is**
 * (`XRSession.frameRate`, handed in with every frame). It used to be the shortest interval in the
 * window being judged, and a cliff is exactly what that cannot see: once a headset has fallen from
 * 90 Hz to a clean 45, every frame of the next window takes 2/90 of a second, the shortest among them
 * included, so not one of them is late. Only the window the fall happened in ever was. Where the
 * rate is not known — older runtimes, the emulator — it is the shortest on-time interval seen since
 * the last settle, kept from one window to the next for the same reason: each window's eighth
 * shortest (see `ON_TIME_RANK`), so that stray short intervals cannot pass for the display's rate and
 * make every frame after them late. Without the rate, a summon that lands straight on half the
 * display's rate is not caught, since nothing on time was seen to judge it by; with it, it is.
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
 *   window too, so it takes a late window beside one late or nearly so to halve him, and a halving
 *   starts the count afresh: the next one needs two more, at the new share. A lone bad window
 *   neither thins him nor holds back the share coming back, though it never decides a trial: the
 *   window after it does.
 * - **The share comes back, carefully.** After {@link BACKSTOP_FIRST_WAIT_SECONDS} of frames without
 *   a drop it is doubled, never past all of them. That is a probe, and the cliff may still be there,
 *   so the share given back is on trial for as long as it was waited for: if frames drop during the
 *   trial he is halved again and the next wait is twice as long, up to
 *   {@link BACKSTOP_LONGEST_WAIT_SECONDS}. A headset that really cannot hold the count pays one
 *   hitch — two windows of dropped frames, under a second — for each probe: ten, twenty, forty and
 *   eighty seconds apart in each room, then one every 160 seconds at most, never the
 *   climb-lag-shed cycle the old rule was afraid of. One that was only busy for a moment has the
 *   particles back a doubling at a time: a single halving ten seconds later, a fall to the floor in
 *   about thirty. A share that holds through its trial puts the wait back to ten seconds, since
 *   whatever made the last one fail has passed.
 *
 * Every wait and trial is counted in seconds of frames judged, so the time he is away, a stall and a
 * settled second all count for nothing, and nothing here allocates: it is fed every frame.
 */
export interface DensityBackstop {
  /**
   * Records one frame's interval and says what share of the particles to draw from now on.
   * `displayRate` is the display's own rate in hertz, when the headset says what it is.
   */
  observe(deltaSeconds: number, displayRate?: number): number;
  /**
   * Leaves the next {@link BACKSTOP_SETTLE_SECONDS} of frames unjudged and starts the window
   * afresh: for whatever is known to hitch, which is not the GPU falling behind.
   */
  settle(): void;
  readonly density: number;
}

/** How many frames are looked at together. */
export const BACKSTOP_WINDOW = 30;
/** How many of them make a window late; the window beside it must have one fewer, at least. */
export const BACKSTOP_LATE_FRAMES = 3;
/**
 * How much longer than a frame on time a late one is: three quarters again.
 *
 * A display shows whole frames, so a dropped one takes at least two periods, and anything short of
 * that is a frame on time that ran a little late. It was half again, and 1.5 periods of 90 Hz is
 * exactly a 60 Hz frame: the emulator on an ordinary monitor, which says 90 and delivers 60, sat on
 * the line, and rounding alone decided which of its frames were late.
 */
export const BACKSTOP_LATE_SHARE = 1.75;
/**
 * Which of a window's intervals, shortest first, stands for a frame on time when the display's
 * rate is not known: the eighth, a quarter of the way up. A callback that runs late hands the next
 * one a short interval, so the shortest few can be well under the display's period; as the
 * reference they made every frame on time after them late, until the next settle. A quarter of the
 * way up is past seven of those and still on time in a window half of whose frames were dropped.
 */
const ON_TIME_RANK = BACKSTOP_WINDOW >> 2;
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
 * The longest that wait grows to, doubling each time a share given back dropped frames again: once
 * the waits have doubled up to it, a headset that never holds the count pays for a probe every 160
 * seconds, and no more often.
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
  // The window's intervals, and a copy to put in order, in two arrays for the backstop's whole life.
  const intervals = new Float64Array(BACKSTOP_WINDOW);
  const ordered = new Float64Array(BACKSTOP_WINDOW);
  let filled = 0;
  let unjudgedSeconds = 0;
  /** How many frames of the last window were late, or 0 when it does not count: after a halving or a settle. */
  let previousLateFrames = 0;
  let waitSeconds = BACKSTOP_FIRST_WAIT_SECONDS;
  /** Seconds of frames judged since frames last dropped or the share was last given back. */
  let steadySeconds = 0;
  /** Whether the share was given back and has not yet held for as long as it was waited for. */
  let onTrial = false;
  /** The display's own period, from the rate last handed in, or 0 while the headset has not said. */
  let displaySeconds = 0;
  /** The shortest on-time interval seen since the last settle: what a frame on time takes, when the rate is not known. */
  let onTimeSeconds = Number.POSITIVE_INFINITY;

  /** A frame on time in this window, from its intervals alone: see {@link ON_TIME_RANK}. */
  function windowOnTime() {
    ordered.set(intervals);
    ordered.sort();
    return ordered[ON_TIME_RANK];
  }

  /** How many of the window's frames are late, against a frame on time. */
  function lateFrames(onTime: number) {
    let late = 0;
    for (let frame = 0; frame < BACKSTOP_WINDOW; frame++) {
      if (intervals[frame] > onTime * BACKSTOP_LATE_SHARE) late += 1;
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

  /**
   * Another window without frames dropping: once there have been enough of them, the share comes
   * back. A late window counts towards the wait, so a lone hitch holds nothing back, but never
   * decides it: the next window says whether it was a hitch or the share failing, and a share given
   * back that was failing must be halved on trial, not passed and doubled.
   */
  function holdSteady(seconds: number, late: boolean) {
    steadySeconds += seconds;
    if (late || steadySeconds < waitSeconds) return;
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
    onTimeSeconds = Math.min(onTimeSeconds, windowOnTime());
    const late = lateFrames(displaySeconds > 0 ? displaySeconds : onTimeSeconds);
    // A late window beside one that is late, or nearly: a GPU just behind its budget drops frames on
    // a steady beat — one in twelve, say — and a beat like that puts three in one window and two in
    // the next for as long as it lasts, so two late windows running would never come.
    const dropping =
      Math.max(late, previousLateFrames) >= BACKSTOP_LATE_FRAMES &&
      Math.min(late, previousLateFrames) >= BACKSTOP_LATE_FRAMES - 1;
    // A halving starts the count afresh: the next takes two more bad windows, at the new share.
    previousLateFrames = dropping ? 0 : late;
    if (dropping) halve();
    else holdSteady(windowSeconds(), late >= BACKSTOP_LATE_FRAMES);
    filled = 0;
  }

  return {
    observe(deltaSeconds, displayRate) {
      displaySeconds = displayRate !== undefined && displayRate > 0 ? 1 / displayRate : 0;
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
      previousLateFrames = 0;
      // What was on time before may not be now: a settle is often a new display rate.
      onTimeSeconds = Number.POSITIVE_INFINITY;
    },
    get density() {
      return density;
    },
  };
}
