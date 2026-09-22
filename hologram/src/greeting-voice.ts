import {
  GREETING_BAND_COUNT,
  GREETING_FRAME_SECONDS,
  GREETING_FRAMES,
  GREETING_FULL,
  GREETING_SECONDS,
} from './greeting-envelope';
import { SPEAKING_LOUDEST, SPECTRUM_BIN_COUNT, simulatedVolume } from './voice-analysis';
import type { JarvisVoiceReaders } from './voice-contract';

export { GREETING_SECONDS };

/** The spectrum's range, as the contract has it: 100 to 8000 Hz, one value per bin. */
const SPECTRUM_LOWEST_HZ = 100;
const SPECTRUM_HIGHEST_HZ = 8000;
/** How many octaves-and-a-bit the measured bands span, for placing a bin among them. */
const LOG_SPAN = Math.log(SPECTRUM_HIGHEST_HZ / SPECTRUM_LOWEST_HZ);
const ROW = GREETING_BAND_COUNT + 1;
const FRAME_COUNT = GREETING_FRAMES.length / ROW;

/** The measured value at a fractional row and column, blended between its neighbours. */
function measured(row: number, column: number) {
  const first = Math.max(0, Math.min(FRAME_COUNT - 1, Math.floor(row)));
  const second = Math.min(FRAME_COUNT - 1, first + 1);
  const share = Math.max(0, Math.min(1, row - first));
  const blended = GREETING_FRAMES[first * ROW + column] * (1 - share) + GREETING_FRAMES[second * ROW + column] * share;
  return blended / GREETING_FULL;
}

/** Which measured band a bin of the spectrum falls in, as a fractional band number. */
function bandOfBin(bin: number) {
  const hertz = SPECTRUM_LOWEST_HZ + (bin / (SPECTRUM_BIN_COUNT - 1)) * (SPECTRUM_HIGHEST_HZ - SPECTRUM_LOWEST_HZ);
  return (Math.log(hertz / SPECTRUM_LOWEST_HZ) / LOG_SPAN) * GREETING_BAND_COUNT - 0.5;
}
const BAND_OF_BIN = Array.from({ length: SPECTRUM_BIN_COUNT }, (_, bin) => bandOfBin(bin));

/**
 * Fills `spectrum` with the greeting at `seconds` into the recording: the measured loudness, spread
 * across the bins as the measured bands were. Silence before and after it.
 *
 * Scaled like the simulated voice — its loudest moment is {@link SPEAKING_LOUDEST} as a mean of the
 * spectrum — so the tracker's gates, calibrated on that, see the greeting as speech.
 */
export function fillGreetingSpectrum(seconds: number, spectrum: Uint8Array): Uint8Array {
  if (seconds < 0 || seconds >= GREETING_SECONDS) {
    return spectrum.fill(0);
  }
  const row = seconds / GREETING_FRAME_SECONDS;
  const loudness = measured(row, 0);
  let total = 0;
  for (let bin = 0; bin < spectrum.length; bin++) {
    const band = Math.max(0, Math.min(GREETING_BAND_COUNT - 1, BAND_OF_BIN[bin] ?? 0));
    const lower = Math.floor(band);
    const upper = Math.min(GREETING_BAND_COUNT - 1, lower + 1);
    const share = band - lower;
    const shape = measured(row, 1 + lower) * (1 - share) + measured(row, 1 + upper) * share;
    spectrum[bin] = Math.round(shape * 255);
    total += spectrum[bin];
  }
  const mean = total / spectrum.length / 255;
  const scale = mean === 0 ? 0 : (SPEAKING_LOUDEST * loudness) / mean;
  for (let bin = 0; bin < spectrum.length; bin++) {
    spectrum[bin] = Math.min(255, Math.round(spectrum[bin] * scale));
  }
  return spectrum;
}

/** How long the greeting rests between repeats when it stands in for him speaking in sample mode. */
const REPEAT_PAUSE_SECONDS = 1.1;
/** One repeat of the greeting and the pause after it. */
export const GREETING_REPEAT_SECONDS = GREETING_SECONDS + REPEAT_PAUSE_SECONDS;

/**
 * The greeting said over and over with a pause between, from `seconds` into the first time: what
 * sample mode's speaking shows, so he speaks there exactly as he does when summoned.
 */
export function fillRepeatingGreetingSpectrum(seconds: number, spectrum: Uint8Array): Uint8Array {
  const into = seconds - Math.floor(seconds / GREETING_REPEAT_SECONDS) * GREETING_REPEAT_SECONDS;
  return fillGreetingSpectrum(into, spectrum);
}

/**
 * Jarvis saying the greeting — "Hello sir, how can I help?" — as a voice the sphere can follow
 * while the recording plays.
 *
 * Nothing on a phone can tap a sound file as it plays, so this replays a measurement of it taken
 * once (`greeting-envelope.ts`, from `.scripts/measure-greeting.ts`). `secondsIntoGreeting` is
 * where playback is now — the player's own position, so the sphere stays on the words even if
 * playback started late or stalled. Outside the recording it reads as silence.
 */
export function createGreetingReaders(secondsIntoGreeting: () => number): JarvisVoiceReaders {
  const spectrum = new Uint8Array(SPECTRUM_BIN_COUNT);
  const read = () => fillGreetingSpectrum(secondsIntoGreeting(), spectrum);
  return {
    getSpectrum: read,
    getVolume: () => simulatedVolume(read()),
  };
}
