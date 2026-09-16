/**
 * Says whether the hologram on screen actually reacted to the voice.
 *
 * The film's Jarvis does not brighten or swell as he gets louder — his sphere
 * stays the same size and the same brightness, and speech shows as *activity*:
 * fragments turning over faster, the bright crescent splitting, the limb fraying,
 * and chips breaking off the rim on syllable onsets and in the gaps after them.
 * So this does not look for a brightness pulse. It looks for movement, and it
 * guards against a pulse appearing.
 *
 * It compares two series. The reference is the **agitation** envelope: the
 * recorded volume put through the same `perceivedLevel` and `advanceVoiceActivity`
 * the app's own UI thread runs, laid out on the replay's loop (a lead-in silence,
 * then the line, which is itself paced into chunks with silences between them) —
 * the same 0–1 value the drawing is handed. The measured series is the
 * hologram's **activity**: how much it changes from one tenth of a second to the
 * next (ffmpeg's `tblend` difference), smoothed with a half-second moving average
 * and resampled onto the brightness series' rate. The recording starts at an
 * unknown point in the loop, so the reference is slid across it and the
 * best-matching offset kept.
 *
 * It passes when activity follows agitation (Pearson correlation, with a reversed
 * reference as the control), when the hologram is clearly busier while Jarvis
 * speaks than while he is silent, when it still moves through every judged stretch
 * of silence, and when its brightness does *not* jump while he speaks. The
 * thresholds are fixed here, before any recording is measured, so a disappointing
 * run cannot quietly lower them. Brightness against agitation is reported as a
 * number to look at, and nothing passes or fails on it.
 *
 * The two frame-difference files are the same measurement over different crops:
 * the sphere alone for the silence rule, whose threshold counts change per pixel,
 * and a wider crop that takes in the chips for the activity rule, which is a ratio
 * and so does not care about the framing.
 *
 * Usage: bun measure-pulse.ts <recording JSON> <brightness YAVG file> <silence ms> <output JSON> <sphere motion YAVG file> <wide motion YAVG file>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { advanceVoiceActivity, createVoiceActivityState, perceivedLevel, SPEECH_LEVEL } from '../../src/voice-levels';

/** Activity must follow agitation at least this closely. */
const MINIMUM_CORRELATION = 0.5;
/**
 * And follow it this much more closely than it follows the same agitation played
 * backwards. Keeping the best of many offsets can find some correlation in any
 * two wobbly signals; a reversed reference has the same statistics but the wrong
 * timing, so it measures how much of the match is luck.
 */
const MINIMUM_MARGIN_OVER_REVERSED = 0.2;
/** And the hologram must be at least this much busier, on average, while he speaks than while he is silent. */
const MINIMUM_SPEAKING_ACTIVITY_RATIO = 1.3;
/**
 * And it must *not* flash with him: the film's sphere holds its brightness to
 * within a few percent while it talks. A little headroom above that is allowed
 * for the chips and the fraying, which are light outside the disc, but a hologram
 * whose mean brightness rides the voice this far has gone back to being a meter.
 */
const HIGHEST_SPEAKING_BRIGHTNESS_RATIO = 1.3;
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
/**
 * How long the moving average over the frame-difference series is. A single
 * tenth-of-a-second difference on an emulator is mostly whether screenrecord
 * emitted a new frame in that tenth at all; half a second of them is the
 * hologram's actual rate of change, which is what agitation is a claim about.
 */
const ACTIVITY_SMOOTHING_SECONDS = 0.5;

const SAMPLE_RATE = 25;

interface Recording {
  intervalMs: number;
  frames: { volume: number }[];
}

interface Sample {
  time: number;
  value: number;
}

/** Reads an ffmpeg `metadata=print` file of YAVG values into (time, value) pairs. */
function readYavgSeries(file: string): Sample[] {
  const samples: Sample[] = [];
  let time: number | undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const timeMatch = /pts_time:([\d.]+)/.exec(line);
    if (timeMatch?.[1]) time = Number(timeMatch[1]);
    const valueMatch = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (valueMatch?.[1] && time !== undefined) samples.push({ time, value: Number(valueMatch[1]) });
  }
  return samples;
}

/** Linear resample onto a fixed rate, so every series shares a time base. */
function resample(samples: Sample[], rate: number): number[] {
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
    result.push(before.value + (after.value - before.value) * weight);
  }
  return result;
}

/** Each frame difference replaced by the mean of those within half a window either side of it. */
function smooth(samples: Sample[], windowSeconds: number): Sample[] {
  const reach = windowSeconds / 2;
  return samples.map((sample) => {
    const within = samples.filter((other) => Math.abs(other.time - sample.time) <= reach);
    return {
      time: sample.time,
      value: within.reduce((sum, other) => sum + other.value, 0) / Math.max(1, within.length),
    };
  });
}

/**
 * The agitation the app would have been drawing from, sampled at `rate`, over one
 * loop: silence then the line.
 *
 * Two loops are run and the second kept. The tracker carries its history from
 * frame to frame — that is the whole point of it — so a run started at step 0
 * would begin with no past, while the app the recording caught had been looping
 * for minutes.
 */
function agitationLoop(
  recording: Recording,
  silenceMs: number,
  rate: number,
): { agitation: number[]; speaking: boolean[] } {
  const speechMs = recording.frames.length * recording.intervalMs;
  const loopMs = silenceMs + speechMs;
  const steps = Math.ceil((loopMs * rate) / 1000);
  const state = createVoiceActivityState();
  const agitation: number[] = [];
  const speaking: boolean[] = [];
  for (let step = 0; step < steps * 2; step++) {
    const position = ((step % steps) * 1000) / rate;
    const afterLeadIn = position >= silenceMs;
    const reading = afterLeadIn
      ? recording.frames[Math.floor((position - silenceMs) / recording.intervalMs)]
      : undefined;
    const level = perceivedLevel(reading?.volume ?? 0);
    advanceVoiceActivity(state, level, step === 0 ? 0 : 1 / rate);
    if (step >= steps) {
      agitation.push(state.agitation);
      // Speech is where the voice is actually speaking, not merely where the
      // recording is playing: the line is paced, with silences between its
      // chunks, and those silences are silence for this comparison too.
      speaking.push(level >= SPEECH_LEVEL);
    }
  }
  return { agitation, speaking };
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

const [recordingFile, brightnessFile, silenceMsText, outputFile, motionFile, activityFile] = process.argv.slice(2);
if (!recordingFile || !brightnessFile || !silenceMsText || !outputFile || !motionFile || !activityFile) {
  throw new Error(
    'Usage: bun measure-pulse.ts <recording JSON> <brightness file> <silence ms> <output JSON> <sphere motion file> <wide motion file>',
  );
}

const recording: Recording = JSON.parse(readFileSync(recordingFile, 'utf8'));
const brightness = resample(readYavgSeries(brightnessFile), SAMPLE_RATE);
const motion = readYavgSeries(motionFile);
const activity = resample(smooth(readYavgSeries(activityFile), ACTIVITY_SMOOTHING_SECONDS), SAMPLE_RATE);
const loop = agitationLoop(recording, Number(silenceMsText), SAMPLE_RATE);
const measured = Math.min(activity.length, brightness.length);

/** Slides one loop of `reference` across the measured series and keeps the best alignment. */
function bestAlignment(reference: number[], series: number[]): { offset: number; correlation: number } {
  let best = { offset: 0, correlation: -1 };
  for (let offset = 0; offset < reference.length; offset++) {
    const aligned = series.map((_, index) => reference[(index + offset) % reference.length] ?? 0);
    const score = correlation(aligned, series);
    if (score > best.correlation) best = { offset, correlation: score };
  }
  return best;
}

const measuredActivity = activity.slice(0, measured);
const best = bestAlignment(loop.agitation, measuredActivity);
const reversed = bestAlignment([...loop.agitation].reverse(), measuredActivity);

/** Whether the voice was speaking at measured step `index`, on the best alignment. */
function speakingAt(index: number): boolean {
  return loop.speaking[(index + best.offset) % loop.speaking.length] === true;
}

const speakingActivity: number[] = [];
const silentActivity: number[] = [];
const speakingBrightness: number[] = [];
const silentBrightness: number[] = [];
for (let index = 0; index < measured; index++) {
  const speaking = speakingAt(index);
  (speaking ? speakingActivity : silentActivity).push(activity[index] ?? 0);
  (speaking ? speakingBrightness : silentBrightness).push(brightness[index] ?? 0);
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const activityRatio = mean(speakingActivity) / Math.max(1e-6, mean(silentActivity));
const brightnessRatio = mean(speakingBrightness) / Math.max(1e-6, mean(silentBrightness));

// Movement during silence, judged on the raw frame differences rather than the
// smoothed ones: the question is whether the screen changed at all, and a moving
// average would let a frozen stretch borrow from the busy one beside it.
const silentMotionByWindow = new Map<number, number[]>();
for (const { time, value: change } of motion) {
  const step = Math.round(time * SAMPLE_RATE);
  if (step >= measured) break;
  if (speakingAt(step)) continue;
  const window = Math.floor(time / MOTION_WINDOW_SECONDS);
  silentMotionByWindow.set(window, [...(silentMotionByWindow.get(window) ?? []), change]);
}

const [firstMotion, secondMotion] = motion;
const motionRate = firstMotion && secondMotion ? 1 / (secondMotion.time - firstMotion.time) : 0;
const fullWindowSamples = MOTION_WINDOW_SECONDS * motionRate;
const judgedWindows = [...silentMotionByWindow.values()].filter(
  (samples) => samples.length >= fullWindowSamples * MINIMUM_WINDOW_COVERAGE,
);
const stillestWindow = Math.min(...judgedWindows.map((samples) => mean(samples)));

const result = {
  frames: measured,
  seconds: measured / SAMPLE_RATE,
  bestOffsetSeconds: best.offset / SAMPLE_RATE,
  activityCorrelation: Number(best.correlation.toFixed(3)),
  activityCorrelationWithReversedAgitation: Number(reversed.correlation.toFixed(3)),
  meanActivitySpeaking: Number(mean(speakingActivity).toFixed(3)),
  meanActivitySilent: Number(mean(silentActivity).toFixed(3)),
  speakingActivityRatio: Number(activityRatio.toFixed(3)),
  meanBrightnessSpeaking: Number(mean(speakingBrightness).toFixed(2)),
  meanBrightnessSilent: Number(mean(silentBrightness).toFixed(2)),
  speakingBrightnessRatio: Number(brightnessRatio.toFixed(3)),
  silentMotionWindowsJudged: judgedWindows.length,
  meanMotionInStillestSilentWindow: Number(stillestWindow.toFixed(2)),
  /** Reported so it can be watched, never required: the film's sphere holds still in brightness while it talks. */
  brightnessCorrelationReportedOnly: Number(
    bestAlignment(loop.agitation, brightness.slice(0, measured)).correlation.toFixed(3),
  ),
  thresholds: {
    activityCorrelation: MINIMUM_CORRELATION,
    marginOverReversedAgitation: MINIMUM_MARGIN_OVER_REVERSED,
    speakingActivityRatio: MINIMUM_SPEAKING_ACTIVITY_RATIO,
    highestSpeakingBrightnessRatio: HIGHEST_SPEAKING_BRIGHTNESS_RATIO,
    silentMotionInEveryWindow: MINIMUM_SILENT_MOTION,
    motionWindowSeconds: MOTION_WINDOW_SECONDS,
    activitySmoothingSeconds: ACTIVITY_SMOOTHING_SECONDS,
  },
  pass:
    best.correlation >= MINIMUM_CORRELATION &&
    best.correlation - reversed.correlation >= MINIMUM_MARGIN_OVER_REVERSED &&
    activityRatio >= MINIMUM_SPEAKING_ACTIVITY_RATIO &&
    brightnessRatio <= HIGHEST_SPEAKING_BRIGHTNESS_RATIO &&
    judgedWindows.length > 0 &&
    stillestWindow >= MINIMUM_SILENT_MOTION,
};
writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
