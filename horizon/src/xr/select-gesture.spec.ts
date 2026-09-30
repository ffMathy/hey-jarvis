import { describe, expect, it } from 'bun:test';
import { createSelectGestures, HOLD_SECONDS } from './select-gesture';

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

  it('takes the hold length it is given', () => {
    const gestures = createSelectGestures<string>(2);
    gestures.start('right', 0);
    expect(gestures.heldLongEnough(1.5)).toEqual([]);
    expect(gestures.complete('right', 1.9)).toBe('short');
  });
});
