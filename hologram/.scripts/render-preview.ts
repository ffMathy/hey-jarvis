/**
 * Renders short clips of the sphere doing one thing each, to WebM, for looking at a change before it
 * is on a device: the vortex he arrives in, the lattice he listens with, and the greeting he says.
 *
 * Every frame goes through the same voice pipeline the app runs — see `simulated-performance.ts` —
 * so what a clip shows is what the view would draw, not an impression of it. And all of him is drawn
 * on the GPU, body and all, through `hologram/gpu` in headless Chromium (`render-preview-page.ts`,
 * opened by `render-page.ts`), as the phone and the watch draw him.
 *
 * Usage, from the repository root:
 *   bun hologram/.scripts/render-preview.ts <output directory> [ffmpeg]
 *
 * The ffmpeg only needs an MJPEG decoder and a VP8 encoder, which is why it is a parameter: the
 * Playwright build of ffmpeg has exactly those and nothing else.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GREETING_SECONDS, MATERIALISE_SECONDS, THOUGHT_FADE_SECONDS } from '../src/index';
import { bytesOf, openRenderPage } from './render-page';
import { createPerformance, type SimulatedMoment } from './simulated-performance';

const SIZE = 540;
const FPS = 60;
const FRAME_SECONDS = 1 / FPS;
/** A beat of black before he appears, so the start of the arrival is seen. */
const BEFORE_SECONDS = 0.4;

/** A clip: how long it runs, and what is happening `seconds` after he began to appear. */
interface Clip {
  name: string;
  seconds: number;
  at: (seconds: number) => Omit<SimulatedMoment, 'hologramSeconds' | 'leaving' | 'thinkingWanted'>;
}

const CLIPS: Clip[] = [
  // The vortex, then a moment of him simply there.
  { name: 'arrival', seconds: MATERIALISE_SECONDS + 1.6, at: () => ({ mood: undefined, moodSeconds: 0 }) },
  // Someone talking to him — three phrases with pauses between — while he is silent.
  {
    name: 'listening',
    seconds: MATERIALISE_SECONDS + 12,
    at: (seconds) => ({
      mood: undefined,
      moodSeconds: 0,
      userSeconds: seconds > MATERIALISE_SECONDS ? seconds - MATERIALISE_SECONDS : undefined,
    }),
  },
  // Summoned: the greeting starts as he appears, as it does in the apps, and plays out.
  {
    name: 'greeting',
    seconds: GREETING_SECONDS + 1.6,
    at: (seconds) => ({ mood: undefined, moodSeconds: 0, greetingSeconds: seconds }),
  },
];

async function main() {
  const [output = 'hologram-preview', ffmpeg = 'ffmpeg'] = process.argv.slice(2);
  mkdirSync(output, { recursive: true });
  const { page, close } = await openRenderPage('render-preview-page.ts');
  try {
    await page.evaluate((size) => window.preview.setUp(size), SIZE);
    for (const clip of CLIPS) {
      const perform = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);
      const jpegs: Uint8Array[] = [];
      for (let index = 0; index * FRAME_SECONDS <= BEFORE_SECONDS + clip.seconds; index++) {
        const seconds = index * FRAME_SECONDS - BEFORE_SECONDS;
        const frame =
          seconds >= 0
            ? perform({ ...clip.at(seconds), hologramSeconds: seconds, thinkingWanted: false, leaving: false })
            : null;
        jpegs.push(bytesOf(await page.evaluate((drawn) => window.preview.frame(drawn), frame)));
      }
      encode(output, clip.name, jpegs, ffmpeg);
    }
  } finally {
    await close();
  }
}

/** Where a clip's frames are gathered — concatenated JPEGs — emptied for a fresh clip. */
function startFrames(output: string, name: string) {
  const frames = join(output, `jarvis-${name}.mjpeg`);
  writeFileSync(frames, new Uint8Array());
  return frames;
}

/** Stitches JPEG frames into `<name>.webm` in `output`. */
function encode(output: string, name: string, jpegs: Uint8Array[], ffmpeg: string) {
  writeFileSync(startFrames(output, name), Buffer.concat(jpegs));
  stitchFrames(output, name, ffmpeg);
}

/**
 * Stitches the frames gathered for `name` into `<name>.webm`, and removes them. This ffmpeg may
 * have no pipe protocol, so the frames go through a file of concatenated JPEGs.
 */
function stitchFrames(output: string, name: string, ffmpeg: string) {
  const file = join(output, `jarvis-${name}.webm`);
  const frames = join(output, `jarvis-${name}.mjpeg`);
  const result = spawnSync(
    ffmpeg,
    ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', `file:${frames}`].concat([
      '-c:v',
      'libvpx',
      '-b:v',
      '8M',
      '-crf',
      '8',
      '-an',
      file,
    ]),
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  rmSync(frames);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${name}`);
  }
  console.log(`${file}: done`);
}

await main();
