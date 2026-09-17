/**
 * Renders the two clips in the README: Jarvis summoned on a phone, and on a watch.
 *
 * Frame by frame, headlessly, through the same drawing both apps use and the same voice pipeline
 * the view runs every frame — `fillSimulatedSpectrum` into `perceivedLevel` and `foldSpectrum`,
 * eased by `easeLevel`/`easeBands`, with `advanceVoiceActivity` tracking the raw reading. So what
 * the clip shows is what the app does, rather than an impression of it drawn separately.
 *
 * The devices around him are real frames rather than shapes drawn here. The phone is Google's own
 * Pixel 10 Pro device art, the one Android Studio wraps a screenshot in; the watch is a Pixel Watch
 * 3 vector, because Google publishes device art for every Pixel phone and none for its watch; and
 * what is behind the assistant's sheet is the Blue Marble. They live in `device-art/`, fetched by
 * `prepare-device-art.sh`, and `device-art/NOTICE.md` says where each came from and under what
 * licence — including that the watch clips inherit CC BY-SA 4.0 from the frame in them.
 *
 * Two things are deliberately *not* the app. The particle count is {@link PARTICLES} rather than
 * the thousand a phone is asked for, because nothing here has to hold sixty frames a second — it
 * has all the time it likes per frame — and the user asked to see him at full density. And there
 * is no readout in the corner: the sphere and nothing else.
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
import { ClipOp, FilterMode, MipmapMode, PaintStyle } from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import {
  advanceVoiceActivity,
  createHologramResources,
  createHologramScene,
  createSimulatedSpectrum,
  createVoiceActivityState,
  drawHologram,
  easeBands,
  easeLevel,
  fillSimulatedSpectrum,
  foldSpectrum,
  MATERIALISE_SECONDS,
  perceivedLevel,
  type SimulatedMood,
  simulatedVolume,
  VOICE_BAND_COUNT,
  voiceDrive,
} from '../src/index';
import { LEAVING_SECONDS } from '../src/react/leaving';

/**
 * Far more particles than any phone is asked to draw.
 *
 * A thousand is what `PARTICLE_COUNT` gives the apps, and even that is thinned to whatever the
 * phone can afford at sixty frames a second — see `density-control.ts`. None of that applies to a
 * renderer with no deadline, so this is what Jarvis looks like with the brakes off.
 */
const PARTICLES = 1300;

/** Sixty a second, which is what the apps cap at and what the clips are timed for. */
const FRAMES_PER_SECOND = 60;
const FRAME_SECONDS = 1 / FRAMES_PER_SECOND;

/**
 * What the GIF is cut down to. Thirty-three and a third, really: see {@link stitch}.
 *
 * A GIF holds its frame delay in hundredths of a second, so `fps=30` becomes a delay of 3, which
 * plays at 33⅓. Nobody can see the difference; what matters is that it is not slowed down.
 */
const GIF_FRAMES_PER_SECOND = 30;

/**
 * How many colours the GIF's palette may hold, out of the 256 the format allows.
 *
 * Fewer than it could have, because a palette entry costs size in every frame that dithers against
 * it, and this clip is mostly two things: amber, and a handful of flat blues. It was 96 while the
 * backdrop was a flat colour, and had to go up once there was a wallpaper — a photographic one
 * needed well over this and still went grey, which is one of the reasons there is not one.
 */
const GIF_COLOURS = 160;

/**
 * How hard the WebP is compressed, 0 to 100, higher being better.
 *
 * Seventy holds the sphere's faint outer sparks, which are the first thing to go: they are small,
 * dim and different every frame, which is the exact shape of what a video codec throws away.
 */
const WEBP_QUALITY = 70;

/** How long each of the three things he does is held for, at the user's asking. */
const IDLE_SECONDS = 3;
const SPEAKING_SECONDS = 3;
const THINKING_SECONDS = 3;

/** How long the sheet takes to arrive, and to go: `ARRIVE_MS` and `LEAVE_MS` in `sample-sheet.tsx`. */
const SHEET_ARRIVES_SECONDS = 0.26;
const SHEET_LEAVES_SECONDS = 0.2;

/** A beat of dark at either end of the watch's clip, since it has no sheet to open and close. */
const WATCH_HOLD_SECONDS = 0.26;

/** How long a thought takes to settle in: `THOUGHT_FADE_SECONDS` in `hologram-view.tsx`. */
const THOUGHT_FADE_SECONDS = 0.45;

/** The sheet, as `sample-sheet.tsx` has it. */
const SHEET_SHARE = 0.4;
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
 * Both end up with a sphere of about the same size, which is what makes them sit together in a
 * README: the phone's square is inset in a sheet covering 40% of a tall screen, and the watch's is
 * the whole of a small round one.
 */
const PHONE_WIDTH = 420;
const WATCH_WIDTH = 420;

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

/**
 * The clip's script: when each thing happens, and what is happening at a given moment.
 *
 * Idle first, because that is what he does before anyone has said anything, and because the
 * materialisation belongs to it — he forms, and then there are three full seconds of him formed
 * and at rest before the voice starts. He is still mid-thought when he goes, which is what the app
 * does too: leaving does not change what he was doing, it fades what he was doing.
 */
function writeScript(opensOver: number, closesOver: number) {
  const appears = opensOver;
  const speaksAt = appears + MATERIALISE_SECONDS + IDLE_SECONDS;
  const thinksAt = speaksAt + SPEAKING_SECONDS;
  const leavesAt = thinksAt + THINKING_SECONDS;
  const goneAt = leavesAt + LEAVING_SECONDS;

  return {
    endsAt: goneAt + closesOver,
    at(seconds: number) {
      const mood: SimulatedMood | undefined =
        seconds >= speaksAt && seconds < thinksAt ? 'speaking' : seconds >= thinksAt ? 'thinking' : undefined;
      const moodBegan = mood === 'speaking' ? speaksAt : mood === 'thinking' ? thinksAt : 0;
      return {
        mood,
        /** Timed from when the mood was chosen, so speech opens on a syllable — as `useSimulatedVoice` does. */
        moodSeconds: seconds - moodBegan,
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

type Moment = ReturnType<ReturnType<typeof writeScript>['at']>;

/**
 * Everything the drawing reads that is carried from one frame to the next.
 *
 * The same five things `hologram-view.tsx` keeps in its `frame` shared value, advanced the same
 * way, so the sphere behaves here exactly as it does in the app.
 */
function createPerformance() {
  const spectrum = createSimulatedSpectrum();
  const activity = createVoiceActivityState();
  let level = 0;
  let bands: number[] = new Array(VOICE_BAND_COUNT).fill(0);
  let thinking = 0;
  let presence = 1;

  return (moment: Moment) => {
    // What the app reads off the voice every 40 ms, read here every frame: same two questions.
    const heard =
      moment.mood === undefined
        ? 0
        : perceivedLevel(simulatedVolume(fillSimulatedSpectrum(moment.mood, moment.moodSeconds, spectrum)));
    const heardBands = moment.mood === undefined ? new Array<number>(VOICE_BAND_COUNT).fill(0) : foldSpectrum(spectrum);

    level = easeLevel(level, heard, FRAME_SECONDS);
    bands = easeBands(bands, heardBands, FRAME_SECONDS);
    advanceVoiceActivity(activity, heard, FRAME_SECONDS);
    thinking = clamp(thinking + ((moment.thinkingWanted ? 1 : -1) * FRAME_SECONDS) / THOUGHT_FADE_SECONDS, 0, 1);
    presence = clamp(presence + ((moment.leaving ? -1 : 1) * FRAME_SECONDS) / LEAVING_SECONDS, 0, 1);

    return {
      time: moment.hologramSeconds,
      // Judged against how loud this voice actually gets, as the view does.
      level: voiceDrive(level, activity.loudest),
      bands,
      // True for both moods: a simulated voice is always "on", and it is `thinking` that tells
      // them apart. See `useSimulatedVoice`, which does exactly this.
      speaking: moment.mood !== undefined,
      agitation: activity.agitation,
      burstAge: activity.burstAge,
      burstStrength: activity.burstStrength,
      burstCount: activity.burstCount,
      appearance: Math.min(1, moment.hologramSeconds / MATERIALISE_SECONDS),
      thinking,
      presence,
      // All of them. Nothing here is racing a screen.
      density: 1,
    };
  };
}

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
  const perform = createPerformance();

  let frames = 0;
  for (let seconds = 0; seconds <= script.endsAt; seconds += FRAME_SECONDS) {
    const moment = script.at(seconds);
    canvas.clear(skia.Color('#000000'));
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
 * - **WebP** is what the README actually shows. It is a real video codec in an `<img>`: sixty
 *   frames a second, full colour, and smaller than the GIF below at half its frame rate.
 * - **GIF** is behind it in a `<picture>`, for anything that will not animate a WebP. It cannot be
 *   sixty frames a second whatever it is asked — a GIF's frame delay is a whole number of
 *   hundredths of a second, so the rates it can express are 100, 50, 33⅓, 25 and down — and it has
 *   no interframe compression worth the name and no more than 256 colours in the whole clip. Hence
 *   {@link GIF_FRAMES_PER_SECOND} and {@link GIF_COLOURS}, which is what keeps it near a megabyte.
 * - **WebM** is the archive copy: VP9, full size, nothing scaled or thinned.
 *
 * Both of the scaled ones drop frames rather than slowing anything down, so all three run in real
 * time and end together.
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
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      '0',
      '-crf',
      '30',
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
      `scale=${shownWidth}:-2:flags=lanczos`,
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

  const scaled = `fps=${GIF_FRAMES_PER_SECOND},scale=${shownWidth}:-2:flags=lanczos`;
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
      `${scaled},palettegen=stats_mode=${GIF_PALETTE_STATS}:max_colors=${GIF_COLOURS}`,
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
      `${scaled} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
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
  // One scene and one set of resources for both clips: the same Jarvis on both devices, which is
  // the whole point of him living in a package of his own.
  const scene = createHologramScene(1337, PARTICLES);
  const resources = createHologramResources(skia, scene);

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
  const sheetHeight = Math.round(screen.height * SHEET_SHARE);
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
        drawHologram(canvas, phoneHologram, frame, scene, resources);
        canvas.restore();
      }
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
        drawHologram(canvas, watchRadius * 2, frame, scene, resources);
      }
      canvas.restore();
    },
  });
  console.log(`watch: ${watchCount} frames at ${watchSize.width}x${watchSize.height}`);

  const phone = join(output, 'jarvis-on-a-phone');
  const watch = join(output, 'jarvis-on-a-watch');
  // Sized so the two sit level beside each other in a README — the watch frame is much less tall
  // than the phone, so matching their widths would leave the watch looking like a coin next to it —
  // and so that neither GIF runs away. The watch costs far more per pixel than the phone: on a
  // watch the sphere *is* the screen, so nearly every pixel changes every frame, where on the phone
  // three fifths of the picture is a wallpaper that never moves. Two hundred and sixty is the most
  // it can have and still come in under three megabytes.
  stitch(phoneFrames, phone, 240);
  stitch(watchFrames, watch, 260);
  rmSync(working, { recursive: true, force: true });

  for (const path of [
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
