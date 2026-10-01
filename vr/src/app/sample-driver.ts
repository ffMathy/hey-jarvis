import {
  createSampleDrive,
  createSimulatedSpectrum,
  SAMPLE_SILENCE,
  type SampleDrive,
  type SampleMode,
} from 'hologram';

/**
 * Sample mode's make-believe: Jarvis speaking, listening, thinking and idle, from the clock alone.
 *
 * What each mood hands the hologram is hologram's `createSampleDrive`, the same code the phone's
 * and the watch's `useSimulatedVoice` and `useSimulatedUser` are built on, so the room walks the
 * same moods, in the same order, looking the same. This only remembers which mood is showing.
 * Nothing listens and nothing is sent anywhere: every voice here is a function of time.
 *
 * Each mood is made again when it is chosen, so it starts at its beginning — speech on a syllable,
 * thinking at the bottom of a sweep — as it does on the phone.
 */
export interface SampleDriver {
  /** Switches to `mode`, from its beginning. */
  setMode(mode: SampleMode): void;
  /** Back to silence. */
  stop(): void;
  readonly mode: SampleMode | undefined;
  /** The drive for the current mood; the same objects until the mood changes. */
  drive(): SampleDrive;
}

/** A driver on the clock `now`, in milliseconds. */
export function createSampleDriver(now: () => number): SampleDriver {
  // One spectrum for every mood, filled on each reading, so reading the voice allocates nothing.
  const spectrum = createSimulatedSpectrum();
  let mode: SampleMode | undefined;
  let current: SampleDrive = SAMPLE_SILENCE;

  return {
    setMode(chosen) {
      mode = chosen;
      current = createSampleDrive(chosen, now, spectrum);
    },
    stop() {
      mode = undefined;
      current = SAMPLE_SILENCE;
    },
    get mode() {
      return mode;
    },
    drive() {
      return current;
    },
  };
}
