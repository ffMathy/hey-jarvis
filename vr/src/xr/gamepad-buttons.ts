/**
 * The controllers' buttons, read from their gamepads.
 *
 * In WebXR's `xr-standard` mapping a Touch controller's trigger is `buttons[0]`, its grip
 * `buttons[1]`, the thumbstick's press `buttons[3]`, the lower face button — A on the right hand, X
 * on the left — `buttons[4]` and the upper one — B or Y — `buttons[5]`; the thumbstick's forward and
 * back is `axes[3]`, negative forward. There is no event for a gamepad button: the page is handed the
 * gamepad's state every frame and has to notice for itself when a button goes from up to down. A
 * {@link ButtonWatcher} does that for one button, per input source, so one press is one action
 * however many frames the button is held for.
 *
 * The room uses B and Y to send Jarvis away, A and X to open and close placing things in the room,
 * and the trigger, the grip and the thumbstick to take, carry and drop them.
 */

/** Where the trigger sits: a select, and the far drop while placing things. */
export const TRIGGER_BUTTON_INDEX = 0;

/** Where the grip sits: the near grab while placing things. */
export const SQUEEZE_BUTTON_INDEX = 1;

/** Where A (right hand) and X (left hand) sit: they open and close placing things. */
export const EDIT_BUTTON_INDEX = 4;

/** Where B (right hand) and Y (left hand) sit: they send Jarvis away, and close placing things. */
export const DISMISS_BUTTON_INDEX = 5;

/** Where the thumbstick's forward and back sit among the axes: −1 fully forward, 1 fully back. */
export const THUMBSTICK_FORWARD_AXIS_INDEX = 3;

/** The part of a gamepad this reads: whether each button is down, and the axes when there are any. */
export interface GamepadLike {
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes?: readonly number[];
}

/** Whether button `index` of `gamepad` is down; a missing gamepad or button is up. */
export function isButtonDown(gamepad: GamepadLike | null | undefined, index: number): boolean {
  return gamepad?.buttons[index]?.pressed ?? false;
}

/**
 * Notices each press of one button, once.
 *
 * Keyed by whatever identifies the input source — the `XRInputSource` itself in the app, since
 * the browser keeps the same object for as long as the controller stays connected — so the two
 * hands are told apart and a button held on one does not swallow a press on the other.
 */
export interface ButtonWatcher<Source> {
  /**
   * Reads this frame's state of one source's gamepad, and says whether the button went down since
   * the last frame it was read. A source with no gamepad (a hand) or a gamepad too short to have
   * the button counts as the button being up.
   */
  pressed(source: Source, gamepad: GamepadLike | null | undefined): boolean;
  /** Forgets a source that has gone, so a controller reconnected with the button held counts as a press. */
  forget(source: Source): void;
}

/** A watcher for the button at `index` of every source's gamepad. */
export function createButtonWatcher<Source>(index: number): ButtonWatcher<Source> {
  const wasDown = new Map<Source, boolean>();
  return {
    pressed(source, gamepad) {
      const down = isButtonDown(gamepad, index);
      const before = wasDown.get(source) ?? false;
      wasDown.set(source, down);
      return down && !before;
    },
    forget(source) {
      wasDown.delete(source);
    },
  };
}
