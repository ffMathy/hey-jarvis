/**
 * Measures the greeting recording into the table the hologram speaks it from.
 *
 * Jarvis's greeting — "Hello sir, how can I help?" — is a recording, so the sphere cannot hear it
 * the way it hears the agent: nothing on a phone taps an audio file being played. What it can do is
 * follow a measurement of it, taken once, here, and replayed in step with the player. So this
 * decodes `assets/greeting.mp3` and writes, every {@link FRAME_SECONDS}, how loud it is and how that
 * loudness is spread across {@link BAND_COUNT} bands from 100 to 8000 Hz — the same range the
 * sphere's spectrum covers — into `src/greeting-envelope.ts`.
 *
 * Usage, from the repository root, after changing the recording:
 *   node --experimental-strip-types hologram/.scripts/measure-greeting.ts
 *
 * Node rather than bun: the decoder unpacks its WebAssembly from a string, and under bun that fails
 * its own checksum.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import FFT from 'fft.js';
import { MPEGDecoder } from 'mpg123-decoder';

const ROOT = join(import.meta.dirname, '..');
const RECORDING = join(ROOT, 'assets/greeting.mp3');
const OUTPUT = join(ROOT, 'src/greeting-envelope.ts');

/** How often it is measured: twice as often as the sphere reads a voice, so nothing falls between. */
const FRAME_SECONDS = 0.02;
/** How many bands the spectrum is summarised in: enough to tell an "s" from an "o", no more. */
const BAND_COUNT = 12;
const LOWEST_HZ = 100;
const HIGHEST_HZ = 8000;
/** The analysis window, in samples: about 23 ms at 44.1 kHz, a little longer than a frame. */
const WINDOW = 1024;

/** What a measurement of 1 is written as: the table holds whole thousandths, to keep it small and exact. */
const FULL = 1000;

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function thousandths(value: number) {
  return Math.round(value * FULL);
}

async function main() {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const decoded = decoder.decode(new Uint8Array(readFileSync(RECORDING)));
  decoder.free();
  const rate = decoded.sampleRate;
  // Mono: the mean of the channels.
  const samples = new Float32Array(decoded.samplesDecoded);
  for (const channel of decoded.channelData) {
    for (let index = 0; index < samples.length; index++) {
      samples[index] += channel[index] / decoded.channelData.length;
    }
  }

  const fft = new FFT(WINDOW);
  const input = new Array<number>(WINDOW).fill(0);
  const output = fft.createComplexArray();
  const hann = Array.from({ length: WINDOW }, (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (WINDOW - 1)));
  const binHz = rate / WINDOW;
  const edges = Array.from(
    { length: BAND_COUNT + 1 },
    (_, band) => LOWEST_HZ * (HIGHEST_HZ / LOWEST_HZ) ** (band / BAND_COUNT),
  );

  const hop = Math.round(FRAME_SECONDS * rate);
  const frames: { loudness: number; bands: number[] }[] = [];
  for (let start = 0; start < samples.length; start += hop) {
    let energy = 0;
    for (let index = 0; index < WINDOW; index++) {
      const sample = samples[start - WINDOW / 2 + index] ?? 0;
      input[index] = sample * hann[index];
      energy += sample * sample;
    }
    fft.realTransform(output, input);
    const bands = edges.slice(0, BAND_COUNT).map((low, band) => {
      const high = edges[band + 1];
      let sum = 0;
      let count = 0;
      for (let bin = Math.max(1, Math.floor(low / binHz)); bin * binHz < high && bin < WINDOW / 2; bin++) {
        sum += Math.hypot(output[2 * bin], output[2 * bin + 1]);
        count++;
      }
      return count ? sum / count : 0;
    });
    frames.push({ loudness: Math.sqrt(energy / WINDOW), bands });
  }

  // Loudness as a share of the loudest moment, and each frame's bands as a shape — its loudest
  // band 1 — since how loud a moment is is already the loudness.
  const loudest = Math.max(...frames.map((frame) => frame.loudness));
  const table = frames.flatMap(({ loudness, bands }) => {
    const peak = Math.max(...bands);
    return [thousandths(loudness / loudest), ...bands.map((band) => thousandths(peak ? band / peak : 0))];
  });
  const seconds = samples.length / rate;

  const rows: string[] = [];
  for (let offset = 0; offset < table.length; offset += BAND_COUNT + 1) {
    rows.push(`  ${table.slice(offset, offset + BAND_COUNT + 1).join(', ')},`);
  }
  writeFileSync(
    OUTPUT,
    `// Measured from assets/greeting.mp3 by .scripts/measure-greeting.ts. Do not edit by hand: change
// the recording and run the script again.

/** How long the recording is, in seconds. */
export const GREETING_SECONDS = ${round(seconds)};
/** How far apart the measurements are, in seconds. */
export const GREETING_FRAME_SECONDS = ${FRAME_SECONDS};
/** How many bands, from ${LOWEST_HZ} to ${HIGHEST_HZ} Hz on a log scale, each measurement is summarised in. */
export const GREETING_BAND_COUNT = ${BAND_COUNT};
/** What a share of 1 is written as in {@link GREETING_FRAMES}. */
export const GREETING_FULL = ${FULL};
/**
 * One row per measurement: its loudness as a share of the loudest moment in the recording, then
 * each band's share of that moment's loudest band — both in thousandths.
 */
export const GREETING_FRAMES: readonly number[] = [
${rows.join('\n')}
];
`,
  );
  // Laid out the way the repository's formatter lays out a long array, so the lint does not rewrite it.
  spawnSync('bunx', ['biome', 'format', '--write', OUTPUT], { stdio: 'inherit' });
  console.log(`${frames.length} frames over ${seconds.toFixed(2)} s at ${rate} Hz → ${OUTPUT}`);
}

await main();
