import { createDismissButtonWatcher } from './dismiss-button';
import { type Ray, rayFromPose } from './ray';
import { createSelectGestures, HOLD_SECONDS, type SelectHold } from './select-gesture';

/**
 * The room's input, read from the session: selects told apart into taps and holds, each with the
 * ray it was made along, and presses of the B and Y buttons.
 *
 * Selects are the session's own events. A tap is reported inside the `select` event, so whatever
 * the app does about it runs while the event's user activation still counts — which is what lets a
 * tap focus the keyboard's textarea, resume audio or reopen the microphone. A hold is reported from
 * the frame loop, the frame it reaches {@link HOLD_SECONDS}, with the ray from that frame.
 *
 * The buttons have no events at all; their state is read from each controller's gamepad every
 * frame (`dismiss-button.ts`).
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
  const buttons = createDismissButtonWatcher<XRInputSource>();
  const selectListeners = new Set<(select: XrSelect) => void>();
  const buttonListeners = new Set<(source: XRInputSource) => void>();
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
      buttons.forget(source);
    }
  };

  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('selectend', onSelectEnd);
  session.addEventListener('select', onSelect);
  session.addEventListener('inputsourceschange', onSourcesChange);

  return {
    update(frame, space) {
      for (const source of gestures.heldLongEnough(seconds())) {
        emitSelect({ hold: 'long', ray: rayOf(frame, source, space), source });
      }
      for (const source of session.inputSources) {
        if (!buttons.pressed(source, source.gamepad)) continue;
        for (const listener of buttonListeners) listener(source);
      }
    },
    onSelect(listener) {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    onDismissButton(listener) {
      buttonListeners.add(listener);
      return () => buttonListeners.delete(listener);
    },
    dispose() {
      session.removeEventListener('selectstart', onSelectStart);
      session.removeEventListener('selectend', onSelectEnd);
      session.removeEventListener('select', onSelect);
      session.removeEventListener('inputsourceschange', onSourcesChange);
      selectListeners.clear();
      buttonListeners.clear();
    },
  };
}
