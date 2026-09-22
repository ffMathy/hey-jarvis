/**
 * Renders the two clips in the README: Jarvis summoned on a phone, and on a watch.
 *
 * Frame by frame, headlessly, through the same drawing both apps use and the same voice pipeline
 * the view runs every frame — see `simulated-performance.ts`, which is where that pipeline lives
 * and which the Play Store assets are rendered from too. So what the clip shows is what the app
 * does, rather than an impression of it drawn separately.
 *
 * The devices around him are real frames rather than shapes drawn here. The phone is Google's own
 * Pixel 10 Pro device art, the one Android Studio wraps a screenshot in; the watch is a Pixel Watch
 * 3 vector, because Google publishes device art for every Pixel phone and none for its watch; and
 * what is behind the assistant's sheet is the Blue Marble. They live in `device-art/`, fetched by
 * `prepare-device-art.sh`, and `device-art/NOTICE.md` says where each came from and under what
 * licence — including that the watch clips inherit CC BY-SA 4.0 from the frame in them.
 *
 * **Each device is drawn at the most particles it can hold** — `PARTICLE_COUNT` on the phone and
 * `WATCH_PARTICLE_COUNT` on the watch — never at a number chosen here. On a device the density loop
 * draws a share of that ceiling, whatever the device can afford; nothing here has to hold a frame
 * rate, so it draws all of it, which is the best he can look on each. The user asked for exactly
 * that, after the clips were rendered at a fixed 1300 on both and showed a sparser Jarvis than
 * either device draws. And there is no readout in the corner: the sphere and nothing else.
 *
 * Usage, from the repository root:
 *   bun hologram/.scripts/render-showcase.ts
 *
 * Writes `docs/jarvis-on-a-phone.{webm,gif}` and `docs/jarvis-on-a-watch.{webm,gif}`. Needs
 * `ffmpeg` on the path for the stitching; the frames themselves are PNGs in a temporary directory
 * that is removed afterwards.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BlendMode,
  BlurStyle,
  ClipOp,
  FilterMode,
  MipmapMode,
  PaintStyle,
  TileMode,
} from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import {
  createHologramResources,
  createHologramScene,
  drawHologram,
  GREETING_SECONDS,
  MATERIALISE_SECONDS,
  moodOf,
  PARTICLE_COUNT,
  SAMPLE_MODE_NAMES,
  type SimulatedMood,
  WATCH_PARTICLE_COUNT,
} from '../src/index';
import { LEAVING_SECONDS } from '../src/react/leaving';
import { createPerformance, findLoudestMoment, stillMoment } from './simulated-performance';

/**
 * Forty a second, at the user's asking — the rate the phone holds — for every copy: the archive,
 * the WebP and the GIF alike. They are all rendered here and none of them is thinned afterwards.
 */
const FRAMES_PER_SECOND = 40;
const FRAME_SECONDS = 1 / FRAMES_PER_SECOND;

/**
 * The GIF's rate: the same forty as everything else, so nothing is dropped from it.
 *
 * A GIF holds its frame delay in whole hundredths of a second and forty a second is two and a half,
 * so ffmpeg writes delays of 2 and 3 in turn, which averages exactly forty and plays in real time.
 */
const GIF_FRAMES_PER_SECOND = FRAMES_PER_SECOND;

/**
 * How many times wider than it is shown the README's copies are rendered: twice, so they stay sharp
 * on a high-density screen. The page sets the displayed width; bandwidth is not the concern here.
 */
const README_PIXEL_DENSITY = 2;

/**
 * How many colours the GIF's palette may hold: every one the format allows, less the one kept for
 * transparency. It was 160 to keep the file small; the user asked for quality over size.
 */
const GIF_COLOURS = 255;

/**
 * How hard the WebP is compressed, 0 to 100, higher being better: ninety-five, at the user's asking.
 *
 * It was seventy, which only just held the sphere's faint outer sparks — small, dim and different
 * every frame, the exact shape of what a video codec throws away — and it showed.
 */
const WEBP_QUALITY = 95;

/**
 * The archive copy's constant quality for VP9, 0 to 63, lower being better. Eleven is visually
 * lossless on this material; it was thirty.
 */
const VP9_CRF = 11;

/**
 * How opaque a pixel must be to survive into the GIF, out of 255.
 *
 * A GIF's transparency is one bit: a pixel is either there or it is not, and there is no such thing
 * as half. Everything softer than this — the outer pixels of the phone's rounded corners, the whole
 * antialiased rim of the watch — is dropped. Low, because dropping them is what leaves a ragged
 * edge, and keeping a faint pixel at full strength is much the less visible mistake of the two.
 */
const GIF_ALPHA_THRESHOLD = 64;

/**
 * How long each of the things he does is held for: at least three seconds each, at the user's
 * asking. Only the entrance and the exit are shorter — they take as long as they take.
 */
const SPEAKING_SECONDS = 3.5;
const LISTENING_SECONDS = 4;
const THINKING_SECONDS = 3.5;

/**
 * The label naming what he is doing, drawn into the clip itself: how big, how bright, and how long
 * it takes to hand over from one name to the next. Sizes are in rendered pixels, which the README
 * shows at half size (see README_PIXEL_DENSITY).
 */
const LABEL_SIZE = 26;
const LABEL_INK = '#e2e8f0';
const LABEL_FADE_SECONDS = 0.3;

/** How long the sheet takes to arrive, and to go: `ARRIVE_MS` and `LEAVE_MS` in `sample-sheet.tsx`. */
const SHEET_ARRIVES_SECONDS = 0.26;
const SHEET_LEAVES_SECONDS = 0.2;

/** A beat of dark at either end of the watch's clip, since it has no sheet to open and close. */
const WATCH_HOLD_SECONDS = 0.26;

/** How long a thought takes to settle in: `THOUGHT_FADE_SECONDS` in `hologram-view.tsx`. */
const THOUGHT_FADE_SECONDS = 0.45;

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
 * Exactly {@link README_PIXEL_DENSITY} times the width the README shows each at (240 and 260), so
 * its copies are drawn at the density they are shown at rather than scaled up to it.
 *
 * Both end up with a sphere of about the same size, which is what makes them sit together in a
 * README: the phone's square is inset in a sheet as tall as the screen is wide, and the watch's is
 * the whole of a small round one.
 */
const PHONE_WIDTH = 480;
const WATCH_WIDTH = 520;

/**
 * How much of the palette the GIF may use, and how it is chosen.
 *
 * Both went up when the wallpaper did. `stats_mode=diff` weights the palette toward what changes
 * between frames, which here is the sphere and nothing else — so the wallpaper, being perfectly
 * still, was given almost no colours at all and came out grey. `full` weighs the whole frame.
 */
const GIF_PALETTE_STATS = 'full';

/** Where the fetched artwork lives. See `device-art/NOTICE.md`. */
const DEVICE_ART = join(import.meta.dir, 'device-art');

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
const COVER_NAME_GLOW_BLUR = 14;
/** How long to look through for the loudest instant of speech. Three phrases' worth. */
const COVER_LISTEN_SECONDS = 9;
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

function clamp(value: number, lowest: number, highest: number): number {
  return value < lowest ? lowest : value > highest ? highest : value;
}

/** Rounded to an even number of pixels, which is what VP9's `yuv420p` requires of a frame. */
function even(value: number): number {
  return Math.round(value / 2) * 2;
}

/** Smooth 0-1, so nothing in the clip starts or stops abruptly. */
function ease(share: number): number {
  const held = clamp(share, 0, 1);
  return held * held * (3 - 2 * held);
}

/** A named stretch of the clip, from `from` seconds until the next one begins. */
interface Phase {
  label: string;
  from: number;
}

/**
 * Which phase's name shows at `seconds`, and how much of it: in after the phase begins and out
 * before the next one does, so two names never overlap. The first is up from the start.
 */
function labelAt(phases: Phase[], seconds: number, endsAt: number) {
  let index = 0;
  while (index + 1 < phases.length && seconds >= (phases[index + 1]?.from ?? endsAt)) {
    index++;
  }
  const current = phases[index] ?? { label: '', from: 0 };
  const endsBefore = phases[index + 1]?.from ?? endsAt;
  const fadeIn = index === 0 ? 1 : ease((seconds - current.from) / LABEL_FADE_SECONDS);
  const fadeOut = 1 - ease((seconds - (endsBefore - LABEL_FADE_SECONDS)) / LABEL_FADE_SECONDS);
  return { label: current.label, labelAlpha: fadeIn * fadeOut };
}

/**
 * The clip's script: when each thing happens, and what is happening at a given moment.
 *
 * Five phases, at the user's asking, each named in the clip by its label:
 *
 * 1. **Welcome** — summoned, he spirals out of his core while he says the greeting, as the apps do.
 * 2. **Speaking** — once he has fully appeared, speech as sample mode shows it.
 * 3. **Listening** — somebody talking to him, and the ring that says he hears them.
 * 4. **Thinking** — working through what they said.
 * 5. **Leaving** — he fades and shrinks away. He is still mid-thought when he goes, which is what
 *    the app does too: leaving does not change what he was doing, it fades what he was doing.
 */
function writeScript(opensOver: number, closesOver: number) {
  const appears = opensOver;
  const speaksAt = appears + Math.max(MATERIALISE_SECONDS, GREETING_SECONDS);
  const listensAt = speaksAt + SPEAKING_SECONDS;
  const thinksAt = listensAt + LISTENING_SECONDS;
  const leavesAt = thinksAt + THINKING_SECONDS;
  const goneAt = leavesAt + LEAVING_SECONDS;
  const phases: Phase[] = [
    { label: 'Welcome', from: 0 },
    { label: SAMPLE_MODE_NAMES.speaking, from: speaksAt },
    { label: SAMPLE_MODE_NAMES.listening, from: listensAt },
    { label: SAMPLE_MODE_NAMES.thinking, from: thinksAt },
    { label: 'Leaving', from: leavesAt },
  ];
  const endsAt = goneAt + closesOver;

  return {
    endsAt,
    at(seconds: number) {
      const intoGreeting = seconds - appears;
      const speaking = seconds >= speaksAt && seconds < listensAt;
      const mood: SimulatedMood | undefined = speaking
        ? moodOf('speaking')
        : seconds >= thinksAt
          ? moodOf('thinking')
          : undefined;
      const { label, labelAlpha } = labelAt(phases, seconds, endsAt);
      return {
        mood,
        /** Timed from when the mood was chosen, as `useSimulatedVoice` does. */
        moodSeconds: seconds - (speaking ? speaksAt : thinksAt),
        /** The greeting, from the moment he appears, as the apps play it. */
        greetingSeconds: intoGreeting >= 0 && intoGreeting < GREETING_SECONDS ? intoGreeting : undefined,
        /** Somebody talking to him, for as long as he listens. */
        userSeconds: seconds >= listensAt && seconds < thinksAt ? seconds - listensAt : undefined,
        /** What he is doing, as the label in the clip says it, and how much of the label is showing. */
        label,
        labelAlpha,
        /** How far the sheet is up: all the way for everything but the first and last moments. */
        opened: ease(seconds / opensOver) * (1 - ease((seconds - goneAt) / closesOver)),
        /** He is drawn once there is somewhere to draw him, and his clock starts then. */
        showing: seconds >= appears,
        hologramSeconds: Math.max(0, seconds - appears),
        thinkingWanted: seconds >= thinksAt,
        leaving: seconds >= leavesAt,
      };
    },
  };
}

/** Draws the label naming what he is doing, centred on `centreX` with its baseline at `baseline`. */
function drawLabel(
  skia: SkiaApi,
  canvas: SkiaCanvas,
  font: SkiaFont,
  moment: Moment,
  centreX: number,
  baseline: number,
) {
  if (moment.labelAlpha <= 0) {
    return;
  }
  const ink = skia.Paint();
  ink.setAntiAlias(true);
  ink.setColor(skia.Color(LABEL_INK));
  ink.setAlphaf(moment.labelAlpha);
  canvas.drawText(moment.label, centreX - font.getTextWidth(moment.label) / 2, baseline, ink, font);
}

type Moment = ReturnType<ReturnType<typeof writeScript>['at']>;

/**
 * Loads one of the prepared frames as a Skia image.
 *
 * The art is committed as PNG and JPEG rather than as the WebP and SVG it arrived as, because both
 * of those would make the renderer depend on a codec or an SVG library that it otherwise does not
 * need. See `prepare-device-art.sh`.
 */
function loadArt(skia: SkiaApi, file: string) {
  const image = skia.Image.MakeImageFromEncoded(skia.Data.fromBytes(readFileSync(join(DEVICE_ART, file))));
  if (!image) {
    throw new Error(`Could not decode ${file} — run ./hologram/.scripts/prepare-device-art.sh`);
  }
  return image;
}

type SkiaImage = ReturnType<typeof loadArt>;
type SkiaFont = ReturnType<SkiaApi['Font']>;
type HologramScene = ReturnType<typeof createHologramScene>;
type HologramResources = ReturnType<typeof createHologramResources>;

/**
 * The repository's cover: Jarvis mid-sentence, with his name written round him.
 *
 * A still, so it can be a great deal more than the clips are — every particle, no thinning, and no
 * scaling down afterwards. Transparent outside the ring, so it sits on a light README as happily as
 * on a dark one.
 *
 * The moment is chosen rather than picked: {@link findLoudestMoment} runs the simulated voice
 * forward and reports when it was loudest, and the drawing is then run from the beginning to
 * exactly there. Speaking is when he has most to look at — the swarm swells, the rim throws chips —
 * and the loudest instant of it is when that is furthest along.
 */
function paintCover(
  skia: SkiaApi,
  canvas: SkiaCanvas,
  wordmark: SkiaFont,
  frame: ReturnType<ReturnType<typeof createPerformance>>,
  scene: HologramScene,
  resources: HologramResources,
) {
  const middle = COVER_SIZE / 2;
  canvas.save();
  canvas.translate(middle - COVER_SPHERE / 2, middle - COVER_SPHERE / 2);
  drawHologram(canvas, COVER_SPHERE, frame, scene, resources);
  canvas.restore();

  drawAroundCircle(skia, canvas, wordmark, COVER_NAME, middle, middle, coverNameRadius());
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
  // The glow is subtracted as well as the letters. A blurred paint reaches about three sigma past
  // the shape it is blurring, and without that room the name's halo is sliced off square by the top
  // of the picture — which is not obvious in a thumbnail and very obvious once anybody looks.
  return COVER_SIZE / 2 - COVER_NAME_SIZE - COVER_NAME_GLOW_BLUR * 3;
}

/**
 * Puts the emblem on the wide, opaque cover GitHub wants, and encodes it.
 *
 * Scaled to the height rather than the width, because the emblem is taller than it is wide and a 2:1
 * frame has height to spare nowhere and width to spare everywhere. What is left either side is
 * backdrop, which is the point of a cover rather than a failure of one.
 */
function layOutCover(skia: SkiaApi, emblem: { image: SkiaImage; width: number; height: number }) {
  const surface = skia.Surface.MakeOffscreen(COVER_WIDE, COVER_TALL) ?? skia.Surface.Make(COVER_WIDE, COVER_TALL);
  if (!surface) {
    throw new Error('Could not make a surface to lay the cover out on');
  }
  const canvas = surface.getCanvas();
  canvas.clear(skia.Color(COVER_BACKDROP[0] ?? '#000000'));

  // A wash from the middle outward, so the emblem sits in a little light rather than on a flat
  // rectangle. Very dark throughout: it is a backdrop, and the sphere is the only thing lit.
  const backdrop = skia.Paint();
  backdrop.setShader(
    skia.Shader.MakeRadialGradient(
      { x: COVER_WIDE / 2, y: COVER_TALL / 2 },
      COVER_WIDE * 0.62,
      COVER_BACKDROP.map((colour) => skia.Color(colour)),
      [0, 0.45, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(skia.XYWHRect(0, 0, COVER_WIDE, COVER_TALL), backdrop);

  const scale = (COVER_TALL - COVER_INSET * 2) / emblem.height;
  const width = emblem.width * scale;
  const height = emblem.height * scale;
  drawArt(skia, canvas, emblem.image, (COVER_WIDE - width) / 2, (COVER_TALL - height) / 2, width, height);
  surface.flush();

  const bytes = surface.makeImageSnapshot().encodeToBytes();
  if (!bytes) {
    throw new Error('Could not encode the cover');
  }
  return bytes;
}

/** The box the drawn pixels fall in, ignoring anything under {@link COVER_FAINTEST}. */
/**
 * Trims a rendered emblem to what it actually drew, plus a margin.
 *
 * The square it is composed in is generous on purpose — it has to hold whatever the sphere throws —
 * and what comes out uses about half of it, with the name across the top and nothing at all below.
 * Cropping is free on a transparent image and is the difference between a picture and a picture with
 * a lot of space under it.
 *
 * The bounds are measured rather than worked out. Where the outermost spark lands depends on the
 * seed, the moment, and how loudly he happens to be speaking.
 */
function drawnBounds(pixels: Uint8Array, width: number, height: number) {
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
      // `Math.min`/`Math.max` rather than four `if`s, which is the same arithmetic and reads as one
      // idea instead of four branches.
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

function cropToContent(skia: SkiaApi, image: SkiaImage, margin: number) {
  const width = image.width();
  const height = image.height();
  const pixels = image.readPixels();
  if (!(pixels instanceof Uint8Array)) {
    throw new Error('Could not read the cover back to crop it');
  }
  const { left, right, top, bottom } = drawnBounds(pixels, width, height);
  const box = {
    x: Math.max(0, left - margin),
    y: Math.max(0, top - margin),
  };
  const cropped = {
    width: even(Math.min(width, right + margin + 1) - box.x),
    height: even(Math.min(height, bottom + margin + 1) - box.y),
  };
  const surface =
    skia.Surface.MakeOffscreen(cropped.width, cropped.height) ?? skia.Surface.Make(cropped.width, cropped.height);
  if (!surface) {
    throw new Error('Could not make a surface to crop the cover onto');
  }
  const canvas = surface.getCanvas();
  canvas.clear(skia.Color('#00000000'));
  canvas.drawImage(image, -box.x, -box.y);
  surface.flush();
  return { image: surface.makeImageSnapshot(), ...cropped };
}

/**
 * Writes a word around a circle, centred on twelve o'clock, reading left to right across the top.
 *
 * Glyph by glyph, because that is the only way to do it here: Skia can lay text along a path, but
 * the binding this runs under does not expose it. Each letter is rotated to its own angle and drawn
 * upright on the ring, which is what a wordmark round a badge does anyway.
 *
 * Twice over, as everything else in this drawing is: a wide blurred pass underneath for the glow and
 * a sharp one on top, both under `BlendMode.Screen`, so the name is made of the same light the
 * sphere is rather than printed over it.
 */
function drawAroundCircle(
  skia: SkiaApi,
  canvas: SkiaCanvas,
  font: SkiaFont,
  word: string,
  centreX: number,
  centreY: number,
  radius: number,
) {
  const letters = [...word];
  // Angles, not widths: a letter's share of the ring is its width over the circumference, and the
  // tracking between them is the same thing for a space that is not there.
  const widths = letters.map((letter) => font.getTextWidth(letter));
  const tracking = COVER_NAME_TRACKING * font.getSize();
  const spans = widths.map((width) => width / radius);
  const total = spans.reduce((all, span) => all + span, 0) + ((letters.length - 1) * tracking) / radius;

  const glow = skia.Paint();
  glow.setAntiAlias(true);
  glow.setColor(skia.Color(COVER_NAME_GLOW));
  glow.setBlendMode(BlendMode.Screen);
  glow.setMaskFilter(skia.MaskFilter.MakeBlur(BlurStyle.Normal, COVER_NAME_GLOW_BLUR, true));
  const ink = skia.Paint();
  ink.setAntiAlias(true);
  ink.setColor(skia.Color(COVER_NAME_INK));
  ink.setBlendMode(BlendMode.Screen);

  let turned = -total / 2;
  for (let index = 0; index < letters.length; index++) {
    const letter = letters[index] ?? '';
    const span = spans[index] ?? 0;
    canvas.save();
    canvas.translate(centreX, centreY);
    // Degrees, and about the centre: the letter's own middle is what lands on its angle.
    canvas.rotate(((turned + span / 2) * 180) / Math.PI, 0, 0);
    canvas.translate(-(widths[index] ?? 0) / 2, -radius);
    canvas.drawText(letter, 0, 0, glow, font);
    canvas.drawText(letter, 0, 0, ink, font);
    canvas.restore();
    turned += span + tracking / radius;
  }
}

/**
 * Draws an image to fill a rectangle exactly, whatever size it was committed at.
 *
 * `drawImageRectOptions` rather than `drawImageRect`, and that is the whole reason this is a
 * function rather than one line at each call: the plain call samples with no filter at all, so
 * shrinking the art to the size of the clip throws away three pixels in four and leaves a jagged
 * edge wherever the artwork has a curve. Linear sampling with mipmaps is what a picture being
 * scaled down wants. The art is also committed at only twice the size it is drawn at — see
 * `ART_WIDTH` in `prepare-device-art.sh` — so there is little left for it to do.
 */
function drawArt(
  skia: SkiaApi,
  canvas: SkiaCanvas,
  image: SkiaImage,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  canvas.drawImageRectOptions(
    image,
    skia.XYWHRect(0, 0, image.width(), image.height()),
    skia.XYWHRect(x, y, width, height),
    FilterMode.Linear,
    MipmapMode.Linear,
    skia.Paint(),
  );
}

/**
 * Renders one clip's frames into `into`, and returns how many there were.
 *
 * `paint` is handed a canvas already cleared and a moment already advanced, and is responsible for
 * the device and everything on its screen. Everything that is not the device is in here.
 */
function renderClip(
  skia: SkiaApi,
  into: string,
  clip: {
    width: number;
    height: number;
    opensOver: number;
    closesOver: number;
    paint: (canvas: SkiaCanvas, moment: Moment, frame: ReturnType<ReturnType<typeof createPerformance>>) => void;
  },
): number {
  const surface = skia.Surface.MakeOffscreen(clip.width, clip.height) ?? skia.Surface.Make(clip.width, clip.height);
  if (!surface) {
    throw new Error('Could not make a surface to render the showcase on');
  }
  const canvas = surface.getCanvas();
  const script = writeScript(clip.opensOver, clip.closesOver);
  const perform = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);

  let frames = 0;
  for (let seconds = 0; seconds <= script.endsAt; seconds += FRAME_SECONDS) {
    const moment = script.at(seconds);
    // Cleared to nothing rather than to black, so that everything outside the device is see
    // through and the clip sits on whatever page it is put on. All three formats carry it: WebP and
    // VP9 have a real alpha channel, and the GIF gets the one transparent palette entry it allows.
    canvas.clear(skia.Color('#00000000'));
    clip.paint(canvas, moment, perform(moment));
    surface.flush();
    const bytes = surface.makeImageSnapshot().encodeToBytes();
    if (!bytes) {
      throw new Error('Could not encode a frame to PNG');
    }
    writeFileSync(join(into, `${String(frames).padStart(5, '0')}.png`), bytes);
    frames++;
  }
  return frames;
}

/**
 * Stitches a directory of numbered PNGs into a WebM, an animated WebP and a GIF.
 *
 * Three formats, and the reason is that **a README cannot show a video.** GitHub does not render a
 * `<video>` element from a file in a repository, and it will not serve one from `raw` for a page to
 * play either — so a WebM in `docs/` is something to download, never something anybody sees on the
 * project's front page. Which leaves `<img>`, and what an `<img>` will animate.
 *
 * - **WebP** is what the README actually shows. It is a real video codec in an `<img>`: forty
 *   frames a second, full colour, at {@link WEBP_QUALITY}.
 * - **GIF** is behind it in a `<picture>`, for anything that will not animate a WebP: forty frames
 *   a second too (see {@link GIF_FRAMES_PER_SECOND}), with every colour the format allows. It is
 *   large; the user asked for quality over size.
 * - **WebM** is the archive copy: VP9, full size, nothing scaled or thinned.
 *
 * The two README copies are rendered at {@link README_PIXEL_DENSITY} times the width the page shows
 * them at. All three run in real time and end together.
 */
function stitch(frames: string, output: string, shownWidth: number) {
  const input = join(frames, '%05d.png');
  execFileSync(
    'ffmpeg',
    // `-b:v 0` is what puts libvpx-vp9 in constant-quality mode; without it the CRF is ignored.
    [
      '-y',
      '-framerate',
      String(FRAMES_PER_SECOND),
      '-i',
      input,
      '-c:v',
      'libvpx-vp9',
      // `yuva420p` rather than `yuv420p`: VP9 carries alpha in a second, hidden stream, and
      // without this the transparent surround is flattened to black on the way in.
      '-pix_fmt',
      'yuva420p',
      '-b:v',
      '0',
      '-crf',
      String(VP9_CRF),
      '-row-mt',
      '1',
      '-an',
      `${output}.webm`,
    ],
    { stdio: 'ignore' },
  );

  // The one the README shows. No `fps` filter: it keeps every frame that was rendered.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FRAMES_PER_SECOND),
      '-i',
      input,
      '-vf',
      `scale=${shownWidth * README_PIXEL_DENSITY}:-2:flags=lanczos`,
      '-pix_fmt',
      'yuva420p',
      '-c:v',
      'libwebp_anim',
      '-lossless',
      '0',
      '-q:v',
      String(WEBP_QUALITY),
      '-compression_level',
      '6',
      '-loop',
      '0',
      '-an',
      `${output}.webp`,
    ],
    { stdio: 'ignore' },
  );

  const scaled = `fps=${GIF_FRAMES_PER_SECOND},scale=${shownWidth * README_PIXEL_DENSITY}:-2:flags=lanczos`;
  const palette = join(frames, 'palette.png');
  // One palette for the whole clip rather than per frame: `stats_mode=diff` weights it toward what
  // actually changes, which here is the sphere rather than the phone around it.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FRAMES_PER_SECOND),
      '-i',
      input,
      '-vf',
      // `reserve_transparent` keeps one palette entry for the see-through surround, which is the
      // only transparency a GIF has: one colour, fully clear, with no partial alpha anywhere.
      `${scaled},palettegen=stats_mode=${GIF_PALETTE_STATS}:max_colors=${GIF_COLOURS}:reserve_transparent=1`,
      palette,
    ],
    {
      stdio: 'ignore',
    },
  );
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FRAMES_PER_SECOND),
      '-i',
      input,
      '-i',
      palette,
      '-lavfi',
      // `diff_mode=rectangle` leaves the parts of the frame that did not change untouched, which
      // is most of it — the device around the sphere never moves — and is most of why this fits.
      // `alpha_threshold` is where a pixel stops counting as opaque. It has to exist because a
      // GIF cannot fade out — the device frames' antialiased edges are part-transparent, and every
      // one of those pixels has to be rounded to either fully there or fully gone.
      `${scaled} [x]; [x][1:v] paletteuse=dither=sierra2_4a:diff_mode=rectangle:alpha_threshold=${GIF_ALPHA_THRESHOLD}`,
      '-loop',
      '0',
      `${output}.gif`,
    ],
    { stdio: 'ignore' },
  );
}

function megabytes(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) {
    throw new Error('CanvasKit did not load');
  }
  const skia = JsiSkApi(globalThis.CanvasKit);
  // The same Jarvis on both devices — one seed, one drawing — each at the most particles that
  // device can hold. See the file header.
  const phoneScene = createHologramScene(1337, PARTICLE_COUNT);
  const phoneResources = createHologramResources(skia, phoneScene);
  const watchScene = createHologramScene(1337, WATCH_PARTICLE_COUNT);
  const watchResources = createHologramResources(skia, watchScene);

  const typeface = skia.Typeface.MakeFreeTypeFaceFromData(
    skia.Data.fromBytes(readFileSync(join(DEVICE_ART, 'roboto-light.ttf'))),
  );
  if (!typeface) {
    throw new Error('Could not load Roboto — run ./hologram/.scripts/prepare-device-art.sh');
  }
  const labelFont = skia.Font(typeface, LABEL_SIZE);

  const working = mkdtempSync(join(tmpdir(), 'jarvis-showcase-'));
  const output = join(process.cwd(), 'docs');
  mkdirSync(output, { recursive: true });

  // ---- the phone: a sheet summoned up over whatever you were doing ---------------------------
  // The frame decides the clip's shape rather than the other way round, so the device keeps the
  // proportions Google drew it with.
  const phoneArt = loadArt(skia, 'pixel-10-pro.png');
  const wallpaper = loadArt(skia, 'wallpaper.jpg');
  const phoneSize = { width: PHONE_WIDTH, height: even((PHONE_WIDTH * phoneArt.height()) / phoneArt.width()) };
  const screen = {
    x: SCREEN.phone.x * phoneSize.width,
    y: SCREEN.phone.y * phoneSize.height,
    width: SCREEN.phone.width * phoneSize.width,
    height: SCREEN.phone.height * phoneSize.height,
    radius: SCREEN.phone.radius * phoneSize.width,
  };
  const sheetHeight = Math.round(Math.min(screen.width, screen.height * SHEET_MOST_OF_THE_HEIGHT));
  // The square fits inside the sheet, inset as `sample-screen.tsx` insets it.
  const phoneHologram = Math.min(screen.width, sheetHeight) - SHEET_INSET * 2;

  const phoneFrames = join(working, 'phone');
  mkdirSync(phoneFrames);
  const phoneCount = renderClip(skia, phoneFrames, {
    ...phoneSize,
    opensOver: SHEET_ARRIVES_SECONDS,
    closesOver: SHEET_LEAVES_SECONDS,
    paint: (canvas, moment, frame) => {
      // The screen first and the device over the top of it. The frame is a real hole with the
      // hole-punch camera drawn *inside* the hole, so painting the screen last would cover the
      // camera up; this way the bezel and the camera land on top of the screen, as they do on a
      // phone. The clip is belt and braces for the rounded corners, whose radius the art declares.
      canvas.save();
      canvas.clipRRect(
        skia.RRectXY(skia.XYWHRect(screen.x, screen.y, screen.width, screen.height), screen.radius, screen.radius),
        ClipOp.Intersect,
        true,
      );
      canvas.translate(screen.x, screen.y);
      drawArt(skia, canvas, wallpaper, 0, 0, screen.width, screen.height);

      const top = screen.height - sheetHeight * moment.opened;
      // Drawn past the bottom of the screen by its own radius, so only the top corners are round —
      // the sheet has come up from the edge rather than being a card floating on it.
      const shape = skia.RRectXY(
        skia.XYWHRect(0, top, screen.width, sheetHeight + SHEET_RADIUS),
        SHEET_RADIUS,
        SHEET_RADIUS,
      );
      const ink = skia.Paint();
      ink.setAntiAlias(true);
      ink.setColor(skia.Color(SHEET_INK));
      canvas.drawRRect(shape, ink);
      const edge = skia.Paint();
      edge.setAntiAlias(true);
      edge.setStyle(PaintStyle.Stroke);
      edge.setStrokeWidth(1);
      edge.setColor(skia.Color(SHEET_EDGE));
      canvas.drawRRect(shape, edge);

      if (moment.showing) {
        canvas.save();
        canvas.translate((screen.width - phoneHologram) / 2, top + (sheetHeight - phoneHologram) / 2);
        drawHologram(canvas, phoneHologram, frame, phoneScene, phoneResources);
        canvas.restore();
      }
      // In the sheet, above him, where the app's own mood toast sits.
      drawLabel(skia, canvas, labelFont, moment, screen.width / 2, top + LABEL_SIZE * 1.6);
      canvas.restore();
      drawArt(skia, canvas, phoneArt, 0, 0, phoneSize.width, phoneSize.height);
    },
  });
  console.log(`phone: ${phoneCount} frames at ${phoneSize.width}x${phoneSize.height}`);

  // ---- the watch: black to the edges, and nothing else -----------------------------------------
  const watchArt = loadArt(skia, 'pixel-watch-3.png');
  const watchSize = { width: WATCH_WIDTH, height: even((WATCH_WIDTH * watchArt.height()) / watchArt.width()) };
  const watchRadius = SCREEN.watch.radius * watchSize.width;
  const watchMiddle = { x: SCREEN.watch.centreX * watchSize.width, y: SCREEN.watch.centreY * watchSize.height };
  const watchFrames = join(working, 'watch');
  mkdirSync(watchFrames);
  const watchCount = renderClip(skia, watchFrames, {
    ...watchSize,
    opensOver: WATCH_HOLD_SECONDS,
    closesOver: WATCH_HOLD_SECONDS,
    paint: (canvas, moment, frame) => {
      // The other way round from the phone, because this frame is not a frame with a hole in it:
      // the vector draws the screen as a filled circle on top of the case, so there is nothing to
      // show through and the screen has to be painted over it.
      drawArt(skia, canvas, watchArt, 0, 0, watchSize.width, watchSize.height);
      canvas.save();
      canvas.clipRRect(
        skia.RRectXY(
          skia.XYWHRect(watchMiddle.x - watchRadius, watchMiddle.y - watchRadius, watchRadius * 2, watchRadius * 2),
          watchRadius,
          watchRadius,
        ),
        ClipOp.Intersect,
        true,
      );
      // Nothing is painted to turn the screen off first: the artwork's screen is already black,
      // blacked out when it was prepared. See `prepare-device-art.sh`, and the pale ring it is
      // there to stop.
      if (moment.showing) {
        // The square is the whole screen, as `useWatchHologramSize` makes it: the drawing keeps its
        // own distance from the edge, so a square the width of a round screen still sits inside it.
        canvas.translate(watchMiddle.x - watchRadius, watchMiddle.y - watchRadius);
        drawHologram(canvas, watchRadius * 2, frame, watchScene, watchResources);
        canvas.translate(-(watchMiddle.x - watchRadius), -(watchMiddle.y - watchRadius));
      }
      // Low on the round face, where the watch's own mood toast sits and the bezel leaves room.
      drawLabel(skia, canvas, labelFont, moment, watchMiddle.x, watchMiddle.y + watchRadius * 0.72);
      canvas.restore();
    },
  });
  console.log(`watch: ${watchCount} frames at ${watchSize.width}x${watchSize.height}`);

  const phone = join(output, 'jarvis-on-a-phone');
  const watch = join(output, 'jarvis-on-a-watch');
  // The widths the README shows them at, so the two sit level beside each other — the watch frame
  // is much less tall than the phone, so matching their widths would leave the watch looking like a
  // coin next to it. They are rendered at README_PIXEL_DENSITY times these.
  stitch(phoneFrames, phone, 240);
  stitch(watchFrames, watch, 260);
  rmSync(working, { recursive: true, force: true });

  // ---- the cover: one still, at full size, with his name round it ------------------------------
  // The phone's scene, at the phone's ceiling: the same picture the phone clip is drawn from.
  const coverScene = phoneScene;
  const coverResources = phoneResources;
  const wordmark = skia.Font(typeface, COVER_NAME_SIZE);

  const coverSurface = skia.Surface.MakeOffscreen(COVER_SIZE, COVER_SIZE) ?? skia.Surface.Make(COVER_SIZE, COVER_SIZE);
  if (!coverSurface) {
    throw new Error('Could not make a surface to draw the cover on');
  }
  const coverCanvas = coverSurface.getCanvas();
  coverCanvas.clear(skia.Color('#00000000'));
  // Walked to the loudest instant of speech rather than dropped into it: everything the drawing
  // does is carried from the frame before, so the only way to be at a moment is to have got there.
  const loudest = findLoudestMoment(COVER_LISTEN_SECONDS, FRAME_SECONDS);
  const speaking = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);
  let mid = speaking(stillMoment(0));
  for (let seconds = FRAME_SECONDS; seconds <= loudest; seconds += FRAME_SECONDS) {
    mid = speaking(stillMoment(seconds));
  }
  paintCover(skia, coverCanvas, wordmark, mid, coverScene, coverResources);
  coverSurface.flush();
  // Drawn square and then laid onto the wide cover, rather than composed wide from the start. The
  // emblem is round with a name arched over it and has a natural shape of its own; what the cover
  // needs is that shape, centred, on enough dark to fill a 2:1 frame.
  const emblem = cropToContent(skia, coverSurface.makeImageSnapshot(), COVER_MARGIN);
  const coverBytes = layOutCover(skia, emblem);
  const cover = join(output, 'jarvis.png');
  writeFileSync(cover, coverBytes);
  console.log(
    `cover: ${COVER_WIDE}x${COVER_TALL} from a ${emblem.width}x${emblem.height} emblem, loudest at ${loudest.toFixed(2)} s`,
  );

  for (const path of [
    cover,
    `${phone}.webp`,
    `${phone}.gif`,
    `${phone}.webm`,
    `${watch}.webp`,
    `${watch}.gif`,
    `${watch}.webm`,
  ]) {
    console.log(`${path} — ${megabytes(path)}`);
  }
}

await main();
