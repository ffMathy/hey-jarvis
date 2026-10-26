/**
 * The drawing half of `render-play-assets.ts`, run in headless Chromium: one picture at a time,
 * Jarvis drawn on the GPU (`render-jarvis-page.ts`) on the listing's wash or on black, and the
 * wordmark on the one picture that has it.
 */
import { createHologramScene, type HologramFrame, SCENE_SEED, SPHERE_FRACTION } from '../src/index';
import {
  createComposition,
  createGpuJarvis,
  encodeCanvas,
  loadRoboto,
  paintJarvis,
  ROBOTO,
} from './render-jarvis-page';

/** What everything sits on: the app's own near-black, lifted a little toward the middle. */
const BACKDROP = ['#0a0e16', '#141c2b', '#070a10'];

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

/** The wordmark on the feature graphic, which is the only picture here with any text on it. */
const NAME = 'JARVIS';
const NAME_SIZE = 78;
const NAME_TRACKING = 0.34;
const NAME_INK = '#ffd18a';

/** How one picture is drawn: the part of a Play asset the page reads. */
export interface PlayPicture {
  width: number;
  height: number;
  /** The drawing square's share of the shortest side. */
  share?: number;
  /** The sphere's own diameter as a share of the shortest side: set instead of `share` on icons. */
  sphere?: number;
  /** How many particles: the most the device this picture is of can hold. */
  particles: number;
  /**
   * Plain black behind him rather than the listing's wash: the apps' icons, so the adaptive icon's
   * foreground meets the black background layer it is composited onto without a seam.
   *
   * Black rather than transparent, though a foreground may be transparent: a launcher lays the
   * foreground over its black background layer, and drawn over black here he is exactly what it
   * shows, with nothing left to how a launcher blends a part-transparent edge.
   */
  onBlack?: boolean;
  /** The wordmark, on the one picture that has it. */
  wordmark?: boolean;
}

/** What the script drives the page with. */
export interface PlayAssetsPage {
  /** Loads the font; once, before anything is drawn. */
  setUp: () => Promise<void>;
  /** Draws one picture and returns it as a base64 PNG. */
  render: (picture: PlayPicture, frame: HologramFrame) => Promise<string>;
}

declare global {
  interface Window {
    /** Set as the page entry loads, which `addScriptTag` waits for, so every `evaluate` after it finds it. */
    playAssets: PlayAssetsPage;
  }
}

type Context = ReturnType<typeof createComposition>['context'];

/** The near-black wash everything is drawn onto, so no picture ships with an alpha channel to lose. */
function paintBackdrop(context: Context, width: number, height: number) {
  context.fillStyle = BACKDROP[0] ?? '#000000';
  context.fillRect(0, 0, width, height);
  const wash = context.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.62,
  );
  for (const [index, colour] of BACKDROP.entries()) {
    wash.addColorStop([0, 0.45, 1][index] ?? 1, colour);
  }
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);
}

/**
 * The wordmark, laid out along a line with the tracking the cover uses.
 *
 * Letter by letter rather than as one string, because the space between them is the whole look,
 * and laying each letter where it goes says exactly how much of it there is.
 */
function drawWordmark(context: Context, middleY: number, rightOf: number, width: number) {
  context.save();
  context.font = `${NAME_SIZE}px "${ROBOTO}"`;
  context.fillStyle = NAME_INK;
  const letters = [...NAME];
  const tracking = NAME_TRACKING * NAME_SIZE;
  const widths = letters.map((letter) => context.measureText(letter).width);
  const total = widths.reduce((sum, each) => sum + each, 0) + tracking * (letters.length - 1);

  let x = rightOf + (width - total) / 2;
  for (const [index, letter] of letters.entries()) {
    context.fillText(letter, x, middleY + NAME_SIZE / 3);
    x += (widths[index] ?? 0) + tracking;
  }
  context.restore();
}

function createPlayAssetsPage(): PlayAssetsPage {
  // The same seed the clips use, so the sphere in the store is the sphere in the README. Built once
  // per particle count.
  const scenes = new Map<number, ReturnType<typeof createHologramScene>>();
  const sceneOf = (particles: number) => {
    const known = scenes.get(particles);
    if (known) {
      return known;
    }
    const scene = createHologramScene(SCENE_SEED, particles);
    scenes.set(particles, scene);
    return scene;
  };

  return {
    setUp: loadRoboto,
    render: async (picture, frame) => {
      const { canvas, context } = createComposition(picture.width, picture.height);
      if (picture.onBlack) {
        context.fillStyle = '#000000';
        context.fillRect(0, 0, picture.width, picture.height);
      } else {
        paintBackdrop(context, picture.width, picture.height);
      }

      // The feature graphic is the one picture that is not just him: he takes the left, his name the
      // right. Everywhere else he is centred, because everywhere else he is the whole screen.
      const shortest = Math.min(picture.width, picture.height);
      // An icon names the sphere's own width; everything else its drawing square's. See
      // ICON_SPHERE_DIAMETER in the script.
      const sphere = Math.round(
        picture.sphere === undefined
          ? shortest * (picture.share ?? SCREEN_SQUARE_SHARE)
          : (shortest * picture.sphere) / (2 * SPHERE_FRACTION),
      );
      const middleX = picture.wordmark ? sphere / 2 + shortest * 0.12 : picture.width / 2;

      // A square of his own for each picture, let go once it is drawn: they come in many sizes.
      const jarvis = createGpuJarvis(sceneOf(picture.particles), sphere);
      try {
        // Straight over black, and Screened onto the wash, as the apps' views lay him.
        paintJarvis(context, jarvis, frame, {
          x: middleX - sphere / 2,
          y: picture.height / 2 - sphere / 2,
          blend: picture.onBlack ? 'source-over' : 'screen',
        });
      } finally {
        jarvis.release();
      }

      if (picture.wordmark) {
        const from = middleX + sphere / 2;
        drawWordmark(context, picture.height / 2, from, picture.width - from);
      }
      return encodeCanvas(canvas, 'image/png');
    },
  };
}

window.playAssets = createPlayAssetsPage();
