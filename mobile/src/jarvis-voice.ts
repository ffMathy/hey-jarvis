import { useConversationControls, useConversationMode, useConversationStatus } from '@elevenlabs/react-native';
import { useMemo } from 'react';

/**
 * Jarvis's voice, as far as anything drawn from it needs to know.
 *
 * One module, so it can be swapped whole: the device check in
 * `.scripts/verify-hologram-on-emulator.sh` builds the app with
 * `tests/hologram-preview/jarvis-voice.replay.ts` in its place, because an
 * emulator has no ElevenLabs session to listen to. Everything downstream — the
 * folding, the easing, the drawing — is then what a phone runs. (The readings
 * themselves are not: see "The hologram on a device" in mobile/AGENTS.md.)
 */
export interface JarvisVoice {
  /** Whether a conversation is open. Nothing is read from the voice otherwise. */
  listening: boolean;
  /** Whether Jarvis is talking right now, rather than waiting for the user. */
  speaking: boolean;
  /** RMS volume of what Jarvis is saying, 0–1. */
  getVolume: () => number;
  /** Byte spectrum of it, 0–255 per bin across 100–8000 Hz. Empty when there is nothing to report. */
  getSpectrum: () => ArrayLike<number>;
}

const SILENCE = new Uint8Array(0);

/**
 * The conversation's output audio, as the SDK measures it.
 *
 * On Android these readers are native LiveKit processors on the agent's WebRTC
 * track; in a browser, an AnalyserNode. The SDK creates them on first call, and
 * before a session exists they may throw or return nothing — which has to read as
 * silence, not as a crash on the screen the hologram is drawn on.
 */
export function useJarvisVoice(): JarvisVoice {
  const { getOutputVolume, getOutputByteFrequencyData } = useConversationControls();
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();

  // The readers are kept apart from the flags so they stay the same functions
  // while Jarvis switches between speaking and listening — which happens many
  // times a conversation. New readers would restart the hologram's polling, and
  // the restart would show as a dip at the very moment he starts to talk.
  const readers = useMemo(
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

  const listening = status === 'connected';
  return { listening, speaking: listening && mode === 'speaking', ...readers };
}
