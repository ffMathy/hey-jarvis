import { describe, expect, it } from 'bun:test';
import { createSelectGestures, HOLD_SECONDS, LATE_START_SECONDS } from './select-gesture';

describe('createSelectGestures', () => {
  it('calls a quick select a tap', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    expect(gestures.heldLongEnough(10.3)).toEqual([]);
    expect(gestures.complete('right', 10.3)).toBe('short');
  });

  it('reports a hold the frame it becomes one, and only once', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    expect(gestures.heldLongEnough(10 + HOLD_SECONDS - 0.01)).toEqual([]);
    expect(gestures.heldLongEnough(10 + HOLD_SECONDS)).toEqual(['right']);
    expect(gestures.heldLongEnough(12)).toEqual([]);
  });

  it('swallows the release of a hold that was already reported', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    gestures.heldLongEnough(11);
    expect(gestures.complete('right', 11.5)).toBeUndefined();
  });

  it('still calls it a hold when no frame came in time to catch it', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    expect(gestures.complete('right', 10 + HOLD_SECONDS)).toBe('long');
  });

  it('keeps two hands apart', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('left', 10);
    gestures.start('right', 10.5);
    expect(gestures.heldLongEnough(10 + HOLD_SECONDS)).toEqual(['left']);
    expect(gestures.complete('right', 10.9)).toBe('short');
    expect(gestures.complete('left', 11)).toBeUndefined();
  });

  it('forgets a select that was cancelled', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    gestures.end('right');
    expect(gestures.heldLongEnough(20)).toEqual([]);
  });

  it('calls a completion with no start a tap', () => {
    expect(createSelectGestures<string>().complete('transient', 5)).toBe('short');
  });

  it('starts timing again from each new select', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    gestures.complete('right', 10.2);
    gestures.start('right', 11);
    expect(gestures.heldLongEnough(11.5)).toEqual([]);
    expect(gestures.heldLongEnough(11 + HOLD_SECONDS)).toEqual(['right']);
  });

  it('reports nothing more for a select spent while it was held: neither its hold nor its release', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    gestures.consumeHeld(10.2);
    expect(gestures.heldLongEnough(10 + HOLD_SECONDS + 1)).toEqual([]);
    expect(gestures.complete('right', 12)).toBeUndefined();
  });

  it('spends a quick release as well, the way a Quest reports a trigger that pressed a button', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('left', 10);
    gestures.start('right', 10.1);
    gestures.consumeHeld(10.2);
    expect(gestures.complete('left', 10.3)).toBeUndefined();
    expect(gestures.complete('right', 10.3)).toBeUndefined();
  });

  it(`spends a select that starts within ${LATE_START_SECONDS} s, as part of the press already under way`, () => {
    const gestures = createSelectGestures<string>();
    gestures.consumeHeld(10);
    gestures.start('right', 10 + LATE_START_SECONDS / 2);
    expect(gestures.complete('right', 10 + LATE_START_SECONDS)).toBeUndefined();
    // A completion reported whole, as the emulator reports one, is spent the same way.
    expect(gestures.complete('left', 10 + LATE_START_SECONDS / 2)).toBeUndefined();
  });

  it('counts every select that starts later again', () => {
    const gestures = createSelectGestures<string>();
    gestures.start('right', 10);
    gestures.consumeHeld(10.2);
    gestures.complete('right', 10.4);
    gestures.start('right', 10.2 + LATE_START_SECONDS);
    expect(gestures.complete('right', 10.5 + LATE_START_SECONDS)).toBe('short');
    expect(gestures.complete('left', 11 + LATE_START_SECONDS)).toBe('short');
  });

  it('takes the hold length it is given', () => {
    const gestures = createSelectGestures<string>(2);
    gestures.start('right', 0);
    expect(gestures.heldLongEnough(1.5)).toEqual([]);
    expect(gestures.complete('right', 1.9)).toBe('short');
  });
});
