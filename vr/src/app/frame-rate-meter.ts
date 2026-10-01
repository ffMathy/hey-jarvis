/**
 * How many frames a second the room is actually getting, for sample mode's readout and the HUD.
 *
 * What is achieved, not what was asked for: the headset may be asked for 90 and deliver 72 when
 * the frame does not fit, and that difference is the thing worth seeing. Counted over the last
 * second of frame times, so it settles within a second of a change and does not flicker frame to
 * frame.
 */

export interface FrameRateMeter {
  /** Records a frame drawn at `time`, in milliseconds. */
  frame(time: number): void;
  /** Frames a second over the last window; 0 until there are two frames to measure between. */
  readonly rate: number;
  /** Milliseconds between the last two frames; 0 until there are two. */
  readonly frameMilliseconds: number;
}

export function createFrameRateMeter(windowMilliseconds = 1000): FrameRateMeter {
  const times: number[] = [];
  return {
    frame(time) {
      times.push(time);
      const oldest = time - windowMilliseconds;
      // Keep one frame older than the window, so the span measured always covers the whole of it.
      while (times.length > 2 && (times[1] ?? time) <= oldest) times.shift();
    },
    get rate() {
      if (times.length < 2) return 0;
      const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
      return span > 0 ? ((times.length - 1) * 1000) / span : 0;
    },
    get frameMilliseconds() {
      return times.length < 2 ? 0 : (times.at(-1) ?? 0) - (times.at(-2) ?? 0);
    },
  };
}
