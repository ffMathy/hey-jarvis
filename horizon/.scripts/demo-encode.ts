import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Turning the demo's frames into a WebM: finding an ffmpeg that can, working out where the
 * greeting goes under the frames, decoding it for the soundtrack (`demo-soundtrack.ts`), and the
 * encode itself.
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
 * The filter graph for the encode: the frames faded in and out as `[video]`, and the soundtrack
 * faded out with them as `[audio]`.
 *
 * The frames arrive as input 0 and the soundtrack as input 1: a WAV exactly as long as the film,
 * already mixed and placed (`demo-soundtrack.ts`), so all that is left to do to it is the ending.
 */
export function filterGraph(timing: EncodeTiming): string {
  const fadeOutStart = seconds(timing.seconds - timing.fadeOutSeconds);
  const fadeOut = seconds(timing.fadeOutSeconds);
  const video =
    `[0:v]fade=t=in:st=0:d=${seconds(timing.fadeInSeconds)},` +
    `fade=t=out:st=${fadeOutStart}:d=${fadeOut},format=yuv420p[video]`;
  const audio = `[1:a]atrim=duration=${seconds(timing.seconds)},afade=t=out:st=${fadeOutStart}:d=${fadeOut}[audio]`;
  return `${video};${audio}`;
}

/**
 * The ffmpeg arguments that encode `framePattern` (a printf pattern, as ffmpeg's image2 reads it)
 * and `soundtrack` (the WAV `demo-soundtrack.ts` writes) into `output`: VP9 at constant quality and
 * Opus, at `timing.framesPerSecond`.
 *
 * VP9 in one pass with a quality target rather than a bitrate: the room is mostly still grey and
 * he is small bright detail, which a bitrate spreads badly and a quality target does not. `good`
 * with `cpu-used 2` is libvpx's usual trade for an offline encode.
 */
export function encodeArguments(
  framePattern: string,
  soundtrack: string,
  output: string,
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
    soundtrack,
    '-filter_complex',
    filterGraph(timing),
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

/**
 * The ffmpeg arguments that decode `recording` to one channel of raw 32-bit float samples at
 * `sampleRate`, on standard output: a voice from one point in the room has one channel, and the
 * soundtrack is worked out at the rate the Opus will be encoded at.
 */
export function decodeArguments(recording: string, sampleRate: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    recording,
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-f',
    'f32le',
    'pipe:1',
  ];
}

/** `recording`, decoded by `ffmpeg` to mono samples at `sampleRate` (see {@link decodeArguments}). */
export async function decodeMono(ffmpeg: string, recording: string, sampleRate: number): Promise<Float32Array> {
  const run = Bun.spawn([ffmpeg, ...decodeArguments(recording, sampleRate)], { stdout: 'pipe', stderr: 'pipe' });
  const [bytes, said] = await Promise.all([new Response(run.stdout).arrayBuffer(), new Response(run.stderr).text()]);
  const code = await run.exited;
  if (code !== 0) throw new Error(`ffmpeg could not decode ${recording} (exit ${code}):\n${said}`);
  return new Float32Array(bytes, 0, Math.floor(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT));
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
