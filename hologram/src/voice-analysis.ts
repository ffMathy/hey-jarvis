/**
 * Hearing a voice the way the hologram expects to be told about it.
 *
 * The hologram reads two numbers from whatever it listens to: an RMS volume, and
 * a byte spectrum of 1024 values spanning 100–8000 Hz on Web Audio's
 * `AnalyserNode` scale (−100 dB reads 0, −30 dB reads 255). In a browser the
 * ElevenLabs SDK provides both. On Android it does not provide them usably — its
 * LiveKit processors hand back a mostly empty comb of a spectrum, and a volume
 * read with the bytes of every sample swapped (see "The hologram on a device" in
 * mobile/AGENTS.md) — so the app takes the raw samples itself and turns them into
 * those two numbers here, in plain TypeScript: the same code that builds the
 * emulator check's replayed voice, and that `bun test` runs.
 *
 * Everything is allocated once per analyser. It runs 25 times a second while the
 * hologram listens, and a phone should not collect garbage at that rate.
 */

/** How many values the spectrum has. The same as the SDK's, so the folding downstream never has to know which it got. */
export const SPECTRUM_BIN_COUNT = 1024;

/**
 * The loudest a made-up voice gets — a syllable, or the greeting's loudest moment — as a mean of the spectrum: 0.25, which arrives as 0.9.
 *
 * Not 1. A voice that saturates on every syllable gives the drawing nothing to tell a loud one
 * from a quiet one with, and the glow is meant to breathe over a sentence.
 */
export const SPEAKING_LOUDEST = 0.25;

/**
 * The volume that goes with a spectrum: its mean, 0–1.
 *
 * The same quantity a browser reports — see `sample-voice.web.ts` — rather than the RMS a phone
 * measures, because a simulated voice has no waveform to take an RMS of. The moods above are
 * pitched so that it does not matter which gate they are judged against.
 */
export function simulatedVolume(spectrum: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < spectrum.length; index++) {
    sum += spectrum[index] ?? 0;
  }
  return spectrum.length === 0 ? 0 : sum / spectrum.length / 255;
}
/** The span the spectrum covers, also the SDK's. */
export const SPECTRUM_LOWEST_FREQUENCY = 100;
export const SPECTRUM_HIGHEST_FREQUENCY = 8000;

/** `AnalyserNode`'s default range, which is what a byte of spectrum means. */
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;

/** The volume is the RMS of this much of the most recent audio: one reading's worth. */
export const VOLUME_WINDOW_SECONDS = 0.04;
/**
 * The rate the spectrum is taken at. Everything above 8 kHz is thrown away
 * anyway, so audio arriving faster — a phone records at 48 kHz — is averaged
 * down to this first: a third of the samples, a quarter of the FFT, and the same
 * resolution whatever the microphone's rate.
 */
export const ANALYSIS_SAMPLE_RATE = 16000;
/**
 * How many samples each spectrum is taken over, at {@link ANALYSIS_SAMPLE_RATE}:
 * 128 ms, long enough to resolve the low harmonics of a voice and short enough
 * that a syllable still moves it.
 */
const FFT_SIZE = 2048;

export interface VoiceReading {
  /** RMS of the most recent {@link VOLUME_WINDOW_SECONDS}, 0–1. */
  volume: number;
  /** {@link SPECTRUM_BIN_COUNT} values, 0–255. Owned by the analyser and overwritten by the next call. */
  spectrum: Uint8Array;
}

export interface VoiceAnalyser {
  readonly sampleRate: number;
  /** How many of the most recent samples {@link VoiceAnalyser.analyse} looks at. */
  readonly sampleCount: number;
  /**
   * Reads the end of `samples` — floats between −1 and 1, oldest first. Fewer than
   * {@link VoiceAnalyser.sampleCount} are treated as silence before them.
   */
  analyse(samples: Float32Array): VoiceReading;
}

/** Everything a radix-2 FFT of one size needs, computed once. */
interface FourierTables {
  size: number;
  window: Float64Array;
  reversed: Uint32Array;
  cosines: Float64Array;
  sines: Float64Array;
}

function createFourierTables(size: number): FourierTables {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }

  const reversed = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let index = 0; index < size; index++) {
    let reversedIndex = 0;
    for (let bit = 0; bit < bits; bit++) {
      reversedIndex = (reversedIndex << 1) | ((index >> bit) & 1);
    }
    reversed[index] = reversedIndex;
  }

  const cosines = new Float64Array(size / 2);
  const sines = new Float64Array(size / 2);
  for (let index = 0; index < size / 2; index++) {
    cosines[index] = Math.cos((-2 * Math.PI * index) / size);
    sines[index] = Math.sin((-2 * Math.PI * index) / size);
  }

  return { size, window, reversed, cosines, sines };
}

/** One pass of the in-place FFT, combining neighbouring blocks of `length` values. */
function combineBlocks(tables: FourierTables, real: Float64Array, imaginary: Float64Array, length: number): void {
  const half = length / 2;
  const tableStep = tables.size / length;
  for (let start = 0; start < tables.size; start += length) {
    for (let offset = 0; offset < half; offset++) {
      const cosine = tables.cosines[offset * tableStep] ?? 1;
      const sine = tables.sines[offset * tableStep] ?? 0;
      const near = start + offset;
      const far = near + half;
      const farReal = (real[far] ?? 0) * cosine - (imaginary[far] ?? 0) * sine;
      const farImaginary = (real[far] ?? 0) * sine + (imaginary[far] ?? 0) * cosine;
      real[far] = (real[near] ?? 0) - farReal;
      imaginary[far] = (imaginary[near] ?? 0) - farImaginary;
      real[near] = (real[near] ?? 0) + farReal;
      imaginary[near] = (imaginary[near] ?? 0) + farImaginary;
    }
  }
}

/**
 * Writes the magnitude of each FFT bin of the Hann-windowed `frame` into
 * `magnitudes`, scaled by the frame length as Web Audio scales it.
 */
function measureMagnitudes(
  tables: FourierTables,
  frame: Float32Array,
  real: Float64Array,
  imaginary: Float64Array,
  magnitudes: Float64Array,
): void {
  for (let index = 0; index < tables.size; index++) {
    real[tables.reversed[index] ?? 0] = (frame[index] ?? 0) * (tables.window[index] ?? 0);
  }
  imaginary.fill(0);

  for (let length = 2; length <= tables.size; length *= 2) {
    combineBlocks(tables, real, imaginary, length);
  }

  for (let index = 0; index < magnitudes.length; index++) {
    magnitudes[index] = Math.hypot(real[index] ?? 0, imaginary[index] ?? 0) / tables.size;
  }
}

/** Picks the FFT bin for each spectrum value, and puts its magnitude on the byte scale. */
function writeSpectrum(magnitudes: Float64Array, binForValue: Uint32Array, spectrum: Uint8Array): void {
  for (let value = 0; value < spectrum.length; value++) {
    const magnitude = magnitudes[binForValue[value] ?? 0] ?? 0;
    const decibels = 20 * Math.log10(Math.max(magnitude, 1e-12));
    const scaled = ((decibels - MIN_DECIBELS) / (MAX_DECIBELS - MIN_DECIBELS)) * 255;
    spectrum[value] = Math.max(0, Math.min(255, Math.round(scaled)));
  }
}

/**
 * Averages the end of `samples` down into `into`, one output sample per `ratio`
 * input samples, right-aligned so the last output is the newest audio. The
 * average is also the anti-aliasing: crude, but only the rough shape of the
 * spectrum below 8 kHz matters here.
 *
 * Each input sample counts in proportion to how much of the output's span it
 * covers. Rounding the spans to whole samples instead makes them alternate in
 * length at a ratio like 44.1 ÷ 16, and that alternation is itself a signal: a
 * lone 400 Hz tone came out lighting bands all the way to 8 kHz.
 */
function downsample(samples: Float32Array, ratio: number, into: Float32Array): void {
  into.fill(0);
  const end = samples.length;
  for (let output = into.length - 1; output >= 0; output--) {
    const spanEnd = end - (into.length - 1 - output) * ratio;
    const spanStart = spanEnd - ratio;
    if (spanEnd <= 0) {
      return;
    }
    let sum = 0;
    for (let index = Math.max(0, Math.floor(spanStart)); index < Math.ceil(spanEnd); index++) {
      const covered = Math.min(index + 1, spanEnd) - Math.max(index, spanStart);
      sum += (samples[index] ?? 0) * covered;
    }
    // Divided by the whole span, so samples before the first count as silence.
    into[output] = sum / ratio;
  }
}

/** RMS of the last `count` samples, with any missing ones counted as silence. */
function rootMeanSquare(samples: Float32Array, count: number): number {
  const start = Math.max(0, samples.length - count);
  let sumOfSquares = 0;
  for (let index = start; index < samples.length; index++) {
    sumOfSquares += (samples[index] ?? 0) ** 2;
  }
  return Math.sqrt(sumOfSquares / Math.max(1, count));
}

/**
 * For each of the {@link SPECTRUM_BIN_COUNT} spectrum values, the index of the
 * FFT bin nearest its frequency, given `sourceBinCount` bins `hertzPerBin` apart.
 *
 * A frequency above the last bin gets an index past the end, which reads as
 * silence. Audio recorded at 8 kHz — an emulator's microphone, or a phone's in a
 * call — holds nothing above 4 kHz, and repeating the last bin across the upper
 * half of the spectrum would light the hologram's highest bands with what is
 * really the top of the voice.
 */
export function voiceRangeBins(hertzPerBin: number, sourceBinCount: number): Uint32Array {
  const bins = new Uint32Array(SPECTRUM_BIN_COUNT);
  for (let value = 0; value < SPECTRUM_BIN_COUNT; value++) {
    const frequency =
      SPECTRUM_LOWEST_FREQUENCY +
      ((SPECTRUM_HIGHEST_FREQUENCY - SPECTRUM_LOWEST_FREQUENCY) * value) / (SPECTRUM_BIN_COUNT - 1);
    const bin = Math.round(frequency / hertzPerBin);
    // Up to the Nyquist frequency the audio holds it, even where the nearest bin
    // rounds one past the last — 8 kHz at 16 kHz does exactly that.
    const isHeld = frequency <= hertzPerBin * sourceBinCount;
    bins[value] = bin < sourceBinCount ? bin : isHeld ? sourceBinCount - 1 : sourceBinCount;
  }
  return bins;
}

export function createVoiceAnalyser(sampleRate: number): VoiceAnalyser {
  if (!(sampleRate > 0)) {
    throw new Error(`A voice cannot be analysed at a sample rate of ${sampleRate}.`);
  }

  const tables = createFourierTables(FFT_SIZE);
  const analysisRate = Math.min(sampleRate, ANALYSIS_SAMPLE_RATE);
  const ratio = sampleRate / analysisRate;
  const volumeSampleCount = Math.round(sampleRate * VOLUME_WINDOW_SECONDS);
  const frame = new Float32Array(tables.size);
  const real = new Float64Array(tables.size);
  const imaginary = new Float64Array(tables.size);
  const magnitudes = new Float64Array(tables.size / 2);
  const spectrum = new Uint8Array(SPECTRUM_BIN_COUNT);
  const binForValue = voiceRangeBins(analysisRate / tables.size, magnitudes.length);

  return {
    sampleRate,
    sampleCount: Math.max(Math.ceil(tables.size * ratio), volumeSampleCount),
    analyse(samples) {
      downsample(samples, ratio, frame);
      measureMagnitudes(tables, frame, real, imaginary, magnitudes);
      writeSpectrum(magnitudes, binForValue, spectrum);
      return { volume: rootMeanSquare(samples, volumeSampleCount), spectrum };
    },
  };
}
