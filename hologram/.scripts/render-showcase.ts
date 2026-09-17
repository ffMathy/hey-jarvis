/**
 * Renders the two clips in the README: Jarvis summoned on a phone, and on a watch.
 *
 * Frame by frame, headlessly, through the same drawing both apps use and the same voice pipeline
 * the view runs every frame — `fillSimulatedSpectrum` into `perceivedLevel` and `foldSpectrum`,
 * eased by `easeLevel`/`easeBands`, with `advanceVoiceActivity` tracking the raw reading. So what
 * the clip shows is what the app does, rather than an impression of it drawn separately.
 *
 * The device around it is drawn here too, in Skia: a rounded phone with a hole-punch camera and
 * side keys, a round watch with a crown. Nothing is downloaded and nothing is traced, which is why
 * they are shapes and proportions rather than renderings of anyone's product photography.
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
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClipOp, PaintStyle, TileMode } from '@shopify/react-native-skia/lib/module/skia/types';
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
 * it, and this clip is two colours: amber, and a very dark blue. Ninety-six of them spent almost
 * entirely on the sphere is a better picture than 256 spread over a backdrop nobody is looking at.
 */
const GIF_COLOURS = 96;

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
 * The phone, in pixels. Even numbers throughout, because VP9 wants an even frame.
 *
 * Proportioned as a Pixel: a tall screen, a bezel of the same width all the way round, a hole
 * punch centred at the top, and the power and volume keys on the right where that phone has them.
 */
const PHONE = { width: 420, height: 900, bezel: 12, radius: 54, camera: 5 };

/**
 * The watch, in pixels: round, with the crown at three o'clock and a button just above it.
 *
 * The case does not fill the frame, and both margins are load-bearing. There has to be room beside
 * it for the crown to stick out of — drawn inside the case it is simply painted over, which is
 * what the first render did — and room above and below for enough strap that the thing reads as
 * something worn rather than as a circle. `middleX` is pulled left of the frame's centre by half
 * the crown's room so that case-plus-crown sits centred, which is what the eye measures.
 */
const WATCH = { size: 420, caseRadius: 176, crownRoom: 22, bezel: 13, strapWidth: 152 };
const WATCH_MIDDLE = { x: WATCH.size / 2 - WATCH.crownRoom / 2, y: WATCH.size / 2 };

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
 * The wallpaper the assistant is summoned over, so the sheet has something to arrive on top of.
 *
 * **Deliberately almost flat, and that is a GIF decision as much as a design one.** It began as a
 * proper wallpaper — a wide gradient with a bright bloom in one corner — and in the GIF that came
 * out in visible concentric rings. A palette has at most 256 entries for the whole clip, a broad
 * smooth gradient wants most of them, and what it takes it takes from the sphere. Holding the whole
 * backdrop inside a handful of very dark values leaves the palette to the amber, which is the only
 * thing in the frame anybody is looking at, and leaves almost nothing for the banding to band on.
 *
 * It also reads better. The assistant is summoned over a screen that has dimmed behind it.
 */
function paintWallpaper(skia: SkiaApi, canvas: SkiaCanvas, width: number, height: number) {
  const sky = skia.Paint();
  sky.setShader(
    skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 0, y: height },
      [skia.Color('#121b25'), skia.Color('#0c131b')],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(skia.XYWHRect(0, 0, width, height), sky);

  // A vignette into the corners, which is the one gradient cheap enough to keep: it is darkening
  // an already dark colour, so it spans about four values rather than forty.
  const vignette = skia.Paint();
  vignette.setShader(
    skia.Shader.MakeRadialGradient(
      { x: width / 2, y: height * 0.38 },
      height * 0.62,
      [skia.Color('#00000000'), skia.Color('#000000a0')],
      [0.45, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(skia.XYWHRect(0, 0, width, height), vignette);
}

/** The phone's body, drawn round whatever is on its screen. */
function paintPhoneShell(skia: SkiaApi, canvas: SkiaCanvas) {
  const body = skia.Paint();
  body.setAntiAlias(true);
  body.setColor(skia.Color('#0e1013'));
  body.setStyle(PaintStyle.Stroke);
  body.setStrokeWidth(PHONE.bezel * 2);
  const outline = skia.RRectXY(skia.XYWHRect(0, 0, PHONE.width, PHONE.height), PHONE.radius, PHONE.radius);
  canvas.drawRRect(outline, body);

  // The side keys, which are most of what makes a rounded rectangle read as a particular phone.
  const key = skia.Paint();
  key.setAntiAlias(true);
  key.setColor(skia.Color('#2b3038'));
  canvas.drawRRect(skia.RRectXY(skia.XYWHRect(PHONE.width - 3, PHONE.height * 0.24, 5, 54), 2.5, 2.5), key);
  canvas.drawRRect(skia.RRectXY(skia.XYWHRect(PHONE.width - 3, PHONE.height * 0.34, 5, 92), 2.5, 2.5), key);

  // A hairline where the metal meets the air, and another where it meets the glass. Without them
  // the phone is a black shape on a black page and has no edge at all.
  const rim = skia.Paint();
  rim.setAntiAlias(true);
  rim.setColor(skia.Color('#464e59'));
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(1.5);
  canvas.drawRRect(
    skia.RRectXY(skia.XYWHRect(0.75, 0.75, PHONE.width - 1.5, PHONE.height - 1.5), PHONE.radius, PHONE.radius),
    rim,
  );
  rim.setColor(skia.Color('#22262c'));
  rim.setStrokeWidth(1);
  const glass = PHONE.radius - PHONE.bezel;
  canvas.drawRRect(
    skia.RRectXY(
      skia.XYWHRect(PHONE.bezel, PHONE.bezel, PHONE.width - PHONE.bezel * 2, PHONE.height - PHONE.bezel * 2),
      glass,
      glass,
    ),
    rim,
  );

  // The hole punch, centred, as a Pixel has it.
  const lens = skia.Paint();
  lens.setAntiAlias(true);
  lens.setColor(skia.Color('#05070a'));
  canvas.drawCircle(PHONE.width / 2, PHONE.bezel + PHONE.camera + 10, PHONE.camera, lens);
}

/**
 * The watch: strap, then case, then the crown and button sticking out of its right-hand side.
 *
 * In that order, because each is drawn over where the last meets it. The crown has to come *after*
 * the case and reach outside it — drawn first, as it was, the case's own ring paints straight over
 * it and the watch has no crown at all.
 */
function paintWatchShell(skia: SkiaApi, canvas: SkiaCanvas) {
  const { x: middleX, y: middleY } = WATCH_MIDDLE;
  const left = middleX - WATCH.strapWidth / 2;

  // The strap, running off the top and bottom of the frame: a hint of it is what makes the circle
  // read as something worn rather than as a dial.
  const strap = skia.Paint();
  strap.setAntiAlias(true);
  strap.setShader(
    skia.Shader.MakeLinearGradient(
      { x: left, y: 0 },
      { x: left + WATCH.strapWidth, y: 0 },
      [skia.Color('#171a1f'), skia.Color('#2a2f37'), skia.Color('#14171b')],
      [0, 0.45, 1],
      TileMode.Clamp,
    ),
  );
  const strapReach = middleY - WATCH.caseRadius + 46;
  canvas.drawRRect(skia.RRectXY(skia.XYWHRect(left, -24, WATCH.strapWidth, strapReach + 24), 16, 16), strap);
  canvas.drawRRect(
    skia.RRectXY(skia.XYWHRect(left, WATCH.size - strapReach, WATCH.strapWidth, strapReach + 24), 16, 16),
    strap,
  );

  // The case: a thin dark ring, so the glass runs nearly to the edge as a Pixel Watch's dome does.
  const body = skia.Paint();
  body.setAntiAlias(true);
  body.setColor(skia.Color('#0e1013'));
  body.setStyle(PaintStyle.Stroke);
  body.setStrokeWidth(WATCH.bezel * 2);
  canvas.drawCircle(middleX, middleY, WATCH.caseRadius - WATCH.bezel, body);

  const steel = skia.Paint();
  steel.setAntiAlias(true);
  steel.setShader(
    skia.Shader.MakeLinearGradient(
      { x: 0, y: middleY - 20 },
      { x: 0, y: middleY + 20 },
      [skia.Color('#9aa1ab'), skia.Color('#3f444c')],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  // The crown, at three o'clock, overlapping the case by a few pixels so it grows out of it.
  canvas.drawRRect(
    skia.RRectXY(skia.XYWHRect(middleX + WATCH.caseRadius - 5, middleY - 17, WATCH.crownRoom + 5, 34), 6, 6),
    steel,
  );
  // And the button, up and to the right of it, where that watch puts it.
  const button = skia.Paint();
  button.setAntiAlias(true);
  button.setColor(skia.Color('#42474f'));
  canvas.save();
  canvas.rotate(-34, middleX, middleY);
  canvas.drawRRect(skia.RRectXY(skia.XYWHRect(middleX + WATCH.caseRadius - 6, middleY - 11, 15, 22), 5, 5), button);
  canvas.restore();

  // The hairline round the outside: without it the case is black on a black page and has no edge.
  const rim = skia.Paint();
  rim.setAntiAlias(true);
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(1.5);
  rim.setShader(
    skia.Shader.MakeLinearGradient(
      { x: 0, y: middleY - WATCH.caseRadius },
      { x: 0, y: middleY + WATCH.caseRadius },
      [skia.Color('#79818c'), skia.Color('#2b3037')],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawCircle(middleX, middleY, WATCH.caseRadius - 0.75, rim);
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
 * Stitches a directory of numbered PNGs into a WebM and a GIF.
 *
 * Both, because they are for different readers. The WebM is the real thing: VP9 at a true sixty
 * frames a second, full size, which is what was rendered. The GIF is what goes in the README,
 * because that is the one format every renderer of Markdown will animate.
 *
 * **A GIF cannot be sixty frames a second.** Its frame delay is a whole number of hundredths of a
 * second, so the rates it can express are 100, 50, 33⅓, 25 and down from there; there is no delay
 * that means a sixtieth. It also has no interframe compression worth the name and no more than 256
 * colours in the whole clip, so a full-size one of this length runs to tens of megabytes. What is
 * here — {@link GIF_FRAMES_PER_SECOND}, scaled down, on a {@link GIF_COLOURS}-entry palette — is
 * the compromise that keeps a README under a couple of megabytes a clip. `fps=` drops frames
 * rather than slowing anything down, so the GIF still runs in real time beside the WebM.
 */
function stitch(frames: string, output: string, gifWidth: number) {
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

  const scaled = `fps=${GIF_FRAMES_PER_SECOND},scale=${gifWidth}:-2:flags=lanczos`;
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
      `${scaled},palettegen=stats_mode=diff:max_colors=${GIF_COLOURS}`,
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
  const screen = {
    x: PHONE.bezel,
    y: PHONE.bezel,
    width: PHONE.width - PHONE.bezel * 2,
    height: PHONE.height - PHONE.bezel * 2,
    radius: PHONE.radius - PHONE.bezel,
  };
  const sheetHeight = Math.round(screen.height * SHEET_SHARE);
  // The square fits inside the sheet, inset as `sample-screen.tsx` insets it.
  const phoneHologram = Math.min(screen.width, sheetHeight) - SHEET_INSET * 2;

  const phoneFrames = join(working, 'phone');
  mkdirSync(phoneFrames);
  const phoneCount = renderClip(skia, phoneFrames, {
    width: PHONE.width,
    height: PHONE.height,
    opensOver: SHEET_ARRIVES_SECONDS,
    closesOver: SHEET_LEAVES_SECONDS,
    paint: (canvas, moment, frame) => {
      canvas.save();
      canvas.clipRRect(
        skia.RRectXY(skia.XYWHRect(screen.x, screen.y, screen.width, screen.height), screen.radius, screen.radius),
        ClipOp.Intersect,
        true,
      );
      canvas.translate(screen.x, screen.y);
      paintWallpaper(skia, canvas, screen.width, screen.height);

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
      paintPhoneShell(skia, canvas);
    },
  });
  console.log(`phone: ${phoneCount} frames`);

  // ---- the watch: black to the edges, and nothing else -----------------------------------------
  const watchScreen = (WATCH.caseRadius - WATCH.bezel) * 2;
  const watchGlass = { x: WATCH_MIDDLE.x - watchScreen / 2, y: WATCH_MIDDLE.y - watchScreen / 2 };
  const watchFrames = join(working, 'watch');
  mkdirSync(watchFrames);
  const watchCount = renderClip(skia, watchFrames, {
    width: WATCH.size,
    height: WATCH.size,
    opensOver: WATCH_HOLD_SECONDS,
    closesOver: WATCH_HOLD_SECONDS,
    paint: (canvas, moment, frame) => {
      if (moment.showing) {
        canvas.save();
        canvas.clipRRect(
          skia.RRectXY(
            skia.XYWHRect(watchGlass.x, watchGlass.y, watchScreen, watchScreen),
            watchScreen / 2,
            watchScreen / 2,
          ),
          ClipOp.Intersect,
          true,
        );
        // The square is the whole screen, as `useWatchHologramSize` makes it: the drawing keeps its
        // own distance from the edge, so a square the width of a round screen still sits inside it.
        canvas.translate(watchGlass.x, watchGlass.y);
        drawHologram(canvas, watchScreen, frame, scene, resources);
        canvas.restore();
      }
      paintWatchShell(skia, canvas);
    },
  });
  console.log(`watch: ${watchCount} frames`);

  const phone = join(output, 'jarvis-on-a-phone');
  const watch = join(output, 'jarvis-on-a-watch');
  // The watch's GIF is the narrower of the two although its frame is the squarer, because on a
  // watch the sphere *is* the screen: nearly every pixel changes every frame, and a GIF pays for
  // each of them. Side by side in a README the two come out about the same height anyway.
  stitch(phoneFrames, phone, 260);
  stitch(watchFrames, watch, 240);
  rmSync(working, { recursive: true, force: true });

  for (const path of [`${phone}.webm`, `${phone}.gif`, `${watch}.webm`, `${watch}.gif`]) {
    console.log(`${path} — ${megabytes(path)}`);
  }
}

await main();
