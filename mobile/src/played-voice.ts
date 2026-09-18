import { createVoiceAnalyser, type JarvisVoiceReaders, type VoiceAnalyser, type VoiceReading } from 'hologram';

/** What a played voice reads from: a window onto the audio a browser is playing right now. */
export interface PlayedAudioSource {
  /** The rate the audio is being played at. */
  sampleRate(): number;
  /** How many samples {@link PlayedAudioSource.readLatest} writes — exactly the length it is given. */
  sampleCount(): number;
  /**
   * Writes that many of the most recent samples, oldest first, as floats between −1 and 1.
   *
   * The buffer is the one Web Audio insists on: `getFloatTimeDomainData` takes a `Float32Array`
   * over a plain `ArrayBuffer`, not one that might be shared.
   */
  readLatest(into: Float32Array<ArrayBuffer>): void;
}

const SILENCE = new Uint8Array(0);

/**
 * Readings this close together share one analysis, for the reason `tapped-voice.ts` gives: the
 * hologram asks for the volume and then the spectrum in the same breath.
 */
const SHARED_READING_MS = 10;

/** Web Audio's own limits on `fftSize`, which is the window a reading is taken over. */
const SMALLEST_WINDOW = 32;
const LARGEST_WINDOW = 32768;

/**
 * The `fftSize` an `AnalyserNode` needs before it can hand over a whole reading at `sampleRate`.
 *
 * `getFloatTimeDomainData` fills the buffer it is given from the *start* of its window, so a
 * buffer shorter than `fftSize` comes back holding the oldest audio rather than the newest. The
 * window therefore has to be sized to the analysis rather than the other way round: the smallest
 * power of two that holds everything {@link createVoiceAnalyser} looks at.
 */
export function readingWindowSize(sampleRate: number): number {
  const wanted = createVoiceAnalyser(sampleRate).sampleCount;
  let size = SMALLEST_WINDOW;
  while (size < wanted && size < LARGEST_WINDOW) {
    size *= 2;
  }
  return size;
}

/**
 * Jarvis's voice as the browser is actually playing it, analysed here rather than asked of the SDK.
 *
 * **The SDK's own answer is not a loudness.** `getOutputVolume` is the mean of an `AnalyserNode`'s
 * byte spectrum, and a byte of that spectrum is a decibel reading between −100 dB and −30 dB. So
 * the quietest thing the scale can express is −100 dB and everything above it reads as *something*
 * — the hiss under a recording, the comfort noise a codec sends between words, the room a voice
 * was recorded in. Read as a level, that says Jarvis is talking whenever a conversation is open,
 * which is how the sphere came to throw chips through his silences: the gaps between his words
 * never reached the floor, so the tracker never saw one.
 *
 * This reads the samples instead, through the same {@link createVoiceAnalyser} the phone uses on
 * its tapped track: the volume is the RMS of the last 40 ms, where silence is silence, and the
 * spectrum is taken from the same audio in the same breath. Which means the numbers mean the same
 * thing on a phone and in a browser, and `QUIETEST_SPEECH` means one thing rather than two.
 *
 * Before any audio has arrived — the track just subscribed, nothing playing yet — both readings
 * are silence, which is the truth.
 */
export function createPlayedVoiceReaders(
  source: PlayedAudioSource,
  now: () => number = () => performance.now(),
): JarvisVoiceReaders {
  let analyser: VoiceAnalyser | undefined;
  let samples = new Float32Array(0);
  let reading: VoiceReading | undefined;
  let readAt = Number.NEGATIVE_INFINITY;

  const refresh = (): VoiceReading | undefined => {
    const time = now();
    const elapsed = time - readAt;
    // A clock that went backwards is not a reading still fresh: re-read, rather
    // than serve the old one until the clock catches up.
    if (elapsed >= 0 && elapsed < SHARED_READING_MS) {
      return reading;
    }
    readAt = time;

    const sampleRate = source.sampleRate();
    const sampleCount = source.sampleCount();
    if (!(sampleRate > 0) || !(sampleCount > 0)) {
      reading = undefined;
      return reading;
    }

    if (analyser?.sampleRate !== sampleRate) {
      analyser = createVoiceAnalyser(sampleRate);
    }
    if (samples.length !== sampleCount) {
      samples = new Float32Array(sampleCount);
    }

    source.readLatest(samples);
    reading = analyser.analyse(samples);
    return reading;
  };

  return {
    getVolume: () => refresh()?.volume ?? 0,
    getSpectrum: () => refresh()?.spectrum ?? SILENCE,
  };
}
