/**
 * Renders short clips of the sphere doing one thing each, to WebM, for looking at a change before it
 * is on a device: the vortex he arrives in, the clusters he listens with, and the greeting he says —
 * and then every candidate way of listening (`LISTENING_STYLES`), one clip each and all of them side
 * by side, named, for choosing between.
 *
 * Every frame goes through the same voice pipeline the app runs — see `simulated-performance.ts` —
 * so what a clip shows is what the view would draw, not an impression of it.
 *
 * Usage, from the repository root:
 *   bun hologram/.scripts/render-preview.ts <output directory> [ffmpeg]
 *
 * The ffmpeg only needs an MJPEG decoder and a VP8 encoder, which is why it is a parameter: the
 * Playwright build of ffmpeg has exactly those and nothing else.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageFormat } from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import {
  createHologramResources,
  createHologramScene,
  drawHologram,
  GREETING_SECONDS,
  LISTENING_STYLES,
  type ListeningStyle,
  MATERIALISE_SECONDS,
} from '../src/index';
import { createPerformance, type SimulatedMoment } from './simulated-performance';

const SIZE = 540;
const FPS = 60;
const FRAME_SECONDS = 1 / FPS;
/** `THOUGHT_FADE_SECONDS` in `hologram-view.tsx`. */
const THOUGHT_FADE_SECONDS = 0.45;
/** A beat of black before he appears, so the start of the arrival is seen. */
const BEFORE_SECONDS = 0.4;

interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

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
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) {
    throw new Error('CanvasKit did not load');
  }
  const skia = JsiSkApi(globalThis.CanvasKit);
  const scene = createHologramScene(1337);
  const resources = createHologramResources(skia, scene);
  const surface = skia.Surface.Make(SIZE, SIZE);
  if (!surface) {
    throw new Error('Could not make a surface');
  }
  const canvas = surface.getCanvas();

  for (const clip of CLIPS) {
    const perform = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);
    const jpegs: Uint8Array[] = [];
    for (let index = 0; index * FRAME_SECONDS <= BEFORE_SECONDS + clip.seconds; index++) {
      const seconds = index * FRAME_SECONDS - BEFORE_SECONDS;
      canvas.clear(skia.Color('#000000'));
      if (seconds >= 0) {
        const moment = { ...clip.at(seconds), hologramSeconds: seconds, thinkingWanted: false, leaving: false };
        drawHologram(canvas, SIZE, perform(moment), scene, resources);
      }
      surface.flush();
      jpegs.push(snapshot(surface));
    }
    encode(output, clip.name, jpegs, ffmpeg);
  }

  await renderListeningStyles(skia, output, ffmpeg);
}

/** The surface's picture as a JPEG, which is what the frames are stitched from. */
function snapshot(surface: {
  makeImageSnapshot: () => { encodeToBytes: (format: ImageFormat, quality: number) => Uint8Array | null };
}) {
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 95);
  if (!bytes) {
    throw new Error('Could not encode a frame');
  }
  return bytes;
}

/** How long each listening candidate is shown for: three phrases of somebody talking and the pauses between. */
const LISTENING_SECONDS = 11;
/** How big each candidate is drawn in the side-by-side clip, and how big its name is. */
const SIDE_BY_SIDE_SIZE = 360;
const NAME_SIZE = 26;

/**
 * Every way of listening in {@link LISTENING_STYLES}: one clip each, already formed, while somebody
 * talks to him, and one clip of all of them side by side with their names under them.
 */
async function renderListeningStyles(skia: ReturnType<typeof JsiSkApi>, output: string, ffmpeg: string) {
  const typeface = skia.Typeface.MakeFreeTypeFaceFromData(
    skia.Data.fromBytes(readFileSync(join(import.meta.dir, 'device-art', 'roboto-light.ttf'))),
  );
  if (!typeface) {
    throw new Error('Could not load Roboto — run ./hologram/.scripts/prepare-device-art.sh');
  }
  const font = skia.Font(typeface, NAME_SIZE);
  const ink = skia.Paint();
  ink.setAntiAlias(true);
  ink.setColor(skia.Color('#e2e8f0'));

  const styles = LISTENING_STYLES.map((style: ListeningStyle) => {
    const scene = createHologramScene(1337, undefined, style);
    return { style, scene, resources: createHologramResources(skia, scene) };
  });
  const single = skia.Surface.Make(SIZE, SIZE);
  const together = skia.Surface.Make(SIDE_BY_SIDE_SIZE * styles.length, SIDE_BY_SIDE_SIZE + NAME_SIZE * 2);
  if (!single || !together) {
    throw new Error('Could not make a surface');
  }
  const alone: Uint8Array[][] = styles.map(() => []);
  const all: Uint8Array[] = [];
  // One performance per style, each advanced the same way, so every candidate hears the same voice.
  const performs = styles.map(() => createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS));
  for (let index = 0; index * FRAME_SECONDS <= LISTENING_SECONDS; index++) {
    const seconds = index * FRAME_SECONDS;
    // Long past arriving: he is simply there, and somebody is talking to him.
    const moment = {
      mood: undefined,
      moodSeconds: 0,
      userSeconds: seconds,
      hologramSeconds: MATERIALISE_SECONDS + seconds,
      thinkingWanted: false,
      leaving: false,
    };
    const frames = performs.map((perform) => perform(moment));
    const canvas = together.getCanvas();
    canvas.clear(skia.Color('#000000'));
    styles.forEach(({ style, scene, resources }, place) => {
      const one = single.getCanvas();
      one.clear(skia.Color('#000000'));
      drawHologram(one, SIZE, frames[place], scene, resources);
      single.flush();
      alone[place]?.push(snapshot(single));
      canvas.save();
      canvas.translate(place * SIDE_BY_SIDE_SIZE, 0);
      drawHologram(canvas, SIDE_BY_SIDE_SIZE, frames[place], scene, resources);
      canvas.restore();
      const name = style[0]?.toUpperCase() + style.slice(1);
      const left = place * SIDE_BY_SIDE_SIZE + (SIDE_BY_SIDE_SIZE - font.getTextWidth(name)) / 2;
      canvas.drawText(name, left, SIDE_BY_SIDE_SIZE + NAME_SIZE, ink, font);
    });
    together.flush();
    all.push(snapshot(together));
  }
  styles.forEach(({ style }, place) => {
    encode(output, `listening-${style}`, alone[place] ?? [], ffmpeg);
  });
  encode(output, 'listening-side-by-side', all, ffmpeg);
}

/** Stitches JPEG frames into `<name>.webm` in `output`. */
function encode(output: string, name: string, jpegs: Uint8Array[], ffmpeg: string) {
  const file = join(output, `jarvis-${name}.webm`);
  // This ffmpeg may have no pipe protocol, so the frames go through a file of concatenated JPEGs.
  const frames = join(output, `jarvis-${name}.mjpeg`);
  writeFileSync(frames, Buffer.concat(jpegs));
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
  console.log(`${file}: ${jpegs.length} frames`);
}

await main();
