/**
 * Turns a spoken WAV into what the Android app hears in it.
 *
 * Every 40 ms — the refresh interval of the SDK's readers — it takes an RMS
 * volume and a 1024-value byte spectrum spanning 100–8000 Hz on Web Audio's
 * AnalyserNode scale, through `src/voice-analysis.ts`: the analysis the Android
 * app runs on live audio. The result is what `jarvis-voice.replay.ts` plays back.
 *
 * An optional slowdown stretches the playback: each reading is held that many
 * times longer. Nothing about a reading changes, only how long it lasts — see
 * verify-hologram-on-emulator.sh for why an emulator needs it.
 *
 * Usage: bun analyse-voice.ts <16 kHz mono PCM WAV> <output JSON> [slowdown]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createVoiceAnalyser } from 'hologram';

const INTERVAL_MS = 40;

function readPcm(file: string): { samples: Float32Array; sampleRate: number } {
  const wav = readFileSync(file);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) {
    throw new Error(`${file} is not a mono 16-bit PCM WAV`);
  }
  const sampleRate = wav.readUInt32LE(24);
  const dataOffset = wav.indexOf(Buffer.from('data')) + 8;
  const samples = new Float32Array(Math.floor((wav.length - dataOffset) / 2));
  for (let index = 0; index < samples.length; index++) {
    samples[index] = wav.readInt16LE(dataOffset + index * 2) / 32768;
  }
  return { samples, sampleRate };
}

/** One reading every 40 ms, each of the audio up to that moment, as the app takes them. */
function analyse(samples: Float32Array, sampleRate: number) {
  const analyser = createVoiceAnalyser(sampleRate);
  const hop = Math.round((sampleRate * INTERVAL_MS) / 1000);
  const frames: { volume: number; spectrum: string }[] = [];

  for (let end = hop; end <= samples.length; end += hop) {
    const { volume, spectrum } = analyser.analyse(samples.subarray(0, end));
    frames.push({
      volume: Number(volume.toFixed(4)),
      spectrum: Buffer.from(spectrum).toString('base64'),
    });
  }

  return frames;
}

const [input, output, slowdownText] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('Usage: bun analyse-voice.ts <16 kHz mono PCM WAV> <output JSON> [slowdown]');
}
const slowdown = slowdownText ? Number(slowdownText) : 1;
if (!(slowdown >= 1)) {
  throw new Error(`The slowdown must be 1 or more, not ${slowdownText}`);
}

const { samples, sampleRate } = readPcm(input);
const frames = analyse(samples, sampleRate);
const intervalMs = INTERVAL_MS * slowdown;
writeFileSync(output, JSON.stringify({ intervalMs, frames }));

const volumes = frames.map((frame) => frame.volume);
console.log(
  `  ${frames.length} readings, played back over ${((frames.length * intervalMs) / 1000).toFixed(1)}s ` +
    `(${slowdown}× slower than spoken), peak volume ${Math.max(...volumes).toFixed(3)}`,
);
