import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Turning the demo's frames into a WebM: finding an ffmpeg that can, laying the greeting under
 * the frames where he says it, and the encode itself.
 */

/** One stretch of video in which sample mode had him speaking, in video seconds. */
export interface SpeakingSpan {
  start: number;
  end: number;
}

/** One playing of the recording: where it starts in the video, and how much of it is heard. */
export interface GreetingClip {
  start: number;
  duration: number;
}

/**
 * Where the greeting is heard, for the spans in which he speaks.
 *
 * Sample mode's speaking is the greeting's measurement played over and over — `seconds` into a
 * repeat every `repeatSeconds`, from the moment the mood was chosen — so the recording goes under
 * the picture on the same beat, and he moves exactly as the words do. A span that ends mid-word
 * (a select moved him on, or the video ended) cuts the recording there, as it cuts his speech.
 *
 * No repeat starts at or after `lastStart` — the fade out, where a first syllable cut off by the
 * end of the film would sound like a fault rather than an ending.
 */
export function greetingClips(
  spans: readonly SpeakingSpan[],
  recordingSeconds: number,
  repeatSeconds: number,
  lastStart = Number.POSITIVE_INFINITY,
): GreetingClip[] {
  const clips: GreetingClip[] = [];
  for (const span of spans) {
    for (let start = span.start; start < Math.min(span.end, lastStart); start += repeatSeconds) {
      const duration = Math.min(recordingSeconds, span.end - start);
      // A sliver under a frame long is a click, not a word.
      if (duration > 0.05) clips.push({ start, duration });
    }
  }
  return clips;
}

/** Everything the encode needs to know about the film's length and fades. */
export interface EncodeTiming {
  seconds: number;
  framesPerSecond: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

/** Seconds as ffmpeg reads them: fixed, so no exponent ever reaches its parser. */
function seconds(value: number): string {
  return Math.max(0, value).toFixed(3);
}

/**
 * The filter graph for the encode: the frames faded in and out as `[video]`, and the greeting's
 * clips laid on a silent track as `[audio]`.
 *
 * The frames arrive as input 0 and the recording as input 1. Every clip is delayed to its start
 * and padded to the full length before they are mixed: ffmpeg's `amix` divides by the number of
 * inputs still playing, so inputs that ended at different times would change each other's
 * loudness as they dropped out. All the same length, the division is constant and `volume` undoes
 * it exactly — the clips never overlap, so nothing is summed that would clip.
 */
export function filterGraph(clips: readonly GreetingClip[], timing: EncodeTiming): string {
  const fadeOutStart = timing.seconds - timing.fadeOutSeconds;
  const video =
    `[0:v]fade=t=in:st=0:d=${seconds(timing.fadeInSeconds)},` +
    `fade=t=out:st=${seconds(fadeOutStart)}:d=${seconds(timing.fadeOutSeconds)},format=yuv420p[video]`;
  const ending = `atrim=duration=${seconds(timing.seconds)},afade=t=out:st=${seconds(fadeOutStart)}:d=${seconds(timing.fadeOutSeconds)}[audio]`;
  if (clips.length === 0) {
    return `${video};aevalsrc=0|0:c=stereo:s=48000:d=${seconds(timing.seconds)},${ending}`;
  }
  const labels = clips.map((_, index) => `greeting${index}`);
  const split = `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${clips.length}${labels.map((label) => `[${label}]`).join('')}`;
  const placed = clips.map((clip, index) => {
    const delay = Math.round(clip.start * 1000);
    return `[${labels[index]}]atrim=duration=${seconds(clip.duration)},adelay=${delay}|${delay},apad=whole_dur=${seconds(timing.seconds)}[clip${index}]`;
  });
  const mix = `${clips.map((_, index) => `[clip${index}]`).join('')}amix=inputs=${clips.length}:dropout_transition=0,volume=${clips.length},${ending}`;
  return [video, split, ...placed, mix].join(';');
}

/**
 * The ffmpeg arguments that encode `framePattern` (a printf pattern, as ffmpeg's image2 reads it)
 * and `recording` into `output`: VP9 at constant quality and Opus, at `timing.framesPerSecond`.
 *
 * VP9 in one pass with a quality target rather than a bitrate: the room is mostly still grey and
 * he is small bright detail, which a bitrate spreads badly and a quality target does not. `good`
 * with `cpu-used 2` is libvpx's usual trade for an offline encode.
 */
export function encodeArguments(
  framePattern: string,
  recording: string,
  output: string,
  clips: readonly GreetingClip[],
  timing: EncodeTiming,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(timing.framesPerSecond),
    '-i',
    framePattern,
    '-i',
    recording,
    '-filter_complex',
    filterGraph(clips, timing),
    '-map',
    '[video]',
    '-map',
    '[audio]',
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '24',
    '-b:v',
    '0',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-row-mt',
    '1',
    '-g',
    String(timing.framesPerSecond * 8),
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    '-t',
    seconds(timing.seconds),
    output,
  ];
}

/** Whether `ffmpeg` has both encoders the film needs. */
async function canEncode(ffmpeg: string): Promise<boolean> {
  try {
    const run = Bun.spawn([ffmpeg, '-hide_banner', '-encoders'], { stdout: 'pipe', stderr: 'ignore' });
    const listing = await new Response(run.stdout).text();
    await run.exited;
    return listing.includes('libvpx-vp9') && listing.includes('libopus');
  } catch {
    return false;
  }
}

/**
 * The first ffmpeg that can encode VP9 and Opus: FFMPEG_PATH when it is set, then the one on the
 * PATH, then Playwright's.
 *
 * Playwright's own ffmpeg is last because it is built only for recording test videos — VP8, and
 * no PNG decoder — so it is only ever used if a later Playwright ships a fuller one.
 */
export async function findFfmpeg(): Promise<string> {
  const candidates: string[] = [];
  const configured = process.env.FFMPEG_PATH;
  if (configured !== undefined && configured !== '') candidates.push(configured);
  const onPath = Bun.which('ffmpeg');
  if (onPath !== null) candidates.push(onPath);
  const playwrightCache = path.join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(playwrightCache)) {
    for (const folder of readdirSync(playwrightCache).filter((name) => name.startsWith('ffmpeg-'))) {
      candidates.push(path.join(playwrightCache, folder, 'ffmpeg-linux'));
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && (await canEncode(candidate))) return candidate;
  }
  throw new Error(
    `No ffmpeg with libvpx-vp9 and libopus was found (tried: ${candidates.join(', ') || 'none'}). ` +
      'Install one (apt install ffmpeg) or point FFMPEG_PATH at it.',
  );
}

/** Runs `ffmpeg` with `args`, and throws with what it said if it fails. */
export async function runFfmpeg(ffmpeg: string, args: readonly string[]): Promise<void> {
  const run = Bun.spawn([ffmpeg, ...args], { stdout: 'ignore', stderr: 'pipe' });
  const said = await new Response(run.stderr).text();
  const code = await run.exited;
  if (code !== 0) throw new Error(`ffmpeg failed (exit ${code}):\n${said}`);
}
