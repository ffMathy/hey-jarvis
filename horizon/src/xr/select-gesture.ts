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
 * **A press that already did something is spent.** The drawer's Done is pressed on the way down of
 * a trigger or a pinch, from the frame loop, and the room stops placing things there and then; the
 * same select's release, or the hold it would become, would otherwise be read in the room that
 * follows — and summon him. {@link SelectGestures.consumeHeld} spends every select under way.
 *
 * Keyed by input source, so two hands are two gestures. Times are in seconds on any steady clock.
 */

/** How long a select has to be held to count as a hold rather than a tap. */
export const HOLD_SECONDS = 0.8;

/**
 * How long after {@link SelectGestures.consumeHeld} a select that only then starts is still taken as
 * part of the press that was spent.
 *
 * A hand's pinch is read twice: by the room, from the joints, and by the headset, which starts the
 * select. The two measure it differently, so the room's reading can press a button a frame or two
 * before the headset's select for the same pinch begins. Nobody lets go and pinches again within a
 * third of a second to ask for something new.
 */
export const LATE_START_SECONDS = 0.3;

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
  /**
   * Spends every select under way at `now`: neither its hold nor its release will be reported, and
   * neither will a select that starts within {@link LATE_START_SECONDS}. For a press that has already
   * done what it was for.
   */
  consumeHeld(now: number): void;
}

interface Pressing {
  since: number;
  /** Whether nothing more is reported for it: its hold already was, or the press was spent. */
  spent: boolean;
}

export function createSelectGestures<Source>(holdSeconds: number = HOLD_SECONDS): SelectGestures<Source> {
  const pressing = new Map<Source, Pressing>();
  /** Until when a select that starts belongs to the press spent last. */
  let spentUntil = Number.NEGATIVE_INFINITY;
  return {
    start(source, now) {
      pressing.set(source, { since: now, spent: now < spentUntil });
    },
    heldLongEnough(now) {
      const held: Source[] = [];
      for (const [source, press] of pressing) {
        if (press.spent || now - press.since < holdSeconds) continue;
        press.spent = true;
        held.push(source);
      }
      return held;
    },
    complete(source, now) {
      const press = pressing.get(source);
      pressing.delete(source);
      // A completion with no start is a select some runtime reported whole; the only thing it can
      // have been is a tap — unless it came so soon after a press was spent that it is that press.
      if (press === undefined) return now < spentUntil ? undefined : 'short';
      if (press.spent) return undefined;
      return now - press.since >= holdSeconds ? 'long' : 'short';
    },
    end(source) {
      pressing.delete(source);
    },
    consumeHeld(now) {
      for (const press of pressing.values()) press.spent = true;
      spentUntil = now + LATE_START_SECONDS;
    },
  };
}
