import { useMemo, useRef } from 'react';
import { SILENT_VOICE } from '../sample-mode';
import {
  createSimulatedSpectrum,
  fillSimulatedSpectrum,
  type SimulatedMood,
  simulatedVolume,
} from '../simulated-voice';
import type { JarvisVoice } from '../voice-contract';

/**
 * A voice made up out of the clock, for the moods sample mode can show without a microphone.
 *
 * It is a `JarvisVoice` like any other — the hologram asks it the same two questions every 40 ms
 * and cannot tell it from a real one — so what the sphere does with `speaking` and `thinking` is
 * whatever it would do with a person or with Jarvis doing the same thing. The shapes themselves
 * live in `simulated-voice.ts`, with the rest of how Jarvis behaves. With no mood it is
 * {@link SILENT_VOICE}, and the sphere idles.
 *
 * Timed from when the mood was chosen rather than from when the app started, so a mood always
 * begins at its beginning: speech opens on a syllable, thinking opens at the bottom of a sweep.
 */
export function useSimulatedVoice(mood: SimulatedMood | undefined): JarvisVoice {
  const spectrum = useRef(createSimulatedSpectrum());
  const startedAt = useRef(0);

  return useMemo(() => {
    if (!mood) {
      return SILENT_VOICE;
    }
    startedAt.current = Date.now();
    const read = () => fillSimulatedSpectrum(mood, (Date.now() - startedAt.current) / 1000, spectrum.current);
    return {
      listening: true,
      speaking: true,
      getVolume: () => simulatedVolume(read()),
      getSpectrum: read,
    };
  }, [mood]);
}
