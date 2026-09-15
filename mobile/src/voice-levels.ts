/**
 * Turning Jarvis's voice into the numbers the hologram is drawn from.
 *
 * The conversation SDK reports the agent's audio two ways: an RMS volume, and a
 * byte frequency spectrum — 1024 values, 0–255, spanning 100–8000 Hz in equal
 * steps, refreshed natively about every 40 ms. Neither is usable as it comes.
 * Speech puts nearly all of its energy in the bottom few hundred hertz, so equal
 * steps would light the first two bands and leave the rest dark; and a value that
 * updates 25 times a second, drawn at 60, visibly steps.
 *
 * So the spectrum is folded into a few log-spaced bands, and both it and the
 * volume are eased toward their latest reading every frame. Everything here is a
 * plain function, and the per-frame ones are worklets, so the same code runs on
 * the UI thread in the app and under `bun test`.
 */

/** How many bands the hologram is given. */
export const VOICE_BAND_COUNT = 24;

/** The span the SDK's spectrum covers. Only the ratio matters for the folding. */
const LOWEST_FREQUENCY = 100;
const HIGHEST_FREQUENCY = 8000;

/**
 * Where each band starts, as an index into a spectrum of `binCount` values.
 *
 * Log-spaced, so each band covers the same musical interval, with every band at
 * least one bin wide — at the bottom the log spacing would otherwise ask for
 * fractions of a bin, and a band with no bins is a band that never lights.
 */
export function bandEdges(binCount: number, bandCount: number = VOICE_BAND_COUNT): number[] {
  const ratio = HIGHEST_FREQUENCY / LOWEST_FREQUENCY;
  const edges: number[] = [0];

  for (let band = 1; band < bandCount; band++) {
    const fraction = (ratio ** (band / bandCount) - 1) / (ratio - 1);
    const previous = edges[band - 1] ?? 0;
    const remainingBands = bandCount - band;
    // At least one bin per band, and never so far that later bands run out.
    const edge = Math.min(Math.max(Math.round(fraction * binCount), previous + 1), binCount - remainingBands);
    edges.push(edge);
  }

  edges.push(binCount);
  return edges;
}

/**
 * Folds a 0–255 byte spectrum into `bandCount` values between 0 and 1.
 *
 * Each band is the mean of its bins, lifted by a square root: a spoken vowel
 * sits well below full scale, and a linear map leaves the hologram barely
 * moving while Jarvis is plainly talking. An empty spectrum — no conversation,
 * or no data yet — folds to silence rather than to garbage.
 */
export function foldSpectrum(spectrum: ArrayLike<number>, bandCount: number = VOICE_BAND_COUNT): number[] {
  if (spectrum.length < bandCount) {
    return new Array<number>(bandCount).fill(0);
  }

  const edges = bandEdges(spectrum.length, bandCount);
  const bands: number[] = [];

  for (let band = 0; band < bandCount; band++) {
    const start = edges[band] ?? 0;
    const end = edges[band + 1] ?? spectrum.length;
    let sum = 0;
    for (let index = start; index < end; index++) {
      sum += spectrum[index] ?? 0;
    }
    const mean = sum / Math.max(1, end - start) / 255;
    bands.push(Math.sqrt(Math.min(1, Math.max(0, mean))));
  }

  return bands;
}

/**
 * Maps the SDK's RMS volume onto 0–1 as the hologram should feel it.
 *
 * RMS of normal speech is small — roughly 0.05 to 0.3 of full scale — so the raw
 * value would make even a raised voice look like a whisper. A square root with
 * some gain spreads that range across the useful part of 0–1, and anything
 * louder simply saturates.
 */
export function perceivedLevel(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) {
    return 0;
  }
  return Math.min(1, Math.sqrt(volume) * 1.8);
}

/** How quickly the drawn value catches up with a louder reading, in seconds. */
export const ATTACK_SECONDS = 0.045;
/** How quickly it falls back when the reading drops. Slower, so syllables read as pulses rather than flicker. */
export const RELEASE_SECONDS = 0.28;

/**
 * Moves `current` toward `target` over `deltaSeconds`, attacking fast and
 * releasing slowly.
 *
 * Exponential, so the result does not depend on frame rate: two 8 ms steps land
 * where one 16 ms step does. That matters because the UI thread's frame interval
 * varies, and a hologram that pulsed harder on a 120 Hz screen would be wrong.
 */
export function easeLevel(current: number, target: number, deltaSeconds: number): number {
  'worklet';
  if (!(deltaSeconds > 0)) {
    return current;
  }
  const seconds = target > current ? ATTACK_SECONDS : RELEASE_SECONDS;
  return current + (target - current) * (1 - Math.exp(-deltaSeconds / seconds));
}

/** {@link easeLevel} for every band at once, written into `current` to avoid an allocation per frame. */
export function easeBands(current: number[], target: number[], deltaSeconds: number): number[] {
  'worklet';
  for (let band = 0; band < current.length; band++) {
    current[band] = easeLevel(current[band] ?? 0, target[band] ?? 0, deltaSeconds);
  }
  return current;
}
