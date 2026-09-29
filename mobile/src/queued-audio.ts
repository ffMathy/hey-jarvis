import { useRawConversation } from '@elevenlabs/react-native';
import { agentAudioTracks, flushQueuedAudio } from 'hologram';
import { useEffect, useMemo, useRef } from 'react';
import { roomOfConversation } from './agent-audio-track';

/**
 * Handlers for `startSession` that keep a cut-off sentence from being heard twice.
 *
 * What an interruption leaves queued, and how it is dropped, is `flushQueuedAudio` in
 * `hologram/src/queued-audio.ts`, shared with the headset. What is this app's is only how the
 * conversation is reached: through the React provider, and this app's own `Room` check.
 *
 * Shaped like `useToolActivity`'s: one memoised object of callbacks, spread into the session,
 * which holds them for its lifetime. The conversation is read through a ref rather than closed
 * over, so the handlers stay the same functions while it comes and goes — a new object would mean
 * a new session.
 */
export function useQueuedAudio() {
  const conversation = useRawConversation();
  const conversationNow = useRef<object | undefined>(undefined);

  useEffect(() => {
    conversationNow.current = conversation ?? undefined;
  }, [conversation]);

  const playbackHandlers = useMemo(
    () => ({
      onInterruption: () => {
        const conversationThen = conversationNow.current;
        const room = conversationThen ? roomOfConversation(conversationThen) : undefined;
        if (room) {
          flushQueuedAudio(agentAudioTracks(room));
        }
      },
    }),
    [],
  );

  return { playbackHandlers };
}
