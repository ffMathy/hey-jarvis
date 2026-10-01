import { describe, expect, it } from 'bun:test';
import {
  createButtonWatcher,
  DISMISS_BUTTON_INDEX,
  EDIT_BUTTON_INDEX,
  type GamepadLike,
  isButtonDown,
} from './gamepad-buttons';

/** A Touch controller's gamepad with only the button at `index` in the given state. */
function gamepad(index: number, down: boolean): GamepadLike {
  return { buttons: Array.from({ length: 7 }, (_, button) => ({ pressed: button === index && down })) };
}

describe('createButtonWatcher', () => {
  it('reports a press once, on the frame the button goes down', () => {
    const watcher = createButtonWatcher<string>(DISMISS_BUTTON_INDEX);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, false))).toBe(false);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(true);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(false);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(false);
  });

  it('reports the next press after the button has come back up', () => {
    const watcher = createButtonWatcher<string>(DISMISS_BUTTON_INDEX);
    watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true));
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, false))).toBe(false);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(true);
  });

  it('keeps the two hands apart', () => {
    const watcher = createButtonWatcher<string>(DISMISS_BUTTON_INDEX);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(true);
    // Y on the left goes down while B on the right is still held: a press of its own.
    expect(watcher.pressed('left', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(true);
    expect(watcher.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(false);
  });

  it('treats a hand, or a gamepad without the button, as the button being up', () => {
    const watcher = createButtonWatcher<string>(DISMISS_BUTTON_INDEX);
    expect(watcher.pressed('hand', null)).toBe(false);
    expect(watcher.pressed('hand', undefined)).toBe(false);
    // A tracked hand's gamepad has its pinch alone.
    expect(watcher.pressed('short', { buttons: [{ pressed: true }] })).toBe(false);
  });

  it('watches its own button and no other', () => {
    const dismiss = createButtonWatcher<string>(DISMISS_BUTTON_INDEX);
    const edit = createButtonWatcher<string>(EDIT_BUTTON_INDEX);
    const everythingButDismiss: GamepadLike = {
      buttons: Array.from({ length: 7 }, (_, index) => ({ pressed: index !== DISMISS_BUTTON_INDEX })),
    };
    expect(dismiss.pressed('right', everythingButDismiss)).toBe(false);
    expect(edit.pressed('right', everythingButDismiss)).toBe(true);
    expect(edit.pressed('right', gamepad(DISMISS_BUTTON_INDEX, true))).toBe(false);
  });

  it('counts a held button as a new press once the source has been forgotten', () => {
    const watcher = createButtonWatcher<string>(EDIT_BUTTON_INDEX);
    watcher.pressed('right', gamepad(EDIT_BUTTON_INDEX, true));
    watcher.forget('right');
    expect(watcher.pressed('right', gamepad(EDIT_BUTTON_INDEX, true))).toBe(true);
  });
});

describe('isButtonDown', () => {
  it('reads one button, and counts anything missing as up', () => {
    expect(isButtonDown(gamepad(EDIT_BUTTON_INDEX, true), EDIT_BUTTON_INDEX)).toBe(true);
    expect(isButtonDown(gamepad(EDIT_BUTTON_INDEX, true), DISMISS_BUTTON_INDEX)).toBe(false);
    expect(isButtonDown(undefined, 0)).toBe(false);
    expect(isButtonDown({ buttons: [] }, 0)).toBe(false);
  });
});
