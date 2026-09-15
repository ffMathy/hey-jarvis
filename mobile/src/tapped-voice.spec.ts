import { describe, expect, it } from 'bun:test';
import { type AudioTapSource, createTappedVoiceReaders, decodeSamples } from './tapped-voice';

/** `values` as 16-bit little-endian bytes, the way the native tap hands them over. */
function littleEndian(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [index, value] of values.entries()) {
    view.setInt16(index * 2, value, true);
  }
  return bytes;
}

/** A tap holding one second of a 1 kHz tone at `amplitude`, that counts how often it is read. */
function toneTap(sampleRate: number, amplitude: number): AudioTapSource & { reads: number } {
  const bytes = littleEndian(
    Array.from({ length: sampleRate }, (_, index) =>
      Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 1000 * index) / sampleRate)),
    ),
  );
  const tap = {
    reads: 0,
    sampleRate: () => sampleRate,
    readLatest: (sampleCount: number) => {
      tap.reads++;
      return bytes.subarray(Math.max(0, bytes.length - sampleCount * 2));
    },
  };
  return tap;
}

describe('decodeSamples', () => {
  it('reads little-endian 16-bit samples as floats', () => {
    const into = new Float32Array(3);

    const count = decodeSamples(littleEndian([16384, -32768, 256]), into);

    expect(count).toBe(3);
    expect([...into]).toEqual([0.5, -1, 256 / 32768]);
  });

  it("reads the bytes little-endian, not in a ByteBuffer's default big-endian order", () => {
    // 256 is stored as 0x00 0x01, which read big-endian says 1.
    const into = new Float32Array(1);

    decodeSamples(littleEndian([256]), into);

    expect(into[0]).toBe(256 / 32768);
  });

  it('keeps the newest samples, at the end, when there are more than room for', () => {
    const into = new Float32Array(2);

    decodeSamples(littleEndian([100, 200, 300]), into);

    expect([...into]).toEqual([200 / 32768, 300 / 32768]);
  });

  it('reads a view into a larger buffer from where the view starts', () => {
    const larger = littleEndian([999, 100, 200]);
    const into = new Float32Array(2);

    decodeSamples(larger.subarray(2), into);

    expect([...into]).toEqual([100 / 32768, 200 / 32768]);
  });
});

describe('createTappedVoiceReaders', () => {
  it('reads silence until the tap has audio', () => {
    const readers = createTappedVoiceReaders({ sampleRate: () => 0, readLatest: () => new Uint8Array(0) });

    expect(readers.getVolume()).toBe(0);
    expect(readers.getSpectrum()).toHaveLength(0);
  });

  it('turns the tapped samples into a volume and a spectrum', () => {
    const readers = createTappedVoiceReaders(toneTap(48000, 0.5));

    expect(readers.getVolume()).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(Math.max(...Array.from(readers.getSpectrum()))).toBe(255);
  });

  it('analyses once for a volume and a spectrum asked for together', () => {
    let time = 1000;
    const tap = toneTap(48000, 0.5);
    const readers = createTappedVoiceReaders(tap, () => time);

    readers.getVolume();
    readers.getSpectrum();
    expect(tap.reads).toBe(1);

    time += 40;
    readers.getVolume();
    expect(tap.reads).toBe(2);
  });

  it('reads afresh when the clock goes backwards, rather than serving the last reading until it catches up', () => {
    let time = 5000;
    const tap = toneTap(48000, 0.5);
    const readers = createTappedVoiceReaders(tap, () => time);

    readers.getVolume();
    time -= 3000;
    readers.getVolume();

    expect(tap.reads).toBe(2);
  });

  it('follows the tap to a new sample rate', () => {
    let time = 0;
    let loud = true;
    const loudTap = toneTap(48000, 0.5);
    const quietTap = toneTap(16000, 0.1);
    const readers = createTappedVoiceReaders(
      {
        sampleRate: () => (loud ? loudTap : quietTap).sampleRate(),
        readLatest: (count) => (loud ? loudTap : quietTap).readLatest(count),
      },
      () => time,
    );

    expect(readers.getVolume()).toBeCloseTo(0.5 / Math.SQRT2, 2);

    loud = false;
    time += 40;
    expect(readers.getVolume()).toBeCloseTo(0.1 / Math.SQRT2, 2);
  });
});
