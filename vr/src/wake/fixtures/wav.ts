import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The spoken clips the wake tests run, and a reader for them.
 *
 * The clips were made with espeak-ng during the wake-word research, at 16 kHz with about 2 s of
 * quiet either side, and openWakeWord's Python package was run on them as the reference the
 * port is checked against:
 *
 * - `hey-jarvis-american.wav`: "hey jarvis" in espeak-ng's American English voice. Python's
 *   highest score is 0.9949, on chunk 41.
 * - `hey-jarvis-british.wav`: the same in its British English voice; 0.9924, on chunk 42.
 * - `other-speech.wav`: speech with no wake word in it; never above 0.0001.
 */
export const FIXTURES_FOLDER = import.meta.dir;

/**
 * The samples of a 16-bit mono WAV file.
 *
 * The chunks are walked rather than the data assumed to start at byte 44: these files carry a
 * `LIST` chunk (ffmpeg's encoder tag) between the format and the data.
 */
export function readWavSamples(file: string): Int16Array {
  const bytes = readFileSync(path.isAbsolute(file) ? file : path.join(FIXTURES_FOLDER, file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const samples = new Int16Array(size / 2);
      for (let index = 0; index < samples.length; index++) {
        samples[index] = view.getInt16(offset + 8 + index * 2, true);
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${file} has no data chunk.`);
}
