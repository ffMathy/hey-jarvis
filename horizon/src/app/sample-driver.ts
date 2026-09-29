import {
  createSimulatedSpectrum,
  fillSimulatedSpectrum,
  hearsSomeone,
  type JarvisVoice,
  moodOf,
  type SampleMode,
  SILENT_VOICE,
  simulatedUserAt,
  simulatedVolume,
  type UserVoice,
} from 'hologram';

/**
 * Sample mode's make-believe: Jarvis speaking, listening, thinking and idle, from the clock alone.
 *
 * The headset's copy of what `hologram/react/sample` does for the phone and the watch with hooks,
 * built from the same framework-free exports — `moodOf`, `hearsSomeone`, `fillSimulatedSpectrum`,
 * `simulatedUserAt` — so the room walks the same moods, in the same order, looking the same.
 * Nothing listens and nothing is sent anywhere: every voice here is a function of time.
 *
 * Timed from when the mood was chosen rather than from when the room opened, so each mood starts
 * at its beginning — speech on a syllable, thinking at the bottom of a sweep — as it does on the
 * phone.
 */

/** What sample mode hands the hologram each frame. */
export interface SampleDrive {
  voice: JarvisVoice;
  user: UserVoice | undefined;
  thinking: boolean;
}

export interface SampleDriver {
  /** Switches to `mode`, from its beginning. */
  setMode(mode: SampleMode): void;
  /** Back to silence. */
  stop(): void;
  readonly mode: SampleMode | undefined;
  /** The drive for the current mood; the same objects until the mood changes. */
  drive(): SampleDrive;
}

const SILENCE: SampleDrive = { voice: SILENT_VOICE, user: undefined, thinking: false };

/** A driver on the clock `now`, in milliseconds. */
export function createSampleDriver(now: () => number): SampleDriver {
  const spectrum = createSimulatedSpectrum();
  let mode: SampleMode | undefined;
  let current: SampleDrive = SILENCE;

  function driveFor(chosen: SampleMode): SampleDrive {
    const startedAt = now();
    const seconds = () => (now() - startedAt) / 1000;
    const mood = moodOf(chosen);
    let voice: JarvisVoice = SILENT_VOICE;
    if (mood !== undefined) {
      const read = () => fillSimulatedSpectrum(mood, seconds(), spectrum);
      voice = { listening: true, speaking: true, getVolume: () => simulatedVolume(read()), getSpectrum: read };
    }
    // Listening is the one mood where it is somebody else talking: he is silent and hears them.
    const user: UserVoice | undefined = hearsSomeone(chosen)
      ? { getPresence: () => simulatedUserAt(seconds()).presence, getVolume: () => simulatedUserAt(seconds()).volume }
      : undefined;
    return { voice, user, thinking: chosen === 'thinking' };
  }

  return {
    setMode(chosen) {
      mode = chosen;
      current = driveFor(chosen);
    },
    stop() {
      mode = undefined;
      current = SILENCE;
    },
    get mode() {
      return mode;
    },
    drive() {
      return current;
    },
  };
}
