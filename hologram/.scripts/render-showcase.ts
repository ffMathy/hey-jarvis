/**
 * Renders the two clips in the README: Jarvis summoned on a phone, and on a watch.
 *
 * Frame by frame, headlessly, through the same drawing both apps use and the same voice pipeline
 * the view runs every frame — see `simulated-performance.ts`, which is where that pipeline lives
 * and which the Play Store assets are rendered from too. So what the clip shows is what the app
 * does, rather than an impression of it drawn separately.
 *
 * All of him is drawn on the GPU, body and all, through `hologram/gpu` in headless Chromium, as the
 * phone and the watch draw him: this script keeps the timeline, the voice and the encoding, and
 * `render-showcase-page.ts` draws each frame in the page `render-page.ts` opens.
 *
 * The devices around him are real frames rather than shapes drawn here. The phone is Google's own
 * Pixel 10 Pro device art, the one Android Studio wraps a screenshot in; the watch is a Pixel Watch
 * 3 vector, because Google publishes device art for every Pixel phone and none for its watch; and
 * what is behind the assistant's sheet is the Blue Marble. They live in `device-art/`, fetched by
 * `prepare-device-art.sh`, and `device-art/NOTICE.md` says where each came from and under what
 * licence — including that the watch clips inherit CC BY-SA 4.0 from the frame in them.
 *
 * **Each device is drawn at the most particles it can hold** — `PARTICLE_COUNT`, on the phone and
 * the watch alike — never at a number chosen here. On a device the density loop
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
 * that is removed afterwards. CHROMIUM_EXECUTABLE_PATH picks the browser, as for the browser tests.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  GREETING_SECONDS,
  LEAVING_SECONDS,
  MATERIALISE_SECONDS,
  moodOf,
  SAMPLE_MODE_NAMES,
  type SimulatedMood,
  THOUGHT_FADE_SECONDS,
} from '../src/index';
import { bytesOf, openRenderPage } from './render-page';
import { createPerformance, findLoudestMoment, type SimulatedFrame, stillMoment } from './simulated-performance';

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

/** How long the label naming what he is doing takes to hand over from one name to the next. */
const LABEL_FADE_SECONDS = 0.3;

/** How long the sheet takes to arrive, and to go: `ARRIVE_MS` and `LEAVE_MS` in `sample-sheet.tsx`. */
const SHEET_ARRIVES_SECONDS = 0.26;
const SHEET_LEAVES_SECONDS = 0.2;

/** A beat of dark at either end of the watch's clip, since it has no sheet to open and close. */
const WATCH_HOLD_SECONDS = 0.26;

/**
 * How much of the palette the GIF may use, and how it is chosen.
 *
 * Both went up when the wallpaper did. `stats_mode=diff` weights the palette toward what changes
 * between frames, which here is the sphere and nothing else — so the wallpaper, being perfectly
 * still, was given almost no colours at all and came out grey. `full` weighs the whole frame.
 */
const GIF_PALETTE_STATS = 'full';

/** How long to look through for the loudest instant of speech. Three phrases' worth. */
const COVER_LISTEN_SECONDS = 9;

function clamp(value: number, lowest: number, highest: number): number {
  return value < lowest ? lowest : value > highest ? highest : value;
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
 * 3. **Listening** — somebody talking to him, and his particles snapping onto a turning lattice.
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

type Moment = ReturnType<ReturnType<typeof writeScript>['at']>;

/** Which of the page's two clips a frame is drawn for. */
type ClipPainter = (page: Page, moment: Moment, frame: SimulatedFrame) => Promise<string>;

const paintPhone: ClipPainter = (page, moment, frame) =>
  page.evaluate(([shown, drawn]) => window.showcase.phoneFrame(shown, drawn), [moment, frame] as const);
const paintWatch: ClipPainter = (page, moment, frame) =>
  page.evaluate(([shown, drawn]) => window.showcase.watchFrame(shown, drawn), [moment, frame] as const);

/**
 * Renders one clip's frames into `into`, as numbered PNGs, and returns how many there were.
 *
 * The page draws the device and everything on its screen (`render-showcase-page.ts`); what is
 * happening at each moment, and the frame of him it comes to, is worked out here. Each frame is
 * transparent outside the device, so the clip sits on whatever page it is put on. All three formats
 * carry it: WebP and VP9 have a real alpha channel, and the GIF gets the one transparent palette
 * entry it allows.
 */
async function renderClip(
  page: Page,
  into: string,
  clip: { opensOver: number; closesOver: number; paint: ClipPainter },
): Promise<number> {
  const script = writeScript(clip.opensOver, clip.closesOver);
  const perform = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);

  let frames = 0;
  for (let seconds = 0; seconds <= script.endsAt; seconds += FRAME_SECONDS) {
    const moment = script.at(seconds);
    const png = await clip.paint(page, moment, perform(moment));
    writeFileSync(join(into, `${String(frames).padStart(5, '0')}.png`), bytesOf(png));
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
  const working = mkdtempSync(join(tmpdir(), 'jarvis-showcase-'));
  const output = join(process.cwd(), 'docs');
  mkdirSync(output, { recursive: true });
  const phone = join(output, 'jarvis-on-a-phone');
  const watch = join(output, 'jarvis-on-a-watch');
  const cover = join(output, 'jarvis.png');

  const { page, close } = await openRenderPage('render-showcase-page.ts');
  try {
    const sizes = await page.evaluate(() => window.showcase.setUp());

    // ---- the phone: a sheet summoned up over whatever you were doing ---------------------------
    const phoneFrames = join(working, 'phone');
    mkdirSync(phoneFrames);
    const phoneCount = await renderClip(page, phoneFrames, {
      opensOver: SHEET_ARRIVES_SECONDS,
      closesOver: SHEET_LEAVES_SECONDS,
      paint: paintPhone,
    });
    console.log(`phone: ${phoneCount} frames at ${sizes.phone.width}x${sizes.phone.height}`);

    // ---- the watch: black to the edges, and nothing else -----------------------------------------
    const watchFrames = join(working, 'watch');
    mkdirSync(watchFrames);
    const watchCount = await renderClip(page, watchFrames, {
      opensOver: WATCH_HOLD_SECONDS,
      closesOver: WATCH_HOLD_SECONDS,
      paint: paintWatch,
    });
    console.log(`watch: ${watchCount} frames at ${sizes.watch.width}x${sizes.watch.height}`);

    // The widths the README shows them at, so the two sit level beside each other — the watch frame
    // is much less tall than the phone, so matching their widths would leave the watch looking like a
    // coin next to it. They are rendered at README_PIXEL_DENSITY times these.
    stitch(phoneFrames, phone, 240);
    stitch(watchFrames, watch, 260);

    // ---- the cover: one still, at full size, with his name round it ------------------------------
    // Walked to the loudest instant of speech rather than dropped into it: everything the drawing
    // does is carried from the frame before, so the only way to be at a moment is to have got there.
    // Speaking is when he has most to look at — the swarm swells, the rim throws chips — and the
    // loudest instant of it is when that is furthest along.
    const loudest = findLoudestMoment(COVER_LISTEN_SECONDS, FRAME_SECONDS);
    const speaking = createPerformance(FRAME_SECONDS, THOUGHT_FADE_SECONDS);
    let mid = speaking(stillMoment(0));
    for (let seconds = FRAME_SECONDS; seconds <= loudest; seconds += FRAME_SECONDS) {
      mid = speaking(stillMoment(seconds));
    }
    const drawn = await page.evaluate((frame) => window.showcase.cover(frame), mid);
    writeFileSync(cover, bytesOf(drawn.png));
    console.log(`cover: from a ${drawn.emblemWidth}x${drawn.emblemHeight} emblem, loudest at ${loudest.toFixed(2)} s`);
  } finally {
    await close();
    rmSync(working, { recursive: true, force: true });
  }

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
