import { createVoiceAnalyser, type VoiceAnalyser, type VoiceReading } from './voice-analysis';

/** The part of the native audio module (`modules/jarvis-audio`) a tapped voice reads from. */
export interface AudioTapSource {
  sampleRate(): number;
  readLatest(sampleCount: number): Uint8Array;
}

/** How a voice is read, as the hologram asks for it. */
export interface VoiceReaders {
  getVolume: () => number;
  getSpectrum: () => ArrayLike<number>;
}

const SILENCE = new Uint8Array(0);

/**
 * Readings this close together share one analysis. The hologram asks for the
 * volume and then the spectrum in the same breath, and analysing the same audio
 * twice would only double the work.
 */
const SHARED_READING_MS = 10;

/**
 * Decodes 16-bit little-endian samples into floats between −1 and 1, into the
 * end of `into` — the newest ones, if there are more than fit — and says how many
 * there were.
 */
export function decodeSamples(bytes: Uint8Array, into: Float32Array): number {
  const count = Math.min(into.length, Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstByte = Math.floor(bytes.byteLength / 2) * 2 - count * 2;
  const firstSlot = into.length - count;
  for (let sample = 0; sample < count; sample++) {
    into[firstSlot + sample] = view.getInt16(firstByte + sample * 2, true) / 32768;
  }
  return count;
}

/**
 * A voice read from raw audio kept natively: each reading takes the latest
 * samples and analyses them in JavaScript (see `voice-analysis.ts`).
 *
 * Before any audio has arrived — the recorder still starting, a track not yet
 * playing — both readings are silence.
 */
export function createTappedVoiceReaders(
  source: AudioTapSource,
  now: () => number = () => performance.now(),
): VoiceReaders {
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
    if (!(sampleRate > 0)) {
      reading = undefined;
      return reading;
    }

    if (analyser?.sampleRate !== sampleRate) {
      analyser = createVoiceAnalyser(sampleRate);
      samples = new Float32Array(analyser.sampleCount);
    }

    const count = decodeSamples(source.readLatest(analyser.sampleCount), samples);
    reading = analyser.analyse(samples.subarray(samples.length - count));
    return reading;
  };

  return {
    getVolume: () => refresh()?.volume ?? 0,
    getSpectrum: () => refresh()?.spectrum ?? SILENCE,
  };
}
