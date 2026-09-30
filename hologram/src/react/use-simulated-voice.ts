import { useMemo, useRef } from 'react';
import { simulatedJarvisVoice, simulatedUserVoice } from '../sample-drive';
import { createSimulatedSpectrum, type SimulatedMood } from '../simulated-voice';
import type { JarvisVoice, UserVoice } from '../voice-contract';

/**
 * A voice made up out of the clock, for the moods sample mode can show without a microphone.
 *
 * It is a `JarvisVoice` like any other — the hologram asks it the same two questions every 40 ms
 * and cannot tell it from a real one — so what the sphere does with `speaking` and `thinking` is
 * whatever it would do with a person or with Jarvis doing the same thing. The voice itself is
 * `simulatedJarvisVoice` from the main entry, which the headset's sample mode uses too, and the
 * shapes live in `simulated-voice.ts`, with the rest of how Jarvis behaves. With no mood it is
 * `SILENT_VOICE`, and the sphere idles.
 *
 * Made again whenever the mood changes, so a mood always begins at its beginning: speech opens on
 * a syllable, thinking opens at the bottom of a sweep.
 */
export function useSimulatedVoice(mood: SimulatedMood | undefined): JarvisVoice {
  const spectrum = useRef(createSimulatedSpectrum());
  return useMemo(() => simulatedJarvisVoice(mood, Date.now, spectrum.current), [mood]);
}

/**
 * Someone talking to Jarvis, made up out of the clock — sample mode's listening phase. Undefined
 * when `active` is false, which is what tells the hologram nobody is. Made again whenever it is
 * switched on, so the phase always opens on the start of a phrase.
 */
export function useSimulatedUser(active: boolean): UserVoice | undefined {
  return useMemo(() => (active ? simulatedUserVoice(Date.now) : undefined), [active]);
}
