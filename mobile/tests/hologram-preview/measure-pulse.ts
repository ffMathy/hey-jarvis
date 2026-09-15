/**
 * Says whether the hologram on screen actually pulsed with the voice.
 *
 * It compares two series. One is the voice the app was replaying: the recorded
 * volume, put through the same `perceivedLevel` and `easeLevel` the app draws
 * from, and laid out on the replay's loop (silence, then the line). The other is
 * the hologram's mean brightness in each frame of a screen recording, from
 * ffmpeg's `signalstats`. The recording starts at an unknown point in the loop,
 * so the voice series is slid across it and the best-matching offset kept.
 *
 * It passes when brightness follows the voice (Pearson correlation) and when the
 * hologram is clearly brighter while Jarvis speaks than while he is silent. The
 * thresholds are fixed here, before any recording is measured, so a disappointing
 * run cannot quietly lower them.
 *
 * It also checks that the hologram keeps moving while Jarvis is silent, from a
 * second series: how much the hologram changes from one tenth of a second to the
 * next (ffmpeg's `tblend` difference), averaged over each two seconds of silence
 * on the aligned loop — and every one of those must move, not just their sum.
 *
 * Usage: bun measure-pulse.ts <recording JSON> <brightness YAVG file> <silence ms> <output JSON> <motion YAVG file>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { easeLevel, perceivedLevel } from '../../src/voice-levels';

/** Brightness must follow the voice at least this closely. */
const MINIMUM_CORRELATION = 0.5;
/**
 * And follow it this much more closely than it follows the same voice played
 * backwards. Keeping the best of many offsets can find some correlation in any
 * two wobbly signals; a reversed voice has the same loudness statistics but the
 * wrong timing, so it measures how much of the match is luck.
 */
const MINIMUM_MARGIN_OVER_REVERSED = 0.2;
/** And be at least this much brighter, on average, while he speaks than while he is silent. */
const MINIMUM_SPEAKING_BRIGHTNESS_RATIO = 1.1;
/**
 * And change by at least this much, 0–255 mean per pixel, from one tenth of a
 * second to the next while he is silent — averaged over each stretch of
 * {@link MOTION_WINDOW_SECONDS}, and required of every such stretch, so a
 * hologram that stops part-way through the silence fails rather than living off
 * the frames before it stopped.
 *
 * Averaged, because screenrecord only emits a frame when the screen changes: at
 * an emulator's few frames a second most tenth-second pairs are the same frame
 * repeated, and measure 0. A frozen hologram measures 0 throughout.
 */
const MINIMUM_SILENT_MOTION = 1;
/** How long each stretch of silence judged on its own is. Several frames long even at the emulator's frame rate. */
const MOTION_WINDOW_SECONDS = 2;
/** A stretch with fewer samples than this share of a full one is the ragged edge of a silence, and not judged. */
const MINIMUM_WINDOW_COVERAGE = 0.75;

const SAMPLE_RATE = 25;

interface Recording {
  intervalMs: number;
  frames: { volume: number }[];
}

/** Reads an ffmpeg `metadata=print` file of YAVG values into (time, value) pairs. */
function readBrightness(file: string): { time: number; brightness: number }[] {
  const samples: { time: number; brightness: number }[] = [];
  let time: number | undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const timeMatch = /pts_time:([\d.]+)/.exec(line);
    if (timeMatch?.[1]) time = Number(timeMatch[1]);
    const brightnessMatch = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (brightnessMatch?.[1] && time !== undefined) samples.push({ time, brightness: Number(brightnessMatch[1]) });
  }
  return samples;
}

/** Linear resample onto a fixed rate, so both series share a time base. */
function resample(samples: { time: number; brightness: number }[], rate: number): number[] {
  const last = samples.at(-1);
  if (!last) return [];
  const result: number[] = [];
  let cursor = 0;
  for (let step = 0; step / rate <= last.time; step++) {
    const time = step / rate;
    while (cursor < samples.length - 2 && (samples[cursor + 1]?.time ?? 0) < time) cursor++;
    const before = samples[cursor];
    const after = samples[cursor + 1] ?? before;
    if (!before || !after) break;
    const span = after.time - before.time;
    const weight = span > 0 ? Math.min(1, Math.max(0, (time - before.time) / span)) : 0;
    result.push(before.brightness + (after.brightness - before.brightness) * weight);
  }
  return result;
}

/** The level the app would have been drawing, sampled at `rate`, over one loop: silence then the line. */
function voiceLoop(recording: Recording, silenceMs: number, rate: number): { level: number[]; speaking: boolean[] } {
  const speechMs = recording.frames.length * recording.intervalMs;
  const loopMs = silenceMs + speechMs;
  const level: number[] = [];
  const speaking: boolean[] = [];
  let drawn = 0;
  for (let step = 0; (step * 1000) / rate < loopMs; step++) {
    const position = (step * 1000) / rate;
    const inSpeech = position >= silenceMs;
    const reading = inSpeech ? recording.frames[Math.floor((position - silenceMs) / recording.intervalMs)] : undefined;
    drawn = easeLevel(drawn, perceivedLevel(reading?.volume ?? 0), 1 / rate);
    level.push(drawn);
    speaking.push(inSpeech);
  }
  return { level, speaking };
}

function correlation(a: number[], b: number[]): number {
  const count = Math.min(a.length, b.length);
  if (count < 3) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < count; index++) {
    meanA += a[index] ?? 0;
    meanB += b[index] ?? 0;
  }
  meanA /= count;
  meanB /= count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < count; index++) {
    const deltaA = (a[index] ?? 0) - meanA;
    const deltaB = (b[index] ?? 0) - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  return varianceA > 0 && varianceB > 0 ? covariance / Math.sqrt(varianceA * varianceB) : 0;
}

const [recordingFile, brightnessFile, silenceMsText, outputFile, motionFile] = process.argv.slice(2);
if (!recordingFile || !brightnessFile || !silenceMsText || !outputFile || !motionFile) {
  throw new Error(
    'Usage: bun measure-pulse.ts <recording JSON> <brightness file> <silence ms> <output JSON> <motion file>',
  );
}

const recording: Recording = JSON.parse(readFileSync(recordingFile, 'utf8'));
const brightness = resample(readBrightness(brightnessFile), SAMPLE_RATE);
const loop = voiceLoop(recording, Number(silenceMsText), SAMPLE_RATE);

/** Slides one loop of `level` across the recording and keeps the best alignment. */
function bestAlignment(level: number[]): { offset: number; correlation: number } {
  let best = { offset: 0, correlation: -1 };
  for (let offset = 0; offset < level.length; offset++) {
    const aligned = brightness.map((_, index) => level[(index + offset) % level.length] ?? 0);
    const score = correlation(aligned, brightness);
    if (score > best.correlation) best = { offset, correlation: score };
  }
  return best;
}

const best = bestAlignment(loop.level);
const reversed = bestAlignment([...loop.level].reverse());

const speakingBrightness: number[] = [];
const silentBrightness: number[] = [];
brightness.forEach((value, index) => {
  const speaking = loop.speaking[(index + best.offset) % loop.speaking.length];
  (speaking ? speakingBrightness : silentBrightness).push(value);
});
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const ratio = mean(speakingBrightness) / Math.max(1e-6, mean(silentBrightness));

// Motion during silence, placed on the same alignment as the brightness.
const motion = readBrightness(motionFile);
const silentMotion: number[] = [];
const speakingMotion: number[] = [];
const silentMotionByWindow = new Map<number, number[]>();
for (const { time, brightness: change } of motion) {
  const step = Math.round(time * SAMPLE_RATE);
  if (step >= brightness.length) break;
  const speaking = loop.speaking[(step + best.offset) % loop.speaking.length];
  (speaking ? speakingMotion : silentMotion).push(change);
  if (!speaking) {
    const window = Math.floor(time / MOTION_WINDOW_SECONDS);
    silentMotionByWindow.set(window, [...(silentMotionByWindow.get(window) ?? []), change]);
  }
}

const [firstMotion, secondMotion] = motion;
const motionRate = firstMotion && secondMotion ? 1 / (secondMotion.time - firstMotion.time) : 0;
const fullWindowSamples = MOTION_WINDOW_SECONDS * motionRate;
const judgedWindows = [...silentMotionByWindow.values()].filter(
  (samples) => samples.length >= fullWindowSamples * MINIMUM_WINDOW_COVERAGE,
);
const stillestWindow = Math.min(...judgedWindows.map((samples) => mean(samples)));

const result = {
  frames: brightness.length,
  seconds: brightness.length / SAMPLE_RATE,
  bestOffsetSeconds: best.offset / SAMPLE_RATE,
  correlation: Number(best.correlation.toFixed(3)),
  correlationWithReversedVoice: Number(reversed.correlation.toFixed(3)),
  meanBrightnessSpeaking: Number(mean(speakingBrightness).toFixed(2)),
  meanBrightnessSilent: Number(mean(silentBrightness).toFixed(2)),
  speakingBrightnessRatio: Number(ratio.toFixed(3)),
  meanMotionSilent: Number(mean(silentMotion).toFixed(2)),
  meanMotionSpeaking: Number(mean(speakingMotion).toFixed(2)),
  silentMotionWindowsJudged: judgedWindows.length,
  meanMotionInStillestSilentWindow: Number(stillestWindow.toFixed(2)),
  thresholds: {
    correlation: MINIMUM_CORRELATION,
    marginOverReversed: MINIMUM_MARGIN_OVER_REVERSED,
    speakingBrightnessRatio: MINIMUM_SPEAKING_BRIGHTNESS_RATIO,
    silentMotionInEveryWindow: MINIMUM_SILENT_MOTION,
    motionWindowSeconds: MOTION_WINDOW_SECONDS,
  },
  pass:
    best.correlation >= MINIMUM_CORRELATION &&
    best.correlation - reversed.correlation >= MINIMUM_MARGIN_OVER_REVERSED &&
    ratio >= MINIMUM_SPEAKING_BRIGHTNESS_RATIO &&
    judgedWindows.length > 0 &&
    stillestWindow >= MINIMUM_SILENT_MOTION,
};
writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
