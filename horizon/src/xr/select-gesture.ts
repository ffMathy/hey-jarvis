/**
 * Telling a tap from a hold, for XR selects.
 *
 * A select is the one input every Quest has in both hands' forms: a trigger pull on a controller,
 * a pinch on a tracked hand. WebXR reports its start (`selectstart`), its completion (`select`,
 * which carries user activation) and its end (`selectend`, which also fires when the action is
 * cancelled). How long it was held is left to the page — and that is the whole difference between
 * summoning Jarvis and hanging up on him: a hold of {@link HOLD_SECONDS} or more is the hang-up
 * gesture, anything shorter is a tap.
 *
 * **The hold counts the moment it is long enough**, not when it is let go: someone holding the
 * trigger to send him away should see him start to go while they are still holding it, which is
 * what tells them it worked. So the frame loop asks {@link SelectGestures.heldLongEnough} every
 * frame, and the release after a hold that already counted is swallowed.
 *
 * Keyed by input source, so two hands are two gestures. Times are in seconds on any steady clock.
 */

/** How long a select has to be held to count as a hold rather than a tap. */
export const HOLD_SECONDS = 0.8;

export type SelectHold = 'short' | 'long';

export interface SelectGestures<Source> {
  /** A select began (`selectstart`). */
  start(source: Source, now: number): void;
  /** Each frame: the sources whose select has just reached a hold, each reported once per hold. */
  heldLongEnough(now: number): Source[];
  /**
   * A select completed (`select`): a tap, a hold the frame loop had not yet caught (a throttled
   * frame), or nothing, when the hold was already reported.
   */
  complete(source: Source, now: number): SelectHold | undefined;
  /** A select ended or was cancelled (`selectend`); also how a source that has gone is forgotten. */
  end(source: Source): void;
}

interface Pressing {
  since: number;
  reported: boolean;
}

export function createSelectGestures<Source>(holdSeconds: number = HOLD_SECONDS): SelectGestures<Source> {
  const pressing = new Map<Source, Pressing>();
  return {
    start(source, now) {
      pressing.set(source, { since: now, reported: false });
    },
    heldLongEnough(now) {
      const held: Source[] = [];
      for (const [source, press] of pressing) {
        if (press.reported || now - press.since < holdSeconds) continue;
        press.reported = true;
        held.push(source);
      }
      return held;
    },
    complete(source, now) {
      const press = pressing.get(source);
      pressing.delete(source);
      // A completion with no start is a select some runtime reported whole; the only thing it can
      // have been is a tap.
      if (press === undefined) return 'short';
      if (press.reported) return undefined;
      return now - press.since >= holdSeconds ? 'long' : 'short';
    },
    end(source) {
      pressing.delete(source);
    },
  };
}
