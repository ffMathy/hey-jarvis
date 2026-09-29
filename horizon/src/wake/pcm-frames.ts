/**
 * Web Audio's float samples into the int16 frames the wake pipeline eats.
 *
 * The audio thread hands over 128 samples at a time as floats in [-1, 1]; openWakeWord wants
 * 1280-sample chunks of 16-bit integers, at their integer scale (its melspectrogram's decibel
 * floor is relative, but the embedding model was trained on int16-scale input, and a [-1, 1]
 * input shifts every feature by about −9 against it). At 16 kHz, ten render quanta are exactly
 * one chunk.
 */

/** A float sample in [-1, 1] as a 16-bit integer, clamped. */
export function toInt16(sample: number) {
  const scaled = Math.round(sample * 32768);
  return Math.max(-32768, Math.min(32767, scaled));
}

export interface FramePacker {
  push(samples: ArrayLike<number>): void;
  /** One sample at a time, for the resampler's output. */
  pushSample(sample: number): void;
}

/**
 * Packs float samples into frames of `frameSamples` int16 samples and hands each one over.
 *
 * Each frame is a fresh array, so the caller can transfer its buffer to another thread.
 */
export function createFramePacker(frameSamples: number, onFrame: (frame: Int16Array) => void): FramePacker {
  let frame = new Int16Array(frameSamples);
  let filled = 0;

  function pushSample(sample: number) {
    frame[filled++] = toInt16(sample);
    if (filled === frameSamples) {
      const full = frame;
      frame = new Int16Array(frameSamples);
      filled = 0;
      onFrame(full);
    }
  }

  return {
    push(samples) {
      for (let index = 0; index < samples.length; index++) pushSample(samples[index]);
    },
    pushSample,
  };
}

/** The root mean square of int16 samples, on the float scale (0–1), for the level meter and the mute check. */
export function rootMeanSquare(samples: Int16Array) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index] / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}
