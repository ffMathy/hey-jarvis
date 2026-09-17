import { useConversationControls } from '@elevenlabs/react-native';
import { useMemo } from 'react';
import type { VoiceReaders } from './tapped-voice';

const SILENCE = new Uint8Array(0);

/**
 * The conversation's output audio as the ElevenLabs SDK measures it.
 *
 * The SDK creates its readers on first call, and before a session exists they
 * may throw or return nothing. That has to read as silence, not as a crash on
 * the screen the hologram is drawn on.
 *
 * The readers are memoised apart from the conversation's flags so they stay the
 * same functions while Jarvis switches between speaking and listening — which
 * happens many times a conversation. New readers would restart the hologram's
 * polling, and the restart would show as a dip at the very moment he starts to
 * talk.
 */
export function useSdkVoiceReaders(): VoiceReaders {
  const { getOutputVolume, getOutputByteFrequencyData } = useConversationControls();

  return useMemo(
    () => ({
      getVolume: () => {
        try {
          return getOutputVolume();
        } catch {
          return 0;
        }
      },
      getSpectrum: () => {
        try {
          return getOutputByteFrequencyData() ?? SILENCE;
        } catch {
          return SILENCE;
        }
      },
    }),
    [getOutputVolume, getOutputByteFrequencyData],
  );
}
