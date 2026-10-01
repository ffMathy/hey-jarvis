/**
 * Sample mode's make-believe, out of a clock alone: Jarvis speaking or working, and someone talking
 * to him, as the voices the hologram follows.
 *
 * One implementation for all three devices. The phone and the watch reach it through
 * `useSimulatedVoice` and `useSimulatedUser` (`react/use-simulated-voice.ts`), which hold on to
 * what it hands back until the mood changes; the headset's `vr/src/app/sample-driver.ts` calls
 * {@link createSampleDrive} whenever its mood changes. So the room walks the same moods looking the
 * same as the phone does. The shapes themselves are in `simulated-voice.ts`.
 *
 * Nothing here keeps a clock of its own. The time comes from `now`, in milliseconds — `Date.now` on
 * the phone and the watch, the page's clock on the headset, a number moved by hand in the tests —
 * and every voice is timed from the moment it was made rather than from when the app started, so a
 * mood always begins at its beginning: speech on a syllable, thinking at the bottom of a sweep, the
 * listening phase on the start of a phrase.
 *
 * Read where a voice is read — the JS thread, every 40 ms — and never on the UI thread, so, like
 * `simulated-voice.ts`, nothing here is a worklet.
 */
import { hearsSomeone, moodOf, type SampleMode, SILENT_VOICE } from './sample-mode';
import { fillSimulatedSpectrum, type SimulatedMood, simulatedUserAt } from './simulated-voice';
import { simulatedVolume } from './voice-analysis';
import type { JarvisVoice, UserVoice } from './voice-contract';

/** What sample mode hands the hologram: whose voice to follow, who is talking to him, and whether he is thinking. */
export interface SampleDrive {
  voice: JarvisVoice;
  user: UserVoice | undefined;
  thinking: boolean;
}

/** Sample mode with no mood chosen: silent, with nobody talking to him and nothing on his mind. */
export const SAMPLE_SILENCE: SampleDrive = { voice: SILENT_VOICE, user: undefined, thinking: false };

/**
 * Jarvis in `mood`, made up out of the clock from this moment on, or {@link SILENT_VOICE} with no
 * mood, in which case the sphere idles.
 *
 * `spectrum` is filled on every reading and handed back as the spectrum, so a voice read 25 times a
 * second allocates nothing. Make it once, with `createSimulatedSpectrum`, for each place that reads.
 */
export function simulatedJarvisVoice(
  mood: SimulatedMood | undefined,
  now: () => number,
  spectrum: Uint8Array,
): JarvisVoice {
  if (mood === undefined) {
    return SILENT_VOICE;
  }
  const startedAt = now();
  const read = () => fillSimulatedSpectrum(mood, (now() - startedAt) / 1000, spectrum);
  return {
    listening: true,
    speaking: true,
    getVolume: () => simulatedVolume(read()),
    getSpectrum: read,
  };
}

/** Someone talking to Jarvis — sample mode's listening phase — made up out of the clock from this moment on. */
export function simulatedUserVoice(now: () => number): UserVoice {
  const startedAt = now();
  const seconds = () => (now() - startedAt) / 1000;
  return {
    getPresence: () => simulatedUserAt(seconds()).presence,
    getVolume: () => simulatedUserAt(seconds()).volume,
  };
}

/** Everything sample mode hands the hologram for `mode`, from the mode's beginning. */
export function createSampleDrive(mode: SampleMode, now: () => number, spectrum: Uint8Array): SampleDrive {
  return {
    voice: simulatedJarvisVoice(moodOf(mode), now, spectrum),
    // Listening is the one mood where it is somebody else talking: he is silent and hears them.
    user: hearsSomeone(mode) ? simulatedUserVoice(now) : undefined,
    thinking: mode === 'thinking',
  };
}
