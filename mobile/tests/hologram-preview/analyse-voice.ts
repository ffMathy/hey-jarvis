/**
 * Turns a spoken WAV into what the ElevenLabs SDK's web build would report for it.
 *
 * Every 40 ms — the refresh interval of the SDK's native processors — it records
 * an RMS volume of the samples in that interval, and a 1024-value byte spectrum
 * spanning 100–8000 Hz with Web Audio's AnalyserNode scaling (−100 dB → 0,
 * −30 dB → 255). The result is what `jarvis-voice.replay.ts` plays back.
 *
 * An optional slowdown stretches the playback: each reading is held that many
 * times longer. Nothing about a reading changes, only how long it lasts — see
 * verify-hologram-on-emulator.sh for why an emulator needs it.
 *
 * Usage: bun analyse-voice.ts <16 kHz mono PCM WAV> <output JSON> [slowdown]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const INTERVAL_MS = 40;
const FFT_SIZE = 2048;
const BIN_COUNT = 1024;
const LOWEST_FREQUENCY = 100;
const HIGHEST_FREQUENCY = 8000;
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;

function readPcm(file: string): { samples: Float32Array; sampleRate: number } {
  const wav = readFileSync(file);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) {
    throw new Error(`${file} is not a mono 16-bit PCM WAV`);
  }
  const sampleRate = wav.readUInt32LE(24);
  const dataOffset = wav.indexOf(Buffer.from('data')) + 8;
  const samples = new Float32Array(Math.floor((wav.length - dataOffset) / 2));
  for (let index = 0; index < samples.length; index++) {
    samples[index] = wav.readInt16LE(dataOffset + index * 2) / 32768;
  }
  return { samples, sampleRate };
}

/** The frame multiplied by a Hann window, as the real half of a complex signal. */
function hannWindowed(frame: Float32Array): Float64Array {
  const size = frame.length;
  const real = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    real[index] = (frame[index] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1)));
  }
  return real;
}

/** Reorders the samples by bit-reversed index, the first step of a radix-2 FFT. */
function bitReverse(real: Float64Array): void {
  for (let index = 1, swap = 0; index < real.length; index++) {
    let bit = real.length >> 1;
    for (; swap & bit; bit >>= 1) swap ^= bit;
    swap ^= bit;
    if (index < swap) {
      [real[index], real[swap]] = [real[swap] ?? 0, real[index] ?? 0];
    }
  }
}

/** One pass of the in-place FFT, combining blocks of `length` samples. */
function combineBlocks(real: Float64Array, imaginary: Float64Array, length: number): void {
  const angle = (-2 * Math.PI) / length;
  for (let start = 0; start < real.length; start += length) {
    for (let offset = 0; offset < length / 2; offset++) {
      const cos = Math.cos(angle * offset);
      const sin = Math.sin(angle * offset);
      const near = start + offset;
      const far = near + length / 2;
      const farReal = (real[far] ?? 0) * cos - (imaginary[far] ?? 0) * sin;
      const farImaginary = (real[far] ?? 0) * sin + (imaginary[far] ?? 0) * cos;
      real[far] = (real[near] ?? 0) - farReal;
      imaginary[far] = (imaginary[near] ?? 0) - farImaginary;
      real[near] = (real[near] ?? 0) + farReal;
      imaginary[near] = (imaginary[near] ?? 0) + farImaginary;
    }
  }
}

/** Magnitudes of a Hann-windowed frame, by an in-place radix-2 FFT. */
function magnitudes(frame: Float32Array): Float64Array {
  const real = hannWindowed(frame);
  const imaginary = new Float64Array(real.length);
  bitReverse(real);
  for (let length = 2; length <= real.length; length <<= 1) {
    combineBlocks(real, imaginary, length);
  }

  const result = new Float64Array(real.length / 2);
  for (let index = 0; index < result.length; index++) {
    result[index] = Math.hypot(real[index] ?? 0, imaginary[index] ?? 0) / real.length;
  }
  return result;
}

function analyse(samples: Float32Array, sampleRate: number) {
  const hop = Math.round((sampleRate * INTERVAL_MS) / 1000);
  const hertzPerBin = sampleRate / FFT_SIZE;
  const frames: { volume: number; spectrum: string }[] = [];

  for (let start = 0; start + FFT_SIZE <= samples.length; start += hop) {
    const window = samples.subarray(start, start + FFT_SIZE);

    let sumOfSquares = 0;
    for (let index = 0; index < hop; index++) {
      sumOfSquares += (window[index] ?? 0) ** 2;
    }

    const spectrumMagnitudes = magnitudes(window);
    const spectrum = new Uint8Array(BIN_COUNT);
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      const frequency = LOWEST_FREQUENCY + ((HIGHEST_FREQUENCY - LOWEST_FREQUENCY) * bin) / (BIN_COUNT - 1);
      const magnitude =
        spectrumMagnitudes[Math.min(spectrumMagnitudes.length - 1, Math.round(frequency / hertzPerBin))];
      const decibels = 20 * Math.log10(Math.max(magnitude ?? 0, 1e-12));
      const scaled = ((decibels - MIN_DECIBELS) / (MAX_DECIBELS - MIN_DECIBELS)) * 255;
      spectrum[bin] = Math.max(0, Math.min(255, Math.round(scaled)));
    }

    frames.push({
      volume: Number(Math.sqrt(sumOfSquares / hop).toFixed(4)),
      spectrum: Buffer.from(spectrum).toString('base64'),
    });
  }

  return frames;
}

const [input, output, slowdownText] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('Usage: bun analyse-voice.ts <16 kHz mono PCM WAV> <output JSON> [slowdown]');
}
const slowdown = slowdownText ? Number(slowdownText) : 1;
if (!(slowdown >= 1)) {
  throw new Error(`The slowdown must be 1 or more, not ${slowdownText}`);
}

const { samples, sampleRate } = readPcm(input);
const frames = analyse(samples, sampleRate);
const intervalMs = INTERVAL_MS * slowdown;
writeFileSync(output, JSON.stringify({ intervalMs, frames }));

const volumes = frames.map((frame) => frame.volume);
console.log(
  `  ${frames.length} readings, played back over ${((frames.length * intervalMs) / 1000).toFixed(1)}s ` +
    `(${slowdown}× slower than spoken), peak volume ${Math.max(...volumes).toFixed(3)}`,
);
