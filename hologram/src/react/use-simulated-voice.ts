import { useMemo, useRef } from 'react';
import { SILENT_VOICE } from '../sample-mode';
import {
  createSimulatedSpectrum,
  fillSimulatedSpectrum,
  type SimulatedMood,
  simulatedUserAt,
} from '../simulated-voice';
import { simulatedVolume } from '../voice-analysis';
import type { JarvisVoice, UserVoice } from '../voice-contract';

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

/**
 * Someone talking to Jarvis, made up out of the clock — sample mode's listening phase. Undefined
 * when `active` is false, which is what tells the hologram nobody is. Timed from when it was
 * switched on, so the phase always opens on the start of a phrase.
 */
export function useSimulatedUser(active: boolean): UserVoice | undefined {
  const startedAt = useRef(0);

  return useMemo(() => {
    if (!active) {
      return undefined;
    }
    startedAt.current = Date.now();
    const now = () => simulatedUserAt((Date.now() - startedAt.current) / 1000);
    return {
      getPresence: () => now().presence,
      getVolume: () => now().volume,
    };
  }, [active]);
}
