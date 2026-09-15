import { describe, expect, it } from 'bun:test';
import {
  ATTACK_SECONDS,
  bandEdges,
  easeBands,
  easeLevel,
  foldSpectrum,
  perceivedLevel,
  RELEASE_SECONDS,
  VOICE_BAND_COUNT,
} from './voice-levels';

/** A spectrum the size the SDK hands back, with `fill` for every bin. */
function spectrum(fill: (bin: number) => number, length = 1024): Uint8Array {
  return Uint8Array.from({ length }, (_, bin) => fill(bin));
}

describe('bandEdges', () => {
  it('covers the whole spectrum, in order, with no empty band', () => {
    const edges = bandEdges(1024);

    expect(edges).toHaveLength(VOICE_BAND_COUNT + 1);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(1024);
    for (let band = 0; band < VOICE_BAND_COUNT; band++) {
      expect(edges[band + 1]).toBeGreaterThan(edges[band] ?? 0);
    }
  });

  it('gives the low frequencies narrow bands and the high ones wide bands, as speech needs', () => {
    const edges = bandEdges(1024);
    const firstWidth = (edges[1] ?? 0) - (edges[0] ?? 0);
    const lastWidth = (edges[VOICE_BAND_COUNT] ?? 0) - (edges[VOICE_BAND_COUNT - 1] ?? 0);

    expect(lastWidth).toBeGreaterThan(firstWidth * 10);
  });

  it('still gives every band a bin when the spectrum is barely bigger than the band count', () => {
    const edges = bandEdges(VOICE_BAND_COUNT);

    expect(edges).toEqual(Array.from({ length: VOICE_BAND_COUNT + 1 }, (_, index) => index));
  });
});

describe('foldSpectrum', () => {
  it('folds silence to silence', () => {
    expect(foldSpectrum(spectrum(() => 0))).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
  });

  it('folds a full-scale spectrum to full-scale bands', () => {
    for (const band of foldSpectrum(spectrum(() => 255))) {
      expect(band).toBeCloseTo(1, 5);
    }
  });

  it('folds an empty or undersized spectrum to silence rather than guessing', () => {
    // Before a conversation starts, or before the first native reading, the SDK
    // has nothing — and the hologram should sit idle, not flash.
    expect(foldSpectrum(new Uint8Array(0))).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
    expect(foldSpectrum(new Uint8Array(8))).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
  });

  it('puts a low voice in the low bands and leaves the high bands dark', () => {
    // Energy only in the bottom 40 bins: roughly 100–400 Hz, a voice's fundamental.
    const bands = foldSpectrum(spectrum((bin) => (bin < 40 ? 200 : 0)));

    expect(bands[0]).toBeGreaterThan(0.5);
    expect(bands.at(-1)).toBe(0);
    // Log spacing spreads those 40 bins across many bands, not one or two.
    expect(bands.filter((band) => band > 0.5).length).toBeGreaterThan(VOICE_BAND_COUNT / 4);
  });

  it('lifts quiet energy so a spoken vowel visibly moves the hologram', () => {
    const [band] = foldSpectrum(spectrum(() => 64));

    // 64/255 is a quarter of full scale; the square root makes it half.
    expect(band).toBeCloseTo(Math.sqrt(64 / 255), 5);
    expect(band).toBeGreaterThan(64 / 255);
  });
});

describe('perceivedLevel', () => {
  it('is silent for silence and for readings that are not numbers', () => {
    expect(perceivedLevel(0)).toBe(0);
    expect(perceivedLevel(-0.2)).toBe(0);
    expect(perceivedLevel(Number.NaN)).toBe(0);
  });

  it('spreads ordinary speech volume across the range instead of leaving it near zero', () => {
    expect(perceivedLevel(0.05)).toBeGreaterThan(0.35);
    expect(perceivedLevel(0.15)).toBeGreaterThan(0.65);
  });

  it('never exceeds full scale', () => {
    expect(perceivedLevel(1)).toBe(1);
    expect(perceivedLevel(40)).toBe(1);
  });
});

describe('easeLevel', () => {
  it('rises toward a louder reading faster than it falls back from one', () => {
    const rising = easeLevel(0, 1, 0.05);
    const falling = 1 - easeLevel(1, 0, 0.05);

    expect(rising).toBeGreaterThan(falling);
    expect(ATTACK_SECONDS).toBeLessThan(RELEASE_SECONDS);
  });

  it('lands in the same place however the time is sliced, so frame rate does not change the pulse', () => {
    const oneStep = easeLevel(0.1, 0.9, 1 / 30);
    const twoSteps = easeLevel(easeLevel(0.1, 0.9, 1 / 60), 0.9, 1 / 60);

    expect(twoSteps).toBeCloseTo(oneStep, 10);
  });

  it('never overshoots its target', () => {
    expect(easeLevel(0, 1, 10)).toBeLessThanOrEqual(1);
    expect(easeLevel(1, 0, 10)).toBeGreaterThanOrEqual(0);
  });

  it('does not move when no time has passed, or when the clock hands back nonsense', () => {
    expect(easeLevel(0.4, 1, 0)).toBe(0.4);
    expect(easeLevel(0.4, 1, -1)).toBe(0.4);
    expect(easeLevel(0.4, 1, Number.NaN)).toBe(0.4);
  });
});

describe('easeBands', () => {
  it('eases every band in place and returns the same array', () => {
    const current = [0, 1, 0.5];
    const result = easeBands(current, [1, 0, 0.5], 0.05);

    expect(result).toBe(current);
    expect(current[0]).toBeGreaterThan(0);
    expect(current[1]).toBeLessThan(1);
    expect(current[2]).toBe(0.5);
  });
});
