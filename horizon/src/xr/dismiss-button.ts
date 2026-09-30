/**
 * The controllers' B and Y buttons, as a way to send Jarvis away.
 *
 * On a Touch controller the upper face button is B on the right hand and Y on the left, and in
 * WebXR's `xr-standard` mapping both are `buttons[5]` of that hand's gamepad (the trigger is 0,
 * the grip 1, the thumbstick press 3, the lower face button — A or X — 4). There is no event for
 * a gamepad button: the page is handed the gamepad's state every frame and has to notice for
 * itself when a button goes from up to down. That is all this does, per input source, so one
 * press is one dismissal however many frames the button is held for.
 */

/** Where B (right hand) and Y (left hand) sit in the `xr-standard` gamepad mapping. */
export const DISMISS_BUTTON_INDEX = 5;

/** The part of a gamepad this reads: whether each button is down. */
export interface GamepadLike {
  readonly buttons: readonly { readonly pressed: boolean }[];
}

/**
 * Notices each press of B or Y, once.
 *
 * Keyed by whatever identifies the input source — the `XRInputSource` itself in the app, since
 * the browser keeps the same object for as long as the controller stays connected — so the two
 * hands are told apart and a button held on one does not swallow a press on the other.
 */
export interface DismissButtonWatcher<Source> {
  /**
   * Reads this frame's state of one source's gamepad, and says whether B or Y went down since
   * the last frame it was read. A source with no gamepad (a hand) or a gamepad too short to have
   * the button counts as the button being up.
   */
  pressed(source: Source, gamepad: GamepadLike | null | undefined): boolean;
  /** Forgets a source that has gone, so a controller reconnected with the button held counts as a press. */
  forget(source: Source): void;
}

export function createDismissButtonWatcher<Source>(): DismissButtonWatcher<Source> {
  const wasDown = new Map<Source, boolean>();
  return {
    pressed(source, gamepad) {
      const down = gamepad?.buttons[DISMISS_BUTTON_INDEX]?.pressed ?? false;
      const before = wasDown.get(source) ?? false;
      wasDown.set(source, down);
      return down && !before;
    },
    forget(source) {
      wasDown.delete(source);
    },
  };
}
