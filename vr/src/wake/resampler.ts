/**
 * A streaming downsampler to 16 kHz, for an audio context that did not get the rate it asked for.
 *
 * The wake engine asks for a 16 kHz AudioContext, and Chromium — which Quest Browser is — gives
 * it one, resampling the microphone properly on the way in. This is the fallback for a browser
 * that ignores the request and runs at the hardware's rate instead, usually 48 kHz.
 *
 * A moving average as wide as the rate ratio, then linear interpolation. At an integer ratio
 * (48 kHz → 16 kHz is 3) the interpolation lands exactly on samples and this is plain box-filter
 * decimation; at a fractional one (44.1 kHz) it interpolates between the filtered samples. That
 * is a crude low-pass, but the research measured even naive interpolation without any filter
 * scoring the same on a noisy 48 kHz "hey jarvis" as a proper soxr resample (0.9971 vs 0.9953):
 * openWakeWord's features only reach 8 kHz, and speech carries little above that.
 */

export interface Resampler {
  /** Feeds input samples; calls `emit` with each output sample as soon as it can be made. */
  push(samples: ArrayLike<number>, emit: (sample: number) => void): void;
}

export function createResampler(inputRate: number, outputRate: number): Resampler {
  if (!(inputRate > 0 && outputRate > 0)) throw new Error(`Cannot resample ${inputRate} Hz to ${outputRate} Hz.`);
  // Input samples per output sample.
  const step = inputRate / outputRate;
  const width = Math.max(1, Math.round(step));
  const history = new Float64Array(width);
  let historySum = 0;
  let received = 0;
  // Filtered samples made so far, the last of them, and output samples made so far. An output
  // sample's position is computed from its index rather than accumulated, so it never drifts.
  let filtered = 0;
  let previous = 0;
  let emitted = 0;

  function filter(sample: number) {
    const slot = received % width;
    historySum += sample - history[slot];
    history[slot] = sample;
    received++;
    return historySum / Math.min(received, width);
  }

  return {
    push(samples, emit) {
      for (let index = 0; index < samples.length; index++) {
        const current = filter(samples[index]);
        const before = filtered === 0 ? current : previous;
        // Emit every output sample whose position falls between the previous filtered sample
        // and this one.
        for (let position = emitted * step; position <= filtered; position = emitted * step) {
          const fraction = position - (filtered - 1);
          emit(filtered === 0 ? current : before + (current - before) * fraction);
          emitted++;
        }
        previous = current;
        filtered++;
      }
    },
  };
}
