/**
 * Renders every picture the Play Console asks for before it will take a listing.
 *
 * The store form has four required slots, and each has rules that a picture either obeys or is
 * rejected for. They are encoded as {@link ASSETS} rather than described in prose, and
 * {@link check} measures each finished file against them, so a rule that changes is a line to edit
 * and a run that would be rejected fails here instead of in the browser:
 *
 * | Slot                | Size                  | Rules                                        |
 * | ------------------- | --------------------- | -------------------------------------------- |
 * | App icon            | 512×512               | PNG or JPEG, at most 1 MB                     |
 * | Feature graphic     | 1024×500              | PNG or JPEG, at most 15 MB                    |
 * | Phone screenshots   | 1080×1920 (9:16)      | 2-8 of them, at most 8 MB each, sides 320-3840 |
 * | Wear OS screenshots | 1024×1024 (1:1)       | up to 8, at most 8 MB each, **no transparency**, sides 384-3840 |
 *
 * Four phone screenshots rather than the two Play insists on, because four with a shortest side of
 * at least 1080 is what it takes to be eligible for promotion — the form says so in a note under
 * the slot, and four costs nothing here.
 *
 * **Everything is opaque.** Wear screenshots are required to be, and the rest would be composited
 * onto whatever the Console and the store app happen to use; a transparent sphere on white is not
 * what anyone would be agreeing to ship. So each one is drawn onto the same near-black wash the
 * repository cover uses, which is also what the app itself is.
 *
 * What is drawn is the app rather than an advertisement for it: the same `drawHologram` both apps
 * call, driven by the same simulated voice the README clips use — see `simulated-performance.ts`.
 * The four phone shots are four things he genuinely does, in order: waiting, answering quietly,
 * answering loudly, and thinking. There is no invented copy over them, because the screen has no
 * text on it and a screenshot claiming otherwise would be a lie about the product.
 *
 * Usage, from the repository root:
 *   bun hologram/.scripts/render-play-assets.ts
 *
 * Writes into `docs/play-assets/`. Needs `device-art/roboto-light.ttf`, which
 * `prepare-device-art.sh` fetches, and `ffmpeg` on the path — see {@link dropAlphaChannel}.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TileMode } from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import { createHologramResources, createHologramScene, drawHologram, type SimulatedMood } from '../src/index';
import { createPerformance, findLoudestMoment, type SimulatedFrame, stillMoment } from './simulated-performance';

/** Every particle, as the cover does: nothing here is racing a screen. */
const PARTICLES = 1300;

/** The clock the simulated voice is advanced on, matching the clips. */
const FRAMES_PER_SECOND = 60;
const FRAME_SECONDS = 1 / FRAMES_PER_SECOND;

/** How long a thought takes to settle in: `THOUGHT_FADE_SECONDS` in `hologram-view.tsx`. */
const THOUGHT_FADE_SECONDS = 0.45;

/** How far into a speech to look for its loudest instant. */
const LISTEN_SECONDS = 9;

/** What everything sits on: the app's own near-black, lifted a little toward the middle. */
const BACKDROP = ['#0a0e16', '#141c2b', '#070a10'];

/** Where the fetched artwork lives. See `device-art/NOTICE.md`. */
const DEVICE_ART = join(import.meta.dir, 'device-art');

/**
 * How big the drawing's square is on a screenshot, as a share of the screen's shortest side.
 *
 * Bigger than the screen, which is not a mistake: `useWholeScreenHologramSize` gives the app
 * `(shortest - 20dp) × 1.35`, because the drawing clips at the edge of its own square and the chips
 * Jarvis throws on a syllable travel well past the limb — with the square *at* the screen they were
 * cut off in mid-air just inside the bezel. The screen does the cutting instead, and an edge there
 * is invisible because there is nothing past it to compare against.
 *
 * So a screenshot has to overflow too, or it would show a sphere half the size of the real one with
 * a field of empty black around it. The 20dp is about 60px at the density of a 1080-wide phone,
 * which is where the 1.32 comes from.
 */
const SCREEN_SQUARE_SHARE = 1.32;

/** The two pictures that are not screenshots, and are composed rather than captured. */
const ICON_SPHERE_SHARE = 0.92;
const FEATURE_SPHERE_SHARE = 0.78;

/** The wordmark on the feature graphic, which is the only picture here with any text on it. */
const NAME = 'JARVIS';
const NAME_SIZE = 78;
const NAME_TRACKING = 0.34;
const NAME_INK = '#ffd18a';

/** Play's ceilings, in bytes, so {@link check} can measure rather than trust. */
const ONE_MEGABYTE = 1024 * 1024;

type SkiaApi = ReturnType<typeof JsiSkApi>;
type SkiaSurface = NonNullable<ReturnType<SkiaApi['Surface']['MakeOffscreen']>>;
type SkiaCanvas = ReturnType<SkiaSurface['getCanvas']>;

/** Where `LoadSkiaWeb` leaves CanvasKit once the WebAssembly is up, as in the drawing's tests. */
interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

/**
 * One picture Play wants, and what would make it refuse it.
 *
 * `mood` is what Jarvis is doing in it; `undefined` is him waiting, which is what the app shows
 * before anyone has said anything.
 */
interface Asset {
  name: string;
  width: number;
  height: number;
  largestBytes: number;
  mood: SimulatedMood | undefined;
  /** Whether to run the voice to its loudest instant first, rather than opening on it. */
  loudest?: boolean;
  /** The sphere's share of the shortest side. */
  share?: number;
  /** The wordmark, on the one picture that has it. */
  wordmark?: boolean;
}

const PHONE_WIDTH = 1080;
const PHONE_HEIGHT = 1920;
const WATCH_SIDE = 1024;

const ASSETS: Asset[] = [
  {
    name: 'icon-512.png',
    width: 512,
    height: 512,
    largestBytes: ONE_MEGABYTE,
    mood: 'speaking',
    share: ICON_SPHERE_SHARE,
  },
  {
    name: 'feature-graphic-1024x500.png',
    width: 1024,
    height: 500,
    largestBytes: 15 * ONE_MEGABYTE,
    mood: 'speaking',
    loudest: true,
    wordmark: true,
    share: FEATURE_SPHERE_SHARE,
  },

  // The four things he does, in the order you would meet them.
  {
    name: 'phone-1-waiting.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: undefined,
  },
  {
    name: 'phone-2-answering.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: 'speaking',
  },
  {
    name: 'phone-3-mid-sentence.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: 'speaking',
    loudest: true,
  },
  {
    name: 'phone-4-thinking.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: 'thinking',
  },

  // The same four on a round screen. Square files, because Play wants 1:1 and the watch app draws
  // black to the corners anyway — which is not a compromise on an OLED, it is the screen off.
  {
    name: 'watch-1-waiting.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: undefined,
  },
  {
    name: 'watch-2-answering.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: 'speaking',
  },
  {
    name: 'watch-3-mid-sentence.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: 'speaking',
    loudest: true,
  },
  {
    name: 'watch-4-thinking.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    mood: 'thinking',
  },
];

type SkiaFont = ReturnType<SkiaApi['Font']>;

/**
 * Runs the simulated voice forward to the instant this picture wants, and reports that frame.
 *
 * From nothing every time, because the easing, the activity tracker and the clock all carry from
 * one frame to the next — there is no way to jump to a moment, only to walk to it.
 */
function performTo(mood: SimulatedMood | undefined, seconds: number): SimulatedFrame {
  const perform = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);
  let frame = perform(stillMoment(0, mood));
  for (let at = FRAME_SECONDS; at <= seconds; at += FRAME_SECONDS) {
    frame = perform(stillMoment(at, mood));
  }
  return frame;
}

/** The near-black wash everything is drawn onto, so no picture ships with an alpha channel to lose. */
function paintBackdrop(skia: SkiaApi, canvas: SkiaCanvas, width: number, height: number) {
  canvas.clear(skia.Color(BACKDROP[0] ?? '#000000'));

  const backdrop = skia.Paint();
  backdrop.setShader(
    skia.Shader.MakeRadialGradient(
      { x: width / 2, y: height / 2 },
      Math.max(width, height) * 0.62,
      BACKDROP.map((colour) => skia.Color(colour)),
      [0, 0.45, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(skia.XYWHRect(0, 0, width, height), backdrop);
}

/**
 * The wordmark, laid out along a line with the tracking the cover uses.
 *
 * Letter by letter rather than as one string, because the space between them is the whole look and
 * Skia has no letter-spacing of its own.
 */
function drawWordmark(
  skia: SkiaApi,
  canvas: SkiaCanvas,
  font: SkiaFont,
  middleY: number,
  rightOf: number,
  width: number,
) {
  const letters = [...NAME];
  const tracking = NAME_TRACKING * font.getSize();
  const widths = letters.map((letter) => font.getTextWidth(letter));
  const total = widths.reduce((sum, each) => sum + each, 0) + tracking * (letters.length - 1);

  const ink = skia.Paint();
  ink.setColor(skia.Color(NAME_INK));
  ink.setAntiAlias(true);

  let x = rightOf + (width - total) / 2;
  for (const [index, letter] of letters.entries()) {
    canvas.drawText(letter, x, middleY + font.getSize() / 3, ink, font);
    x += (widths[index] ?? 0) + tracking;
  }
}

/** Draws one asset and returns its PNG bytes. */
function render(
  skia: SkiaApi,
  asset: Asset,
  frame: SimulatedFrame,
  scene: ReturnType<typeof createHologramScene>,
  resources: ReturnType<typeof createHologramResources>,
  font: SkiaFont,
): Uint8Array {
  const surface = skia.Surface.MakeOffscreen(asset.width, asset.height) ?? skia.Surface.Make(asset.width, asset.height);
  if (!surface) {
    throw new Error(`Could not make a surface for ${asset.name}`);
  }
  const canvas = surface.getCanvas();
  paintBackdrop(skia, canvas, asset.width, asset.height);

  // The feature graphic is the one picture that is not just him: he takes the left, his name the
  // right. Everywhere else he is centred, because everywhere else he is the whole screen.
  const shortest = Math.min(asset.width, asset.height);
  const sphere = Math.round(shortest * (asset.share ?? SCREEN_SQUARE_SHARE));
  const middleX = asset.wordmark ? sphere / 2 + shortest * 0.12 : asset.width / 2;

  canvas.save();
  canvas.translate(middleX - sphere / 2, asset.height / 2 - sphere / 2);
  drawHologram(canvas, sphere, frame, scene, resources);
  canvas.restore();

  if (asset.wordmark) {
    const from = middleX + sphere / 2;
    drawWordmark(skia, canvas, font, asset.height / 2, from, asset.width - from);
  }

  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes();
  if (!bytes) {
    throw new Error(`Could not encode ${asset.name}`);
  }
  return bytes;
}

/**
 * Rewrites a PNG with no alpha channel at all.
 *
 * Skia hands back RGBA, and every pixel it draws here is already fully opaque — the backdrop goes
 * down first and nothing punches through it. But "opaque" and "has no alpha channel" are different
 * claims, and the Wear OS slot asks for the second one: a picture *with* transparency is refused,
 * and the check is on the channel rather than on what is in it. So the channel goes, which also
 * takes about a fifth off every file.
 *
 * ffmpeg rather than something in-process because there is no PNG encoder here that can be told to
 * drop a channel, and the renderer beside this one already requires ffmpeg for its stitching.
 */
function dropAlphaChannel(path: string) {
  const withAlpha = `${path}.rgba.png`;
  writeFileSync(withAlpha, readFileSync(path));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', withAlpha, '-pix_fmt', 'rgb24', path]);
  } finally {
    rmSync(withAlpha, { force: true });
  }
}

/**
 * Measures a finished file against the rule that would have it rejected.
 *
 * Play's own failures are late and unhelpful — an upload accepted and a listing that will not save
 * — so the same limits are checked here, where the answer is one line and the fix is one constant.
 */
function check(asset: Asset, path: string): string {
  const { size } = statSync(path);
  if (size > asset.largestBytes) {
    throw new Error(
      `${asset.name} is ${(size / ONE_MEGABYTE).toFixed(2)} MB, over Play's ${(asset.largestBytes / ONE_MEGABYTE).toFixed(0)} MB for that slot`,
    );
  }
  return `${asset.name} — ${asset.width}×${asset.height}, ${(size / ONE_MEGABYTE).toFixed(2)} MB`;
}

async function main() {
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) {
    throw new Error('CanvasKit did not load');
  }
  const skia = JsiSkApi(globalThis.CanvasKit);

  // The same seed the clips use, so the sphere in the store is the sphere in the README.
  const scene = createHologramScene(1337, PARTICLES);
  const resources = createHologramResources(skia, scene);

  const typeface = skia.Typeface.MakeFreeTypeFaceFromData(
    skia.Data.fromBytes(readFileSync(join(DEVICE_ART, 'roboto-light.ttf'))),
  );
  if (!typeface) {
    throw new Error('Could not load Roboto — run ./hologram/.scripts/prepare-device-art.sh');
  }
  const font = skia.Font(typeface, NAME_SIZE);

  const output = join(process.cwd(), 'docs', 'play-assets');
  mkdirSync(output, { recursive: true });

  // Found once and reused: it is the same voice in every picture that wants its loudest moment.
  const loudestAt = findLoudestMoment(LISTEN_SECONDS, FRAME_SECONDS);

  for (const asset of ASSETS) {
    const frame = performTo(asset.mood, asset.loudest ? loudestAt : 0);
    const path = join(output, asset.name);
    writeFileSync(path, render(skia, asset, frame, scene, resources, font));
    dropAlphaChannel(path);
    console.log(check(asset, path));
  }

  console.log(`\n${ASSETS.length} files in ${output}`);
}

await main();
