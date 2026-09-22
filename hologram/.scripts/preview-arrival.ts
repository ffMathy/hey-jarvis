/**
 * Renders Jarvis arriving, once per arrival style and once with both side by side, to WebM.
 *
 * Usage, from the repository root:
 *   bun hologram/.scripts/preview-arrival.ts <output directory> [ffmpeg]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageFormat } from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import {
  type ArrivalStyle,
  createHologramResources,
  createHologramScene,
  drawHologram,
  type HologramFrame,
  MATERIALISE_SECONDS,
  VOICE_BAND_COUNT,
} from '../src/index';

const SIZE = 540;
const FPS = 60;
const BEFORE_SECONDS = 0.4;
const AFTER_SECONDS = 1.6;

interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

function frameAt(time: number): HologramFrame {
  return {
    time,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: Math.min(1, time / MATERIALISE_SECONDS),
    thinking: 0,
    presence: 1,
    density: 1,
  };
}

async function main() {
  const [output = 'arrival-preview', ffmpeg = 'ffmpeg'] = process.argv.slice(2);
  mkdirSync(output, { recursive: true });
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) {
    throw new Error('CanvasKit did not load');
  }
  const skia = JsiSkApi(globalThis.CanvasKit);
  const hologramOf = (style: ArrivalStyle) => {
    const scene = createHologramScene(1337, undefined, style);
    return { scene, resources: createHologramResources(skia, scene) };
  };
  const fade = hologramOf('fade');
  const vortex = hologramOf('vortex');
  const clips = [
    { name: 'fade', shown: [fade] },
    { name: 'vortex', shown: [vortex] },
    { name: 'side-by-side', shown: [fade, vortex] },
  ];
  for (const clip of clips) {
    const surface = skia.Surface.Make(SIZE * clip.shown.length, SIZE);
    if (!surface) {
      throw new Error('Could not make a surface');
    }
    const canvas = surface.getCanvas();
    const jpegs: Uint8Array[] = [];
    const total = BEFORE_SECONDS + MATERIALISE_SECONDS + AFTER_SECONDS;
    for (let index = 0; index / FPS <= total; index++) {
      const seconds = index / FPS;
      canvas.clear(skia.Color('#000000'));
      if (seconds >= BEFORE_SECONDS) {
        clip.shown.forEach(({ scene, resources }, place) => {
          canvas.save();
          canvas.translate(place * SIZE, 0);
          drawHologram(canvas, SIZE, frameAt(seconds - BEFORE_SECONDS), scene, resources);
          canvas.restore();
        });
      }
      surface.flush();
      const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 95);
      if (!bytes) {
        throw new Error('Could not encode a frame');
      }
      jpegs.push(bytes);
    }
    const file = join(output, `jarvis-arrival-${clip.name}.webm`);
    // This ffmpeg may have no pipe protocol, so the frames go through a file of concatenated JPEGs.
    const frames = join(output, `jarvis-arrival-${clip.name}.mjpeg`);
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
      throw new Error(`ffmpeg failed for ${clip.name}`);
    }
    console.log(`${file}: ${jpegs.length} frames`);
  }
}

await main();
