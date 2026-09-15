import { describe, expect, it } from 'bun:test';
import {
  ANALYSIS_SAMPLE_RATE,
  createVoiceAnalyser,
  SPECTRUM_BIN_COUNT,
  SPECTRUM_HIGHEST_FREQUENCY,
  SPECTRUM_LOWEST_FREQUENCY,
  voiceRangeBins,
} from './voice-analysis';
import { foldSpectrum } from './voice-levels';

/** One second of a sine wave. */
function sine(sampleRate: number, frequency: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: sampleRate },
    (_, index) => amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
}

/** The spectrum value nearest `frequency`. */
function valueAt(frequency: number): number {
  return Math.round(
    ((frequency - SPECTRUM_LOWEST_FREQUENCY) / (SPECTRUM_HIGHEST_FREQUENCY - SPECTRUM_LOWEST_FREQUENCY)) *
      (SPECTRUM_BIN_COUNT - 1),
  );
}

/** Where the spectrum is loudest, as the middle of its loudest run of values. */
function peakOf(spectrum: Uint8Array): number {
  const loudest = Math.max(...spectrum);
  const indices = [...spectrum.keys()].filter((index) => spectrum[index] === loudest);
  return ((indices[0] ?? 0) + (indices.at(-1) ?? 0)) / 2;
}

/** The band with the most in it. */
function loudestBand(bands: number[]): number {
  return bands.indexOf(Math.max(...bands));
}

describe('createVoiceAnalyser', () => {
  it('reads silence as silence', () => {
    const { volume, spectrum } = createVoiceAnalyser(48000).analyse(new Float32Array(48000));

    expect(volume).toBe(0);
    expect(spectrum).toHaveLength(SPECTRUM_BIN_COUNT);
    expect(Math.max(...spectrum)).toBe(0);
  });

  it('measures the volume as RMS', () => {
    // A sine's RMS is its amplitude over √2.
    const { volume } = createVoiceAnalyser(48000).analyse(sine(48000, 400, 0.5));

    expect(volume).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });

  for (const sampleRate of [16000, 44100, 48000]) {
    it(`puts a tone at its own frequency, at ${sampleRate} Hz`, () => {
      const analyser = createVoiceAnalyser(sampleRate);

      expect(peakOf(analyser.analyse(sine(sampleRate, 400, 0.5)).spectrum)).toBeWithin(
        valueAt(400) - 3,
        valueAt(400) + 4,
      );
      expect(peakOf(analyser.analyse(sine(sampleRate, 3000, 0.5)).spectrum)).toBeWithin(
        valueAt(3000) - 3,
        valueAt(3000) + 4,
      );
    });
  }

  it('leaves the spectrum dark away from a tone, rather than smeared across it', () => {
    const { spectrum } = createVoiceAnalyser(48000).analyse(sine(48000, 400, 0.5));

    expect(spectrum[valueAt(3000)]).toBe(0);
    expect(spectrum[valueAt(7000)]).toBe(0);
  });

  it('puts quieter audio lower on the scale', () => {
    const analyser = createVoiceAnalyser(48000);
    const loud = analyser.analyse(sine(48000, 1000, 0.5)).spectrum[valueAt(1000)] ?? 0;
    const quiet = analyser.analyse(sine(48000, 1000, 0.005)).spectrum[valueAt(1000)] ?? 0;

    // 40 dB quieter is 40/70 of the byte scale lower, less whatever of the loud
    // one clipped at 255.
    expect(loud).toBeGreaterThan(quiet + 100);
    expect(quiet).toBeGreaterThan(0);
  });

  it('reads only the most recent audio', () => {
    const analyser = createVoiceAnalyser(ANALYSIS_SAMPLE_RATE);
    const toneThenSilence = new Float32Array(2 * ANALYSIS_SAMPLE_RATE);
    toneThenSilence.set(sine(ANALYSIS_SAMPLE_RATE, 1000, 0.5));

    const { volume, spectrum } = analyser.analyse(toneThenSilence);

    expect(volume).toBe(0);
    expect(Math.max(...spectrum)).toBe(0);
  });

  it('treats fewer samples than it needs as silence before them', () => {
    const analyser = createVoiceAnalyser(48000);
    const short = sine(48000, 1000, 0.5).subarray(0, 2000);

    const { volume } = analyser.analyse(short);

    expect(analyser.sampleCount).toBeGreaterThan(short.length);
    expect(volume).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('gives the hologram a low band for a low voice and a high band for a high one', () => {
    const analyser = createVoiceAnalyser(48000);
    const low = loudestBand(foldSpectrum(analyser.analyse(sine(48000, 200, 0.3)).spectrum));
    const high = loudestBand(foldSpectrum(analyser.analyse(sine(48000, 3000, 0.3)).spectrum));

    expect(high).toBeGreaterThan(low + 8);
  });

  for (const sampleRate of [44100, 22050]) {
    it(`keeps a tone in its own bands at ${sampleRate} Hz, which does not divide evenly into 16 kHz`, () => {
      const bands = foldSpectrum(createVoiceAnalyser(sampleRate).analyse(sine(sampleRate, 400, 0.5)).spectrum);
      const toneBand = loudestBand(bands);
      const elsewhere = bands.filter((_, band) => Math.abs(band - toneBand) > 1);

      expect(bands[toneBand]).toBeGreaterThan(0.8);
      // The crude averaging lets a trace of the tone's images through, far below it.
      expect(Math.max(...elsewhere)).toBeLessThan(0.2);
    });
  }

  it('hears nothing above what 8 kHz audio can hold, rather than smearing the top of it upwards', () => {
    const { spectrum } = createVoiceAnalyser(8000).analyse(sine(8000, 3000, 0.5));

    expect(peakOf(spectrum)).toBeWithin(valueAt(3000) - 3, valueAt(3000) + 4);
    expect(Math.max(...spectrum.subarray(valueAt(4200)))).toBe(0);
  });

  it('refuses a sample rate it cannot use', () => {
    expect(() => createVoiceAnalyser(0)).toThrow();
  });
});

describe('voiceRangeBins', () => {
  it('maps the first and last spectrum values to the bins at 100 Hz and 8 kHz', () => {
    const bins = voiceRangeBins(ANALYSIS_SAMPLE_RATE / 2048, 1024);

    expect(bins[0]).toBe(Math.round(100 / (ANALYSIS_SAMPLE_RATE / 2048)));
    expect(bins[SPECTRUM_BIN_COUNT - 1]).toBe(1023);
  });

  it('points frequencies above what the bins hold past the end, so they read as silence', () => {
    // 50 bins 100 Hz apart hold up to 5 kHz.
    const bins = voiceRangeBins(100, 50);

    expect(bins[valueAt(4900)]).toBe(49);
    expect(bins[valueAt(4990)]).toBe(49);
    expect(bins[valueAt(6000)]).toBe(50);
    expect(bins[SPECTRUM_BIN_COUNT - 1]).toBe(50);
  });
});
