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
 * It also renders the apps' own icons, into `hologram/assets/` where both app configs find them:
 * `icon.png`, and the foreground of Android's adaptive icon — `adaptive-icon.png` for the watch,
 * `phone-adaptive-icon.png` with a wider margin for the phone — all on black.
 *
 * **Everything is opaque.** Wear screenshots are required to be, and the rest would be composited
 * onto whatever the Console and the store app happen to use; a transparent sphere on white is not
 * what anyone would be agreeing to ship. So each one is drawn onto the same near-black wash the
 * repository cover uses, which is also what the app itself is.
 *
 * What is drawn is the app rather than an advertisement for it: all of him, body and all, on the GPU
 * through `hologram/gpu` as both apps draw him — in headless Chromium, where
 * `render-play-assets-page.ts` draws each picture in the page `render-page.ts` opens — driven by the
 * same simulated voice the README clips use — see `simulated-performance.ts`.
 * The four phone shots are four things he genuinely does, in order: waiting, answering quietly,
 * answering loudly, and thinking. There is no invented copy over them, because the screen has no
 * text on it and a screenshot claiming otherwise would be a lie about the product.
 *
 * Usage, from the repository root:
 *   bun hologram/.scripts/render-play-assets.ts
 *
 * Writes into `docs/play-assets/`, and the apps' own icons into `hologram/assets/`. Needs `device-art/roboto-light.ttf`, which
 * `prepare-device-art.sh` fetches, and `ffmpeg` on the path — see {@link dropAlphaChannel}.
 * CHROMIUM_EXECUTABLE_PATH picks the browser, as for the browser tests.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARTICLE_COUNT, type SimulatedMood, THOUGHT_FADE_SECONDS } from '../src/index';
import { bytesOf, openRenderPage } from './render-page';
import type { PlayPicture } from './render-play-assets-page';
import { createPerformance, findLoudestMoment, type SimulatedFrame, stillMoment } from './simulated-performance';

/** The clock the simulated voice is advanced on, matching the clips. */
const FRAMES_PER_SECOND = 60;
const FRAME_SECONDS = 1 / FRAMES_PER_SECOND;

/** How far into a speech to look for its loudest instant. */
const LISTEN_SECONDS = 9;

/** The feature graphic's drawing square, as a share of its shortest side. */
const FEATURE_SPHERE_SHARE = 0.78;

/**
 * How wide the sphere itself is on an icon, as a share of the icon: nearly all of it, with narrow
 * edges, at the user's asking — a big hologram that fits the whole icon.
 *
 * The sphere's own diameter rather than its drawing square's, which is what `share` measures and
 * which is almost twice as wide (see `SPHERE_FRACTION`). Sized by the square, the icon had him at
 * half its width in a field of black.
 */
const ICON_SPHERE_DIAMETER = 0.9;

/**
 * The same for Android's adaptive icon, whose foreground is a 108dp square the launcher masks to
 * the middle 72dp — a circle on a Pixel, and on a watch face — and may pull about by a further
 * few dp as it animates. So he fills 64 of the 108: nearly all of what any mask shows, with a
 * narrow edge the rim's segments — which stand just proud of his limb — still fit inside.
 */
const ADAPTIVE_ICON_SPHERE_DIAMETER = 64 / 108;

/**
 * The phone's adaptive icon, which gets more room than the watch's. A phone launcher masks to a
 * squircle and sets the icon among others that keep their art well inside it, so at 64 of the 108
 * he ran into the mask's edge and looked crammed in beside them. At 54 there is a clear black margin
 * between his rim and the mask.
 */
const PHONE_ADAPTIVE_ICON_SPHERE_DIAMETER = 54 / 108;

/** Where the app icons go: beside the greeting, in the package both apps take their Jarvis from. */
const APP_ASSETS = join(import.meta.dir, '..', 'assets');

/** Play's ceilings, in bytes, so {@link check} can measure rather than trust. */
const ONE_MEGABYTE = 1024 * 1024;
/** Not a Play slot, so no Play ceiling: only a guard against something having gone badly wrong. */
const APP_ICON_LARGEST_BYTES = 5 * ONE_MEGABYTE;

/**
 * One picture Play wants, and what would make it refuse it.
 *
 * `mood` is what Jarvis is doing in it; `undefined` is him waiting, which is what the app shows
 * before anyone has said anything.
 */
interface Asset extends PlayPicture {
  name: string;
  largestBytes: number;
  mood: SimulatedMood | undefined;
  /** Whether to run the voice to its loudest instant first, rather than opening on it. */
  loudest?: boolean;
  /** Written into the apps' assets rather than the Play listing's. */
  forApps?: boolean;
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
    // At rest: an icon is too small for a syllable's chips, and there is no room past his limb.
    mood: undefined,
    sphere: ICON_SPHERE_DIAMETER,
    particles: PARTICLE_COUNT,
  },

  // The apps' own icons, which `mobile/app.config.ts` and `watch/app.config.ts` point at.
  {
    name: 'icon.png',
    width: 1024,
    height: 1024,
    largestBytes: APP_ICON_LARGEST_BYTES,
    mood: undefined,
    sphere: ICON_SPHERE_DIAMETER,
    particles: PARTICLE_COUNT,
    forApps: true,
    onBlack: true,
  },
  {
    name: 'adaptive-icon.png',
    width: 1024,
    height: 1024,
    largestBytes: APP_ICON_LARGEST_BYTES,
    mood: undefined,
    sphere: ADAPTIVE_ICON_SPHERE_DIAMETER,
    particles: PARTICLE_COUNT,
    forApps: true,
    onBlack: true,
  },
  {
    name: 'phone-adaptive-icon.png',
    width: 1024,
    height: 1024,
    largestBytes: APP_ICON_LARGEST_BYTES,
    mood: undefined,
    sphere: PHONE_ADAPTIVE_ICON_SPHERE_DIAMETER,
    particles: PARTICLE_COUNT,
    forApps: true,
    onBlack: true,
  },
  {
    name: 'feature-graphic-1024x500.png',
    width: 1024,
    height: 500,
    largestBytes: 15 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
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
    particles: PARTICLE_COUNT,
    mood: undefined,
  },
  {
    name: 'phone-2-answering.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: 'speaking',
  },
  {
    name: 'phone-3-mid-sentence.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: 'speaking',
    loudest: true,
  },
  {
    name: 'phone-4-thinking.png',
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: 'thinking',
  },

  // The same four on a round screen. Square files, because Play wants 1:1 and the watch app draws
  // black to the corners anyway — which is not a compromise on an OLED, it is the screen off.
  {
    name: 'watch-1-waiting.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: undefined,
  },
  {
    name: 'watch-2-answering.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: 'speaking',
  },
  {
    name: 'watch-3-mid-sentence.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: 'speaking',
    loudest: true,
  },
  {
    name: 'watch-4-thinking.png',
    width: WATCH_SIDE,
    height: WATCH_SIDE,
    largestBytes: 8 * ONE_MEGABYTE,
    particles: PARTICLE_COUNT,
    mood: 'thinking',
  },
];

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

/**
 * Rewrites a PNG with no alpha channel at all.
 *
 * The page hands back RGBA, and every pixel it draws here is already fully opaque — the backdrop goes
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
  const output = join(process.cwd(), 'docs', 'play-assets');
  mkdirSync(output, { recursive: true });
  mkdirSync(APP_ASSETS, { recursive: true });

  // Found once and reused: it is the same voice in every picture that wants its loudest moment.
  const loudestAt = findLoudestMoment(LISTEN_SECONDS, FRAME_SECONDS);

  const { page, close } = await openRenderPage('render-play-assets-page.ts');
  try {
    await page.evaluate(() => window.playAssets.setUp());
    for (const asset of ASSETS) {
      const frame = performTo(asset.mood, asset.loudest ? loudestAt : 0);
      const path = join(asset.forApps ? APP_ASSETS : output, asset.name);
      const png = await page.evaluate(([picture, drawn]) => window.playAssets.render(picture, drawn), [
        asset,
        frame,
      ] as const);
      writeFileSync(path, bytesOf(png));
      dropAlphaChannel(path);
      console.log(check(asset, path));
    }
  } finally {
    await close();
  }

  console.log(`\n${ASSETS.length} files in ${output} and ${APP_ASSETS}`);
}

await main();
