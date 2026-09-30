import { describe, expect, it } from 'bun:test';
import { createDismissButtonWatcher, DISMISS_BUTTON_INDEX, type GamepadLike } from './dismiss-button';

/** A Touch controller's gamepad with only B or Y (the upper face button) in the given state. */
function gamepad(dismissDown: boolean): GamepadLike {
  return {
    buttons: Array.from({ length: 7 }, (_, index) => ({ pressed: index === DISMISS_BUTTON_INDEX && dismissDown })),
  };
}

describe('createDismissButtonWatcher', () => {
  it('reports a press once, on the frame the button goes down', () => {
    const watcher = createDismissButtonWatcher<string>();
    expect(watcher.pressed('right', gamepad(false))).toBe(false);
    expect(watcher.pressed('right', gamepad(true))).toBe(true);
    expect(watcher.pressed('right', gamepad(true))).toBe(false);
    expect(watcher.pressed('right', gamepad(true))).toBe(false);
  });

  it('reports the next press after the button has come back up', () => {
    const watcher = createDismissButtonWatcher<string>();
    watcher.pressed('right', gamepad(true));
    expect(watcher.pressed('right', gamepad(false))).toBe(false);
    expect(watcher.pressed('right', gamepad(true))).toBe(true);
  });

  it('keeps the two hands apart', () => {
    const watcher = createDismissButtonWatcher<string>();
    expect(watcher.pressed('right', gamepad(true))).toBe(true);
    // Y on the left goes down while B on the right is still held: a press of its own.
    expect(watcher.pressed('left', gamepad(true))).toBe(true);
    expect(watcher.pressed('right', gamepad(true))).toBe(false);
  });

  it('treats a hand, or a gamepad without the button, as the button being up', () => {
    const watcher = createDismissButtonWatcher<string>();
    expect(watcher.pressed('hand', null)).toBe(false);
    expect(watcher.pressed('hand', undefined)).toBe(false);
    expect(watcher.pressed('short', { buttons: [{ pressed: true }] })).toBe(false);
  });

  it('ignores the other buttons', () => {
    const watcher = createDismissButtonWatcher<string>();
    const everythingButDismiss: GamepadLike = {
      buttons: Array.from({ length: 7 }, (_, index) => ({ pressed: index !== DISMISS_BUTTON_INDEX })),
    };
    expect(watcher.pressed('right', everythingButDismiss)).toBe(false);
  });

  it('counts a held button as a new press once the source has been forgotten', () => {
    const watcher = createDismissButtonWatcher<string>();
    watcher.pressed('right', gamepad(true));
    watcher.forget('right');
    expect(watcher.pressed('right', gamepad(true))).toBe(true);
  });
});
