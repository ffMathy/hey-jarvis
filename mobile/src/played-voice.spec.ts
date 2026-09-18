import { describe, expect, it } from 'bun:test';
import { createVoiceAnalyser } from 'hologram';
import { createPlayedVoiceReaders, type PlayedAudioSource, readingWindowSize } from './played-voice';

/**
 * An `AnalyserNode`'s answer for one second of a 1 kHz tone at `amplitude`: the newest
 * `sampleCount` samples, oldest first, which is exactly what `getFloatTimeDomainData` writes.
 */
function tonePlaying(sampleRate: number, amplitude: number): PlayedAudioSource & { reads: number } {
  const windowSize = readingWindowSize(sampleRate);
  const tone = Float32Array.from({ length: sampleRate }, (_, index) =>
    amplitude === 0 ? 0 : amplitude * Math.sin((2 * Math.PI * 1000 * index) / sampleRate),
  );
  const source = {
    reads: 0,
    sampleRate: () => sampleRate,
    sampleCount: () => windowSize,
    readLatest: (into: Float32Array<ArrayBuffer>) => {
      source.reads++;
      into.set(tone.subarray(tone.length - into.length));
    },
  };
  return source;
}

describe('readingWindowSize', () => {
  it('is a power of two big enough for everything the analysis looks at', () => {
    for (const sampleRate of [16000, 44100, 48000]) {
      const size = readingWindowSize(sampleRate);

      expect(size).toBeGreaterThanOrEqual(createVoiceAnalyser(sampleRate).sampleCount);
      expect(Math.log2(size) % 1).toBe(0);
    }
  });

  it('stays within what Web Audio will accept as an fftSize', () => {
    for (const sampleRate of [8000, 16000, 44100, 48000, 96000, 192000]) {
      const size = readingWindowSize(sampleRate);

      expect(size).toBeGreaterThanOrEqual(32);
      expect(size).toBeLessThanOrEqual(32768);
    }
  });
});

describe('createPlayedVoiceReaders', () => {
  it('reads silence until there is audio to read', () => {
    const readers = createPlayedVoiceReaders({ sampleRate: () => 0, sampleCount: () => 0, readLatest: () => {} });

    expect(readers.getVolume()).toBe(0);
    expect(readers.getSpectrum()).toHaveLength(0);
  });

  it('turns the playing samples into a volume and a spectrum', () => {
    const readers = createPlayedVoiceReaders(tonePlaying(48000, 0.5));

    expect(readers.getVolume()).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(Math.max(...Array.from(readers.getSpectrum()))).toBe(255);
  });

  it('reads silence as silence, which is the whole reason it does not ask the SDK', () => {
    // The SDK's own volume is the mean of a byte spectrum whose zero is −100 dB, so nothing it
    // ever reports is silent and the gaps in a sentence never reach the tracker's floor. An RMS
    // of silence is zero.
    const readers = createPlayedVoiceReaders(tonePlaying(48000, 0));

    expect(readers.getVolume()).toBe(0);
  });

  it('analyses once for a volume and a spectrum asked for together', () => {
    let time = 1000;
    const playing = tonePlaying(48000, 0.5);
    const readers = createPlayedVoiceReaders(playing, () => time);

    readers.getVolume();
    readers.getSpectrum();
    expect(playing.reads).toBe(1);

    time += 40;
    readers.getVolume();
    expect(playing.reads).toBe(2);
  });

  it('reads afresh when the clock goes backwards, rather than serving the last reading until it catches up', () => {
    let time = 5000;
    const playing = tonePlaying(48000, 0.5);
    const readers = createPlayedVoiceReaders(playing, () => time);

    readers.getVolume();
    time -= 3000;
    readers.getVolume();

    expect(playing.reads).toBe(2);
  });

  it('follows the audio to a new sample rate and window', () => {
    let time = 0;
    let loud = true;
    const loudly = tonePlaying(48000, 0.5);
    const quietly = tonePlaying(16000, 0.1);
    const readers = createPlayedVoiceReaders(
      {
        sampleRate: () => (loud ? loudly : quietly).sampleRate(),
        sampleCount: () => (loud ? loudly : quietly).sampleCount(),
        readLatest: (into) => (loud ? loudly : quietly).readLatest(into),
      },
      () => time,
    );

    expect(readers.getVolume()).toBeCloseTo(0.5 / Math.SQRT2, 2);

    loud = false;
    time += 40;
    expect(readers.getVolume()).toBeCloseTo(0.1 / Math.SQRT2, 2);
  });
});
