import { useConversationControls, useConversationInput } from '@elevenlabs/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** A line of the conversation, as the SDK's `onMessage` reports it. */
interface ConversationMessage {
  message: string;
  role: string;
}

interface TextModeOptions {
  /** Whether the session is connected, which is when the mode can be applied to it. */
  connected: boolean;
  /** Called on every switch, either way: whatever was written on screen belongs to the other mode. */
  onSwitch: () => void;
  /** What to do with a line of the conversation while it is held in writing. */
  remember: (incoming: ConversationMessage) => void;
}

/**
 * Whether a phone's voice conversation is being held in writing instead: tapping Jarvis toggles it.
 *
 * **A phone cannot switch to the text-only session a browser falls back to** —
 * `@elevenlabs/react-native` refuses WebSocket sessions on a device — so the voice session stays up
 * and is made into a written one: the microphone is muted, his voice turned down to nothing, the
 * field put under him and his answers written above it, with the sphere miming them from the clock
 * exactly as it does in a browser's text-only session. Tapping him again undoes all of it.
 *
 * **It is never remembered.** Every conversation starts in voice — the screen calls `resetTextMode`
 * as it starts one — because the gesture that summons him is a request to be talked to, and a mode
 * left over from the last time would make him silently ignore it.
 *
 * The mode is applied to the session whenever it is connected rather than at the tap, because a tap
 * can come while he is still greeting and the session is not up yet; it takes effect the moment it
 * is. Only on a phone: a browser keeps its field always, and its own text-only session for a
 * refused microphone.
 */
export function useTextMode({ connected, onSwitch, remember }: TextModeOptions) {
  const { setVolume } = useConversationControls();
  const { setMuted } = useConversationInput();
  const [textMode, setTextMode] = useState(false);
  /** The same fact, for the session's message callback, which must see it without a render. */
  const inTextMode = useRef(false);

  const switchTo = useCallback(
    (next: boolean) => {
      inTextMode.current = next;
      setTextMode(next);
      onSwitch();
    },
    [onSwitch],
  );
  const toggleTextMode = useCallback(() => switchTo(!inTextMode.current), [switchTo]);
  const resetTextMode = useCallback(() => switchTo(false), [switchTo]);

  /** What he said, kept only while the conversation is being held in writing. For `onMessage`. */
  const rememberInTextMode = useCallback(
    (incoming: ConversationMessage) => {
      if (inTextMode.current) {
        remember(incoming);
      }
    },
    [remember],
  );

  useEffect(() => {
    if (Platform.OS === 'web' || !connected) {
      return;
    }
    try {
      setMuted(textMode);
      setVolume({ volume: textMode ? 0 : 1 });
    } catch {
      // The session went between the status and this; the next one starts in voice anyway.
    }
  }, [textMode, connected, setMuted, setVolume]);

  return { textMode, toggleTextMode, resetTextMode, rememberInTextMode };
}
