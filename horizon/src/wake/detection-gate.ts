/**
 * When a wake score becomes a wake: over the threshold, while armed, and not too soon.
 *
 * openWakeWord's own debouncing is not ported. Its `patience` option never fires in the current
 * package — the frames it zeroes are written back into the buffer it counts from, so no run of
 * high scores can build up (the research confirmed it on a clip scoring over 0.5 for 7 frames:
 * no detection at patience 1 or 2). What the headset needs is simpler anyway: one wake per
 * "hey jarvis", and none for a moment after being armed, so the tail of his own voice or the
 * user's last words cannot summon him straight back.
 */

/** openWakeWord's models were all trained to work at 0.5 (its README). */
export const WAKE_THRESHOLD = 0.5;

/** Chunks after a wake, or after arming, before the next wake: 25 × 80 ms = 2 s. */
export const REFRACTORY_CHUNKS = 25;

export interface DetectionGate {
  readonly armed: boolean;
  /** Detections on, with the refractory period starting now. */
  arm(): void;
  /** Detections off. */
  disarm(): void;
  /** One chunk's score; true when it is a wake. Call once per chunk that was scored. */
  observe(score: number): boolean;
}

export function createDetectionGate(threshold = WAKE_THRESHOLD, refractoryChunks = REFRACTORY_CHUNKS): DetectionGate {
  let armed = false;
  // Counted in scored chunks rather than wall-clock time: it is audio that has to pass, and a
  // worker that fell behind for a moment should not shorten the pause.
  let chunksSinceQuiet = 0;

  return {
    get armed() {
      return armed;
    },
    arm() {
      armed = true;
      chunksSinceQuiet = 0;
    },
    disarm() {
      armed = false;
    },
    observe(score) {
      chunksSinceQuiet++;
      if (!armed || score < threshold || chunksSinceQuiet <= refractoryChunks) return false;
      chunksSinceQuiet = 0;
      return true;
    },
  };
}
