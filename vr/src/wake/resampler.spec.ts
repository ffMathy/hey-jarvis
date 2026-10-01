import { describe, expect, it } from 'bun:test';
import { createResampler } from './resampler';

/** Runs `input` through a fresh resampler in blocks of `block` samples, as the audio thread would. */
function resample(inputRate: number, input: Float32Array, block = 128) {
  const resampler = createResampler(inputRate, 16000);
  const output: number[] = [];
  for (let start = 0; start < input.length; start += block) {
    resampler.push(input.subarray(start, start + block), (sample) => output.push(sample));
  }
  return output;
}

function sine(rate: number, frequency: number, seconds: number) {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, index) =>
    Math.sin((2 * Math.PI * frequency * index) / rate),
  );
}

function rootMeanSquare(values: ArrayLike<number>, skip = 0) {
  let sum = 0;
  for (let index = skip; index < values.length; index++) sum += values[index] ** 2;
  return Math.sqrt(sum / (values.length - skip));
}

describe('the resampler', () => {
  it('makes a third as many samples from 48 kHz, whatever the block size', () => {
    const input = sine(48000, 440, 1);
    expect(resample(48000, input)).toHaveLength(16000);
    expect(resample(48000, input, 7)).toEqual(resample(48000, input));
  });

  it('is box-filter decimation at an integer ratio', () => {
    const input = Float32Array.from({ length: 12 }, (_, index) => index);
    // Averages of each three samples ending at 0 (warming up), 3, 6 and 9.
    expect(resample(48000, input)).toEqual([0, 2, 5, 8]);
  });

  it('keeps the right number of samples at a fractional ratio, with no drift', () => {
    const input = sine(44100, 440, 10);
    const output = resample(44100, input);
    expect(Math.abs(output.length - 160000)).toBeLessThanOrEqual(1);
  });

  it('keeps speech frequencies and damps what cannot be represented at 16 kHz', () => {
    const speech = resample(48000, sine(48000, 1000, 1));
    expect(rootMeanSquare(speech, 16)).toBeCloseTo(Math.SQRT1_2, 1);
    // 16 kHz folds onto 0 Hz at the new rate; the box filter's null sits exactly there.
    const aliasing = resample(48000, sine(48000, 16000, 1));
    expect(rootMeanSquare(aliasing, 16)).toBeLessThan(0.01);
  });

  it('passes 16 kHz through unchanged', () => {
    const input = Float32Array.from({ length: 300 }, (_, index) => Math.sin(index));
    const output = resample(16000, input);
    expect(output).toHaveLength(300);
    for (const [index, sample] of output.entries()) expect(sample).toBeCloseTo(input[index], 6);
  });

  it('refuses a rate that is not a positive number', () => {
    expect(() => createResampler(0, 16000)).toThrow();
    expect(() => createResampler(Number.NaN, 16000)).toThrow();
  });
});
