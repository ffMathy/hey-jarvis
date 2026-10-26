/**
 * The drawing half of `render-showcase.ts`, run in headless Chromium: each frame of the phone's and
 * the watch's clips, and the cover, composed on a 2D canvas round Jarvis drawn on the GPU
 * (`render-jarvis-page.ts`).
 *
 * The script owns the clock — what is happening when, and the simulated voice — and hands each
 * frame over as a moment and the frame of him it comes to; everything that is drawn is in here:
 * the devices, the wallpaper, the sheet, the labels, him, and his name round the cover.
 */
import { createHologramScene, type HologramFrame, PARTICLE_COUNT, SCENE_SEED } from '../src/index';
import {
  createComposition,
  createGpuJarvis,
  encodeCanvas,
  type GpuJarvis,
  loadArt,
  loadRoboto,
  paintJarvis,
  ROBOTO,
} from './render-jarvis-page';

/**
 * The label naming what he is doing, drawn into the clip itself: how big and how bright. Sizes are
 * in rendered pixels, which the README shows at half size (`README_PIXEL_DENSITY` in the script).
 */
const LABEL_SIZE = 26;
const LABEL_INK = '#e2e8f0';

/** The sheet, as `sample-sheet.tsx` has it: as tall as the screen is wide, up to this share of its height. */
const SHEET_MOST_OF_THE_HEIGHT = 0.6;
const SHEET_INK = '#0b1220';
const SHEET_EDGE = '#243043';
const SHEET_INSET = 14;
const SHEET_RADIUS = 28;

/**
 * Where each device's screen sits inside its frame, as fractions of the frame's own size.
 *
 * Fractions rather than pixels so that nothing here has to know what resolution the art happens to
 * be committed at. They are measured from the artwork itself — the phone's from the `layout` file
 * that AOSP ships beside the frame, the watch's by finding the light circle — and
 * `prepare-device-art.sh` prints both every time it runs, so checking them is one command.
 */
const SCREEN = {
  /** A hole through the frame: x, y and size of the rounded rectangle, radius as a share of width. */
  phone: { x: 0.041844, y: 0.020216, width: 0.907801, height: 0.962264, radius: 0.070213 },
  /** A circle drawn on top of the case, so this is what to paint over rather than to show through. */
  watch: { centreX: 0.477754, centreY: 0.500909, radius: 0.382203 },
};

/**
 * How wide each clip is rendered, in pixels. The height follows from the frame's aspect.
 *
 * Exactly `README_PIXEL_DENSITY` times the width the README shows each at (240 and 260), so its
 * copies are drawn at the density they are shown at rather than scaled up to it.
 *
 * Both end up with a sphere of about the same size, which is what makes them sit together in a
 * README: the phone's square is inset in a sheet as tall as the screen is wide, and the watch's is
 * the whole of a small round one.
 */
const PHONE_WIDTH = 480;
const WATCH_WIDTH = 520;

/**
 * The cover: one still of Jarvis mid-sentence with his name written round him.
 *
 * Square, and large. Nothing about it is scaled down afterwards and nothing is thinned, so this is
 * the one place he is drawn at the size he was designed at.
 *
 * `COVER_SPHERE` is the square the drawing is given, not the ball: the ball is `SPHERE_FRACTION` of
 * it, and the rest is the room his chips are thrown into, which is about 2.1 sphere radii. The name
 * goes on a ring outside all of that, and its radius is measured back from the edge of the picture
 * rather than outward from the sphere — see {@link coverNameRadius} — so it cannot be pushed off
 * the top, which is exactly what happened when it was a multiple of the sphere's radius.
 */
const COVER_SIZE = 1400;
const COVER_SPHERE = 1020;
const COVER_NAME = 'JARVIS';
const COVER_NAME_SIZE = 92;
/** Space between letters, as a share of their size. Wide: it is a name on a ring, not a sentence. */
const COVER_NAME_TRACKING = 0.62;
/** The same amber the sphere is made of, and the same glow under it. */
const COVER_NAME_INK = '#ffd18a';
const COVER_NAME_GLOW = '#e8902a';
/** The glow's blur, as a standard deviation in pixels: what a canvas's `blur()` filter takes. */
const COVER_NAME_GLOW_BLUR = 14;
/** How much clear space to leave round the emblem once it has been cropped to what it drew. */
const COVER_MARGIN = 28;
/** Alpha below which a pixel does not count as drawn, out of 255, when working out that crop. */
const COVER_FAINTEST = 10;

/**
 * The finished cover, and why it is this shape and not square.
 *
 * 1280×640 is what GitHub asks for a repository's social preview — the picture that shows when the
 * repository is linked anywhere — so the same file serves as the image at the top of the README and
 * as the one set under **Settings → Social preview**. GitHub takes anything from 640×320 up and
 * crops to 2:1; giving it exactly 2:1 at the size it prefers means nothing is cropped and nothing is
 * upscaled.
 *
 * Opaque, unlike everything else rendered here. A social preview is composited onto whatever
 * background the site linking to it uses, and a transparent one lands on white about as often as on
 * dark — so this brings its own.
 */
const COVER_WIDE = 1280;
const COVER_TALL = 640;
/** How much dark to leave above and below the emblem, in pixels. */
const COVER_INSET = 26;
/** What the cover sits on: the app's own near-black, lifted a little toward the middle. */
const COVER_BACKDROP = ['#0a0e16', '#141c2b', '#070a10'];

/** What a frame of a clip shows besides him, as the script's timeline has it at that moment. */
export interface ShowcaseMoment {
  /** What he is doing, as the label in the clip says it, and how much of the label is showing. */
  label: string;
  labelAlpha: number;
  /** How far the sheet is up, 0–1. */
  opened: number;
  /** Whether there is yet anywhere to draw him. */
  showing: boolean;
}

/** The size each clip came out at, for the script to report. */
interface ClipSize {
  width: number;
  height: number;
}

/** What the script drives the page with. */
export interface ShowcasePage {
  /** Loads the art and the font and sets him up in each square; once, before anything is drawn. */
  setUp: () => Promise<{ phone: ClipSize; watch: ClipSize }>;
  /** One frame of each clip, as a base64 PNG, transparent outside the device. */
  phoneFrame: (moment: ShowcaseMoment, frame: HologramFrame) => Promise<string>;
  watchFrame: (moment: ShowcaseMoment, frame: HologramFrame) => Promise<string>;
  /** The cover, as a base64 PNG, from the frame of him mid-sentence. */
  cover: (frame: HologramFrame) => Promise<{ png: string; emblemWidth: number; emblemHeight: number }>;
}

declare global {
  interface Window {
    /** Set as the page entry loads, which `addScriptTag` waits for, so every `evaluate` after it finds it. */
    showcase: ShowcasePage;
  }
}

/** Rounded to an even number of pixels, which is what VP9's `yuv420p` requires of a frame. */
function even(value: number): number {
  return Math.round(value / 2) * 2;
}

type Composition = ReturnType<typeof createComposition>;
type Context = Composition['context'];

/** Draws the label naming what he is doing, centred on `centreX` with its baseline at `baseline`. */
function drawLabel(context: Context, moment: ShowcaseMoment, centreX: number, baseline: number) {
  if (moment.labelAlpha <= 0) {
    return;
  }
  context.save();
  context.font = `${LABEL_SIZE}px "${ROBOTO}"`;
  context.fillStyle = LABEL_INK;
  context.globalAlpha = moment.labelAlpha;
  context.fillText(moment.label, centreX - context.measureText(moment.label).width / 2, baseline);
  context.restore();
}

/**
 * The ring the letters stand on, measured in from the edge of the picture.
 *
 * A letter is drawn from its baseline upward, so the ring plus the tallest capital is the furthest
 * anything reaches — and a full font size is more than any capital's height, which makes this the
 * largest ring that certainly fits. Doing it the other way round, as a multiple of the sphere's
 * radius, put the name half off the top of the image.
 *
 * What keeps it clear of Jarvis rather than clear of the edge is {@link COVER_SPHERE}: his chips go
 * out to about 2.1 sphere radii, which at that size is comfortably inside this.
 */
function coverNameRadius(): number {
  // The glow is subtracted as well as the letters. A blur reaches about three standard deviations
  // past the shape it is blurring, and without that room the name's halo is sliced off square by
  // the top of the picture — which is not obvious in a thumbnail and very obvious once anybody looks.
  return COVER_SIZE / 2 - COVER_NAME_SIZE - COVER_NAME_GLOW_BLUR * 3;
}

/**
 * Writes a word around a circle, centred on twelve o'clock, reading left to right across the top.
 *
 * Glyph by glyph: each letter is rotated to its own angle and drawn upright on the ring, which is
 * what a wordmark round a badge does anyway.
 *
 * Twice over, as everything else in this drawing is: a wide blurred pass underneath for the glow and
 * a sharp one on top, both Screened, so the name is made of the same light the sphere is rather
 * than printed over it.
 */
function drawAroundCircle(context: Context, word: string, centreX: number, centreY: number, radius: number) {
  context.save();
  context.font = `${COVER_NAME_SIZE}px "${ROBOTO}"`;
  context.globalCompositeOperation = 'screen';
  const letters = [...word];
  // Angles, not widths: a letter's share of the ring is its width over the circumference, and the
  // tracking between them is the same thing for a space that is not there.
  const widths = letters.map((letter) => context.measureText(letter).width);
  const tracking = COVER_NAME_TRACKING * COVER_NAME_SIZE;
  const spans = widths.map((width) => width / radius);
  const total = spans.reduce((all, span) => all + span, 0) + ((letters.length - 1) * tracking) / radius;

  let turned = -total / 2;
  for (let index = 0; index < letters.length; index++) {
    const letter = letters[index] ?? '';
    const span = spans[index] ?? 0;
    context.save();
    context.translate(centreX, centreY);
    // About the centre: the letter's own middle is what lands on its angle.
    context.rotate(turned + span / 2);
    context.translate(-(widths[index] ?? 0) / 2, -radius);
    context.filter = `blur(${COVER_NAME_GLOW_BLUR}px)`;
    context.fillStyle = COVER_NAME_GLOW;
    context.fillText(letter, 0, 0);
    context.filter = 'none';
    context.fillStyle = COVER_NAME_INK;
    context.fillText(letter, 0, 0);
    context.restore();
    turned += span + tracking / radius;
  }
  context.restore();
}

/**
 * The box the drawn pixels fall in, ignoring anything under {@link COVER_FAINTEST}.
 *
 * The bounds are measured rather than worked out. Where the outermost spark lands depends on the
 * seed, the moment, and how loudly he happens to be speaking.
 */
function drawnBounds(pixels: Uint8ClampedArray, width: number, height: number) {
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Anything fainter than this is a spark nobody can see, and cropping to it would keep the
      // whole square.
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) <= COVER_FAINTEST) {
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    throw new Error('The cover came out empty');
  }
  return { left, right, top, bottom };
}

/**
 * Trims a rendered emblem to what it actually drew, plus a margin.
 *
 * The square it is composed in is generous on purpose — it has to hold whatever the sphere throws —
 * and what comes out uses about half of it, with the name across the top and nothing at all below.
 * Cropping is free on a transparent image and is the difference between a picture and a picture with
 * a lot of space under it.
 */
function cropToContent(emblem: Composition, margin: number) {
  const { width, height } = emblem.canvas;
  const { left, right, top, bottom } = drawnBounds(
    emblem.context.getImageData(0, 0, width, height).data,
    width,
    height,
  );
  const box = { x: Math.max(0, left - margin), y: Math.max(0, top - margin) };
  const cropped = createComposition(
    even(Math.min(width, right + margin + 1) - box.x),
    even(Math.min(height, bottom + margin + 1) - box.y),
  );
  cropped.context.drawImage(emblem.canvas, -box.x, -box.y);
  return cropped;
}

/**
 * Puts the emblem on the wide, opaque cover GitHub wants.
 *
 * Scaled to the height rather than the width, because the emblem is taller than it is wide and a 2:1
 * frame has height to spare nowhere and width to spare everywhere. What is left either side is
 * backdrop, which is the point of a cover rather than a failure of one.
 */
function layOutCover(emblem: Composition) {
  const cover = createComposition(COVER_WIDE, COVER_TALL);
  const { context } = cover;
  context.fillStyle = COVER_BACKDROP[0] ?? '#000000';
  context.fillRect(0, 0, COVER_WIDE, COVER_TALL);

  // A wash from the middle outward, so the emblem sits in a little light rather than on a flat
  // rectangle. Very dark throughout: it is a backdrop, and the sphere is the only thing lit.
  const wash = context.createRadialGradient(
    COVER_WIDE / 2,
    COVER_TALL / 2,
    0,
    COVER_WIDE / 2,
    COVER_TALL / 2,
    COVER_WIDE * 0.62,
  );
  for (const [index, colour] of COVER_BACKDROP.entries()) {
    wash.addColorStop([0, 0.45, 1][index] ?? 1, colour);
  }
  context.fillStyle = wash;
  context.fillRect(0, 0, COVER_WIDE, COVER_TALL);

  const scale = (COVER_TALL - COVER_INSET * 2) / emblem.canvas.height;
  const width = emblem.canvas.width * scale;
  const height = emblem.canvas.height * scale;
  context.drawImage(emblem.canvas, (COVER_WIDE - width) / 2, (COVER_TALL - height) / 2, width, height);
  return cover;
}

/** The phone: a sheet summoned up over whatever you were doing. */
async function setUpPhone(scene: ReturnType<typeof createHologramScene>) {
  const [phoneArt, wallpaper] = await Promise.all([loadArt('pixel-10-pro.png'), loadArt('wallpaper.jpg')]);
  // The frame decides the clip's shape rather than the other way round, so the device keeps the
  // proportions Google drew it with.
  const size = { width: PHONE_WIDTH, height: even((PHONE_WIDTH * phoneArt.height) / phoneArt.width) };
  const screen = {
    x: SCREEN.phone.x * size.width,
    y: SCREEN.phone.y * size.height,
    width: SCREEN.phone.width * size.width,
    height: SCREEN.phone.height * size.height,
    radius: SCREEN.phone.radius * size.width,
  };
  const sheetHeight = Math.round(Math.min(screen.width, screen.height * SHEET_MOST_OF_THE_HEIGHT));
  // The square fits inside the sheet, inset as `sample-screen.tsx` insets it.
  const jarvis = createGpuJarvis(scene, Math.round(Math.min(screen.width, sheetHeight) - SHEET_INSET * 2));
  const composition = createComposition(size.width, size.height);

  const paint = (moment: ShowcaseMoment, frame: HologramFrame) => {
    const { context } = composition;
    // Cleared to nothing rather than to black, so that everything outside the device is see
    // through and the clip sits on whatever page it is put on.
    context.clearRect(0, 0, size.width, size.height);
    // The screen first and the device over the top of it. The frame is a real hole with the
    // hole-punch camera drawn *inside* the hole, so painting the screen last would cover the
    // camera up; this way the bezel and the camera land on top of the screen, as they do on a
    // phone. The clip is belt and braces for the rounded corners, whose radius the art declares.
    context.save();
    context.beginPath();
    context.roundRect(screen.x, screen.y, screen.width, screen.height, screen.radius);
    context.clip();
    context.translate(screen.x, screen.y);
    context.drawImage(wallpaper, 0, 0, screen.width, screen.height);

    const top = screen.height - sheetHeight * moment.opened;
    // Drawn past the bottom of the screen by its own radius, so only the top corners are round —
    // the sheet has come up from the edge rather than being a card floating on it.
    context.beginPath();
    context.roundRect(0, top, screen.width, sheetHeight + SHEET_RADIUS, SHEET_RADIUS);
    context.fillStyle = SHEET_INK;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = SHEET_EDGE;
    context.stroke();

    if (moment.showing) {
      // Screened onto the sheet's ink, as the phone's view lays him on a background that is not black.
      paintJarvis(context, jarvis, frame, {
        x: (screen.width - jarvis.side) / 2,
        y: top + (sheetHeight - jarvis.side) / 2,
        blend: 'screen',
      });
    }
    // In the sheet, above him, where the app's own mood toast sits.
    drawLabel(context, moment, screen.width / 2, top + LABEL_SIZE * 1.6);
    context.restore();
    context.drawImage(phoneArt, 0, 0, size.width, size.height);
    return encodeCanvas(composition.canvas, 'image/png');
  };
  return { size, paint };
}

/** The watch: black to the edges, and nothing else. */
async function setUpWatch(scene: ReturnType<typeof createHologramScene>) {
  const watchArt = await loadArt('pixel-watch-3.png');
  const size = { width: WATCH_WIDTH, height: even((WATCH_WIDTH * watchArt.height) / watchArt.width) };
  const radius = SCREEN.watch.radius * size.width;
  const middle = { x: SCREEN.watch.centreX * size.width, y: SCREEN.watch.centreY * size.height };
  // The square is the whole screen, as `useWatchHologramSize` makes it: the drawing keeps its own
  // distance from the edge, so a square the width of a round screen still sits inside it.
  const jarvis = createGpuJarvis(scene, Math.round(radius * 2));
  const composition = createComposition(size.width, size.height);

  const paint = (moment: ShowcaseMoment, frame: HologramFrame) => {
    const { context } = composition;
    context.clearRect(0, 0, size.width, size.height);
    // The other way round from the phone, because this frame is not a frame with a hole in it:
    // the vector draws the screen as a filled circle on top of the case, so there is nothing to
    // show through and the screen has to be painted over it.
    context.drawImage(watchArt, 0, 0, size.width, size.height);
    context.save();
    context.beginPath();
    context.arc(middle.x, middle.y, radius, 0, Math.PI * 2);
    context.clip();
    // Nothing is painted to turn the screen off first: the artwork's screen is already black,
    // blacked out when it was prepared. See `prepare-device-art.sh`, and the pale ring it is
    // there to stop. On black he is laid straight over, as the watch's view lays him.
    if (moment.showing) {
      paintJarvis(context, jarvis, frame, {
        x: middle.x - jarvis.side / 2,
        y: middle.y - jarvis.side / 2,
        blend: 'source-over',
      });
    }
    // Low on the round face, where the watch's own mood toast sits and the bezel leaves room.
    drawLabel(context, moment, middle.x, middle.y + radius * 0.72);
    context.restore();
    return encodeCanvas(composition.canvas, 'image/png');
  };
  return { size, paint };
}

/**
 * The repository's cover: Jarvis mid-sentence, with his name written round him.
 *
 * A still, so it can be a great deal more than the clips are — every particle, no thinning, and no
 * scaling down afterwards. Drawn square, transparent outside the ring, and then laid onto the wide
 * cover, rather than composed wide from the start: the emblem is round with a name arched over it
 * and has a natural shape of its own, and what the cover needs is that shape, centred, on enough
 * dark to fill a 2:1 frame.
 */
async function paintCover(jarvis: GpuJarvis, frame: HologramFrame) {
  const emblem = createComposition(COVER_SIZE, COVER_SIZE);
  const middle = COVER_SIZE / 2;
  paintJarvis(emblem.context, jarvis, frame, {
    x: middle - COVER_SPHERE / 2,
    y: middle - COVER_SPHERE / 2,
    blend: 'source-over',
  });
  drawAroundCircle(emblem.context, COVER_NAME, middle, middle, coverNameRadius());
  const cropped = cropToContent(emblem, COVER_MARGIN);
  return {
    png: await encodeCanvas(layOutCover(cropped).canvas, 'image/png'),
    emblemWidth: cropped.canvas.width,
    emblemHeight: cropped.canvas.height,
  };
}

function createShowcasePage(): ShowcasePage {
  let devices:
    | { phone: Awaited<ReturnType<typeof setUpPhone>>; watch: Awaited<ReturnType<typeof setUpWatch>>; cover: GpuJarvis }
    | undefined;
  const setUpFirst = () => {
    if (devices === undefined) {
      throw new Error('The showcase was asked to draw before it was set up.');
    }
    return devices;
  };
  return {
    setUp: async () => {
      await loadRoboto();
      // The same Jarvis on both devices — one seed, one drawing — each at the most particles that
      // device can hold, and the cover drawn from the phone's.
      const scene = createHologramScene(SCENE_SEED, PARTICLE_COUNT);
      const [phone, watch] = await Promise.all([setUpPhone(scene), setUpWatch(scene)]);
      devices = { phone, watch, cover: createGpuJarvis(scene, COVER_SPHERE) };
      return { phone: phone.size, watch: watch.size };
    },
    phoneFrame: (moment, frame) => setUpFirst().phone.paint(moment, frame),
    watchFrame: (moment, frame) => setUpFirst().watch.paint(moment, frame),
    cover: (frame) => paintCover(setUpFirst().cover, frame),
  };
}

window.showcase = createShowcasePage();
