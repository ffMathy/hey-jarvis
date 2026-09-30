import { type ButtonWatcher, createButtonWatcher, DISMISS_BUTTON_INDEX, EDIT_BUTTON_INDEX } from './gamepad-buttons';
import { type Ray, rayFromPose } from './ray';
import { createSelectGestures, HOLD_SECONDS, type SelectHold } from './select-gesture';

/**
 * The room's input, read from the session: selects told apart into taps and holds, each with the
 * ray it was made along, and presses of the B and Y buttons and of the A and X buttons.
 *
 * Selects are the session's own events. A tap is reported inside the `select` event, so whatever
 * the app does about it runs while the event's user activation still counts — which is what lets a
 * tap focus the keyboard's textarea, resume audio or reopen the microphone. A hold is reported from
 * the frame loop, the frame it reaches {@link HOLD_SECONDS}, with the ray from that frame.
 *
 * The buttons have no events at all; their state is read from each controller's gamepad every
 * frame (`gamepad-buttons.ts`). What the hands and controllers are doing between those — pinching,
 * pointing, squeezing, where they are — is `input-snapshots.ts`'s.
 */

export interface XrSelect {
  hold: SelectHold;
  /** Along the controller's laser or the hand's emulated ray, when the frame had a pose for it. */
  ray: Ray | undefined;
  source: XRInputSource;
}

export interface XrInput {
  /** Reads holds and buttons for this frame. Call once per frame, from the frame loop. */
  update(frame: XRFrame, space: XRReferenceSpace): void;
  onSelect(listener: (select: XrSelect) => void): () => void;
  onDismissButton(listener: (source: XRInputSource) => void): () => void;
  /** A or X went down: they open placing things in the room, and close it again. */
  onEditButton(listener: (source: XRInputSource) => void): () => void;
  /**
   * Spends every select under way, so neither its release nor the hold it would become is reported:
   * the press has already done what it was for (`select-gesture.ts`).
   */
  consumeHeld(): void;
  dispose(): void;
}

/** The ray `source` points along in `frame`, or undefined when there is no pose for it. */
function rayOf(frame: XRFrame, source: XRInputSource, space: XRReferenceSpace): Ray | undefined {
  try {
    const pose = frame.getPose(source.targetRaySpace, space);
    return pose === undefined ? undefined : rayFromPose(pose.transform);
  } catch {
    // The frame an event carries is only active during its dispatch; outside it there is no pose.
    return undefined;
  }
}

export function createXrInput(
  session: XRSession,
  referenceSpace: XRReferenceSpace,
  now: () => number = () => performance.now(),
): XrInput {
  const gestures = createSelectGestures<XRInputSource>(HOLD_SECONDS);
  const dismissButtons = createButtonWatcher<XRInputSource>(DISMISS_BUTTON_INDEX);
  const editButtons = createButtonWatcher<XRInputSource>(EDIT_BUTTON_INDEX);
  const selectListeners = new Set<(select: XrSelect) => void>();
  const dismissListeners = new Set<(source: XRInputSource) => void>();
  const editListeners = new Set<(source: XRInputSource) => void>();
  const seconds = () => now() / 1000;

  function emitSelect(select: XrSelect) {
    for (const listener of selectListeners) listener(select);
  }

  const onSelectStart = (event: XRInputSourceEvent) => gestures.start(event.inputSource, seconds());
  const onSelectEnd = (event: XRInputSourceEvent) => gestures.end(event.inputSource);
  const onSelect = (event: XRInputSourceEvent) => {
    const hold = gestures.complete(event.inputSource, seconds());
    if (hold === undefined) return;
    emitSelect({ hold, ray: rayOf(event.frame, event.inputSource, referenceSpace), source: event.inputSource });
  };
  const onSourcesChange = (event: XRInputSourcesChangeEvent) => {
    for (const source of event.removed) {
      gestures.end(source);
      dismissButtons.forget(source);
      editButtons.forget(source);
    }
  };

  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('selectend', onSelectEnd);
  session.addEventListener('select', onSelect);
  session.addEventListener('inputsourceschange', onSourcesChange);

  /** Tells `listeners` about each source whose button `watcher` saw go down this frame. */
  function readButton(watcher: ButtonWatcher<XRInputSource>, listeners: Set<(source: XRInputSource) => void>) {
    for (const source of session.inputSources) {
      if (!watcher.pressed(source, source.gamepad)) continue;
      for (const listener of listeners) listener(source);
    }
  }

  return {
    update(frame, space) {
      for (const source of gestures.heldLongEnough(seconds())) {
        emitSelect({ hold: 'long', ray: rayOf(frame, source, space), source });
      }
      readButton(dismissButtons, dismissListeners);
      readButton(editButtons, editListeners);
    },
    onSelect(listener) {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    onDismissButton(listener) {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
    onEditButton(listener) {
      editListeners.add(listener);
      return () => editListeners.delete(listener);
    },
    consumeHeld() {
      gestures.consumeHeld(seconds());
    },
    dispose() {
      session.removeEventListener('selectstart', onSelectStart);
      session.removeEventListener('selectend', onSelectEnd);
      session.removeEventListener('select', onSelect);
      session.removeEventListener('inputsourceschange', onSourcesChange);
      selectListeners.clear();
      dismissListeners.clear();
      editListeners.clear();
    },
  };
}
