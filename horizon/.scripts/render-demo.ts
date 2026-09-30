/**
 * Renders a demo video of the headset app: the living room waiting for "Hey Jarvis", Jarvis
 * arriving, a walk up to him and once round him while he walks his moods, and a step back.
 *
 * It drives the real build in headless Chromium with the browser tests' emulated Quest 3 and
 * living room (`tests/e2e/`), photographs every frame, and encodes them into a WebM (VP9 and Opus)
 * with the greeting under them, heard from where he stands as the filmed head moves
 * (`demo-soundtrack.ts`). The page is opened with `?film`, so sample mode leaves out its
 * frame-rate readout, which would only report the faked clock below.
 *
 * **Why it is smooth although the emulator is not.** SwiftShader draws the room at about a frame a
 * second while he is in it. So the page's clock is Playwright's fake one (`page.clock`: Date,
 * performance, timers), paused, and `requestAnimationFrame` is replaced by a queue this script
 * empties itself. Each video frame advances the clock by exactly one frame's time and then runs
 * exactly one animation frame, which is one XR frame: the emulator stamps it with the faked
 * `performance.now()`, the app's frame loop steps by that, and so does everything that animates
 * him. However long a frame takes to draw, the video sees 1/fps pass between frames.
 *
 * **Why two rooms.** The opening is the real room, entered with a key, waiting with its hint.
 * Everything after the cut is sample mode ("Try him in your room"), because a real summon needs
 * ElevenLabs and a network, and sample mode walks his moods on a select. The cut is made from the
 * same head pose, so it reads as him answering.
 *
 * Usage (from the repository root; `bunx turbo build --filter=horizon` first):
 *
 *   timeout 3600 bun horizon/.scripts/render-demo.ts [--out file.webm] [--seconds 36]
 *     [--size 1280x720] [--fps 30] [--fov 66] [--frames dir] [--keep-frames] [--readme]
 *
 * `--seconds` stretches or squeezes the whole shot, so a short draft still has every beat. The
 * frames go to a temporary folder (or `--frames`) and are deleted once the encode succeeds, unless
 * `--keep-frames`. `--readme` also writes the README's copies beside the WebM — an animated WebP and
 * a GIF behind it, since GitHub plays no video from a repository (see `readmeWebpArguments`).
 * FFMPEG_PATH picks the ffmpeg; CHROMIUM_EXECUTABLE_PATH the browser, as for the browser tests.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, chromium, type Page } from '@playwright/test';
import type { Subprocess } from 'bun';
import { GREETING_REPEAT_SECONDS, GREETING_SECONDS } from 'hologram';
import config from '../playwright.config';
import type { RoomPoint } from '../src/debug-hook';
import { withSavedSettings } from '../tests/e2e/app-driver';
import { bundle, keepOffline } from '../tests/e2e/fixtures';
import {
  decodeMono,
  encodeArguments,
  findFfmpeg,
  type GreetingClip,
  greetingClips,
  readmeGifArguments,
  readmeGifPaletteArguments,
  readmeWebpArguments,
  runFfmpeg,
  type SpeakingSpan,
} from './demo-encode';
import {
  type CameraPath,
  createCameraPath,
  DEFAULT_SECONDS,
  type DemoMood,
  type DemoScript,
  demoScript,
  type HeadStart,
  type Pose,
} from './demo-shot';
import {
  filmLevel,
  gainTimeline,
  heardFrom,
  type StereoGains,
  spatialSoundtrack,
  stereoGains,
  wavFile,
} from './demo-soundtrack';
import { SITE_PREFIX } from './serve-dist';

const HERE = import.meta.dir;
const BUILD = path.resolve(HERE, '../../dist/horizon');
const RECORDING = path.resolve(HERE, '../../hologram/assets/greeting.mp3');

/**
 * The emulated headset's vertical field of view, in degrees.
 *
 * IWER's default is 90°, which on a 16:9 frame is 121° across and leaves him a speck at 1.6 m.
 * 66° is about 98° across — close to a Quest 3's own width, so the room around him stays in the
 * picture — and still keeps the name of his mood, which hangs under him, in frame at arm's length.
 */
const DEFAULT_FIELD_OF_VIEW_DEGREES = 66;

/** How long the page gets to load its models, enter a room or show its hint, in milliseconds. */
const SETUP_TIMEOUT_MS = 120_000;

/** How long placement, which answers from a worker on real time, may take to find him a spot. */
const PLACEMENT_TIMEOUT_MS = 30_000;

/** How many times a select on him that did not change his mood is tried before the script moves on. */
const SELECT_ATTEMPTS = 4;

/** The soundtrack's sample rate: Opus's own, so nothing is resampled on the way into the encode. */
const SOUNDTRACK_SAMPLE_RATE = 48_000;

interface Options {
  out: string;
  seconds: number;
  width: number;
  height: number;
  framesPerSecond: number;
  fieldOfViewDegrees: number;
  frames: string | undefined;
  keepFrames: boolean;
  readme: boolean;
}

function readOptions(): Options {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: 'string' },
      seconds: { type: 'string' },
      size: { type: 'string' },
      fps: { type: 'string' },
      fov: { type: 'string' },
      frames: { type: 'string' },
      'keep-frames': { type: 'boolean' },
      readme: { type: 'boolean' },
    },
    strict: true,
  });
  const size = /^(\d+)x(\d+)$/.exec(values.size ?? '1280x720');
  if (size === null) throw new Error(`--size must be WIDTHxHEIGHT, like 1280x720, not ${values.size}.`);
  const number = (text: string | undefined, fallback: number, name: string) => {
    const parsed = text === undefined ? fallback : Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number, not ${text}.`);
    return parsed;
  };
  return {
    out: path.resolve(values.out ?? 'horizon-demo.webm'),
    seconds: number(values.seconds, DEFAULT_SECONDS, 'seconds'),
    width: Number(size[1]),
    height: Number(size[2]),
    framesPerSecond: Math.round(number(values.fps, 30, 'fps')),
    fieldOfViewDegrees: number(values.fov, DEFAULT_FIELD_OF_VIEW_DEGREES, 'fov'),
    frames: values.frames === undefined ? undefined : path.resolve(values.frames),
    keepFrames: values['keep-frames'] === true,
    readme: values.readme === true,
  };
}

declare global {
  interface Window {
    /** The animation-frame queue this script empties once per video frame (see {@link takeOverFrames}). */
    __demoFrames?: { flush(): number };
  }
}

/** What the page says after each frame. */
interface FrameReport {
  /** The faked clock, in milliseconds. */
  now: number;
  phase: string | undefined;
  scene: string | undefined;
  hint: boolean;
}

/** What one frame hands the emulated headset. */
interface FrameInput {
  head: Pose;
  hand: Pose | undefined;
  /** Whether to pull the trigger in this frame: a select, released again inside it. */
  press: boolean;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Waits until `check` says yes, asking every 100 ms, or fails saying what was waited for. */
async function until(what: string, check: () => Promise<boolean>, timeout = SETUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Gave up waiting for ${what}.`);
    await wait(100);
  }
}

/** A port nothing is listening on, to serve the build from. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  probe.stop(true);
  if (port === undefined) throw new Error('No free port could be found.');
  return port;
}

/** The build, served under its Pages sub-path by the browser tests' own server. */
async function serveBuild(port: number): Promise<Subprocess> {
  const server = Bun.spawn(['bun', path.join(HERE, 'serve-dist.ts'), String(port)], {
    stdout: 'ignore',
    stderr: 'inherit',
  });
  await until('the build server', async () => {
    try {
      return (await fetch(`http://localhost:${port}${SITE_PREFIX}`)).ok;
    } catch {
      return false;
    }
  });
  return server;
}

/**
 * Stops the page's clock and takes `requestAnimationFrame` over, so that frames happen only when
 * {@link renderFrame} asks for one.
 *
 * Playwright's fake clock fires animation frames on its own 16 ms grid, which at 30 fps would draw
 * two frames — sometimes three — for every one photographed. The emulator asks for its next frame
 * through `globalThis.requestAnimationFrame` each time, so replacing it on the window is enough;
 * the one frame it had already asked the fake clock for fires once more, which the warm-up step
 * after this absorbs. Handles start far above any the fake clock hands out, so a late
 * `cancelAnimationFrame` for one of those can be passed on to it.
 */
async function takeOverFrames(page: Page) {
  for (;;) {
    try {
      const pageNow = await page.evaluate(() => Date.now());
      // Jumping forward a little, since the page's clock kept running while it was asked the time.
      await page.clock.pauseAt(pageNow + 2000);
      break;
    } catch (error) {
      if (!String(error).includes('past')) throw error;
    }
  }
  await page.evaluate(() => {
    if (window.__demoFrames !== undefined) return;
    const pending = new Map<number, FrameRequestCallback>();
    let lastHandle = 1_000_000_000;
    const cancelOnClock = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      lastHandle += 1;
      pending.set(lastHandle, callback);
      return lastHandle;
    };
    window.cancelAnimationFrame = (handle) => {
      if (handle === null || handle === undefined) return;
      if (!pending.delete(handle)) cancelOnClock(handle);
    };
    window.__demoFrames = {
      flush() {
        const callbacks = [...pending.values()];
        pending.clear();
        const now = performance.now();
        for (const callback of callbacks) callback(now);
        return callbacks.length;
      },
    };
  });
}

/**
 * Advances the page's clock by `advance` milliseconds, poses the headset and its controller, and
 * runs one animation frame — one XR frame.
 */
async function renderFrame(page: Page, advance: number, input: FrameInput): Promise<FrameReport> {
  if (advance > 0) await page.clock.runFor(advance);
  return page.evaluate(({ head, hand, press }) => {
    const device = window.__xrHarness?.device;
    const frames = window.__demoFrames;
    if (device === undefined || frames === undefined) throw new Error('The emulated headset is not in place.');
    device.position.set(head.position.x, head.position.y, head.position.z);
    device.quaternion.set(head.orientation.x, head.orientation.y, head.orientation.z, head.orientation.w);
    const controller = device.controllers.right;
    if (controller !== undefined) {
      if (hand !== undefined) {
        controller.position.set(hand.position.x, hand.position.y, hand.position.z);
        controller.quaternion.set(hand.orientation.x, hand.orientation.y, hand.orientation.z, hand.orientation.w);
      }
      if (press) {
        // Let go inside the select the press causes, so the press is one frame long: a tap.
        device.activeSession?.addEventListener('select', () => controller.updateButtonValue('trigger', 0), {
          once: true,
        });
        controller.updateButtonValue('trigger', 1);
      } else {
        controller.updateButtonValue('trigger', 0);
      }
    }
    frames.flush();
    const state = window.__jarvis;
    return {
      now: performance.now(),
      phase: state?.phase,
      scene: state?.room?.scene,
      hint: (state?.room?.view.panels.hint ?? null) !== null,
    };
  }, input);
}

async function debugPlacement(page: Page): Promise<{ centre: RoomPoint; radius: number }> {
  const state = await page.evaluate(() => window.__jarvis);
  if (state?.hologramPosition == null || state.placement === null) throw new Error('He was never placed.');
  return { centre: state.hologramPosition, radius: state.placement.radius };
}

/** Where the harness stood the head, and which way it faces. */
async function headStart(page: Page): Promise<HeadStart> {
  const pose = await page.evaluate(() => {
    const device = window.__xrHarness?.device;
    if (device === undefined) throw new Error('The emulated headset is not in place.');
    const { x, y, z, w } = device.quaternion;
    return { position: { x: device.position.x, y: device.position.y, z: device.position.z }, x, y, z, w };
  });
  // The turn about +Y whose −Z the headset's own −Z points along, read from its orientation.
  const forwardX = -2 * (pose.x * pose.z + pose.w * pose.y);
  const forwardZ = -(1 - 2 * (pose.x * pose.x + pose.y * pose.y));
  return { position: pose.position, yaw: Math.atan2(-forwardX, -forwardZ) };
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Everything one render keeps track of while it goes. */
interface Render {
  page: Page;
  options: Options;
  script: DemoScript;
  start: HeadStart;
  path: CameraPath;
  framesDirectory: string;
  totalFrames: number;
  /** The faked clock at this segment's first frame, and that frame's number in the video. */
  segmentOrigin: { now: number; frame: number };
  /** The scene after every frame, by video time, for laying the greeting under him. */
  scenes: { seconds: number; scene: string | undefined }[];
  /** Where he was placed, which his voice is heard from; undefined until he is. */
  speaker: RoomPoint | undefined;
  /** When the first frame was photographed, for the estimate of how long the rest will take. */
  shootingSince: number;
}

function frameFile(render: Render, frame: number) {
  return path.join(render.framesDirectory, `frame-${String(frame).padStart(5, '0')}.png`);
}

/** The faked clock's time for video frame `frame`: the segment's origin plus whole frames since. */
function clockFor(render: Render, frame: number): number {
  const since = frame - render.segmentOrigin.frame;
  return render.segmentOrigin.now + Math.round((since * 1000) / render.options.framesPerSecond);
}

function reportProgress(render: Render, frame: number, label: string) {
  const done = frame + 1;
  if (done % 10 !== 0 && done !== render.totalFrames) return;
  const elapsed = (Date.now() - render.shootingSince) / 1000;
  const perFrame = elapsed / done;
  console.log(
    `frame ${done}/${render.totalFrames} (${label}) · ${perFrame.toFixed(2)} s a frame · ETA ${formatDuration(perFrame * (render.totalFrames - done))}`,
  );
}

/** Renders and photographs one video frame. */
async function shootFrame(render: Render, frame: number, press: boolean): Promise<FrameReport> {
  const seconds = frame / render.options.framesPerSecond;
  const current = await render.page.evaluate(() => performance.now());
  const report = await renderFrame(render.page, Math.max(0, clockFor(render, frame) - current), {
    head: render.path.headAt(seconds),
    hand: render.path.handAt(seconds),
    press,
  });
  await render.page.screenshot({ path: frameFile(render, frame), caret: 'initial' });
  render.scenes.push({ seconds, scene: report.scene });
  return report;
}

/** The waiting room: the real app, entered with a key, its hint up, until the cut. */
async function shootWaitingRoom(render: Render, hintFrames: number) {
  const { page } = render;
  const enter = page.getByRole('button', { name: 'Enter your room' });
  await until('"Enter your room" (the wake-word models and CanvasKit loading)', () => enter.isEnabled());
  await enter.click();
  await until('the room to show its hint (the wake word listening)', async () =>
    page.evaluate(() => (window.__jarvis?.room?.view.panels.hint ?? null) !== null),
  );
  await takeOverFrames(page);
  const warmUp = await renderFrame(page, 1, { head: render.path.headAt(0), hand: undefined, press: false });
  render.segmentOrigin = { now: warmUp.now + Math.round(1000 / render.options.framesPerSecond), frame: 0 };
  render.shootingSince = Date.now();
  for (let frame = 0; frame < hintFrames; frame += 1) {
    const report = await shootFrame(render, frame, false);
    if (!report.hint) console.warn(`frame ${frame}: the hint is not up (scene ${report.scene}).`);
    reportProgress(render, frame, 'waiting for "Hey Jarvis"');
  }
}

/**
 * Leaves the real room and opens sample mode, from the same head pose, drawing frames nobody sees
 * until the new room exists: ending a session and opening another take the page a few of its own
 * timers and frames.
 */
async function openSampleMode(render: Render, cutFrame: number) {
  const { page } = render;
  const head = render.path.headAt(cutFrame / render.options.framesPerSecond);
  const frameMilliseconds = Math.round(1000 / render.options.framesPerSecond);
  const pump = (what: string, done: (report: FrameReport) => boolean) =>
    until(what, async () => done(await renderFrame(page, frameMilliseconds, { head, hand: undefined, press: false })));
  await page.evaluate(() => window.__xrHarness?.device.activeSession?.end());
  await pump('the page to come back after the room', (report) => report.phase === 'ready');
  await page.getByRole('button', { name: 'Try him in your room' }).click();
  await pump(
    'sample mode to open',
    (report) => report.scene === 'placing' || (report.scene?.startsWith('sample:') ?? false),
  );
  const now = await page.evaluate(() => performance.now());
  render.segmentOrigin = { now: now + frameMilliseconds, frame: cutFrame };
}

/**
 * The selects on him that walk his moods: how many have landed, and the last try.
 *
 * A select that has not changed the mood by the frame after it is tried again a frame later: the
 * emulator only selects on a fresh press, so the trigger has to be let go in between.
 */
interface SelectsMade {
  made: number;
  attempts: number;
  pressedOn: number;
}

/** The mood the select due at `seconds` should bring, if one is due and may be tried in this frame. */
function dueSelect(script: DemoScript, selects: SelectsMade, frame: number, seconds: number): DemoMood | undefined {
  const next = script.selects[selects.made];
  if (next === undefined || seconds < next.at || frame === selects.pressedOn + 1) return undefined;
  selects.pressedOn = frame;
  return next.mood;
}

function checkSelect(selects: SelectsMade, mood: DemoMood, report: FrameReport) {
  selects.attempts += 1;
  if (report.scene === `sample:${mood}`) {
    selects.made += 1;
    selects.attempts = 0;
  } else if (!report.scene?.startsWith('sample:')) {
    throw new Error(`A select on him left sample mode (scene ${report.scene}): the controller missed him.`);
  } else if (selects.attempts >= SELECT_ATTEMPTS) {
    console.warn(`The select for ${mood} did not land after ${selects.attempts} tries; moving on.`);
    selects.made += 1;
    selects.attempts = 0;
  }
}

/**
 * Once he has a spot, rebuilds the camera path around it and says so; until then, says he has not.
 *
 * Placement answers from a worker on real time, while the page's clock stands still: waiting for it
 * here, between frames, puts his arrival on the same frame in every render.
 */
async function noticePlacement(render: Render, report: FrameReport, seconds: number): Promise<boolean> {
  const { page } = render;
  let scene = report.scene;
  if (scene === 'placing') {
    await until(
      'placement to find him a spot',
      async () => (await page.evaluate(() => window.__jarvis?.room?.scene)) !== 'placing',
      PLACEMENT_TIMEOUT_MS,
    );
    scene = await page.evaluate(() => window.__jarvis?.room?.scene);
    render.scenes.push({ seconds, scene });
  }
  if (!scene?.startsWith('sample:')) return false;
  const { centre, radius } = await debugPlacement(page);
  render.path = createCameraPath(render.script, render.start, { centre, radius, at: seconds });
  render.speaker = centre;
  console.log(`He was placed at (${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}, ${centre.z.toFixed(2)}).`);
  return true;
}

/** Sample mode, from the cut to the end: the arrival, the walk, the turn and the walk back. */
async function shootSampleMode(render: Render, cutFrame: number) {
  const selects: SelectsMade = { made: 0, attempts: 0, pressedOn: Number.NEGATIVE_INFINITY };
  let placed = false;
  for (let frame = cutFrame; frame < render.totalFrames; frame += 1) {
    const seconds = frame / render.options.framesPerSecond;
    const mood = placed ? dueSelect(render.script, selects, frame, seconds) : undefined;
    const report = await shootFrame(render, frame, mood !== undefined);
    if (!placed) placed = await noticePlacement(render, report, seconds);
    if (mood !== undefined) checkSelect(selects, mood, report);
    reportProgress(render, frame, report.scene ?? 'no room');
  }
}

/** The stretches in which he was speaking, from the scene after every frame. */
function speakingSpans(scenes: Render['scenes'], seconds: number): SpeakingSpan[] {
  const spans: SpeakingSpan[] = [];
  let open: number | undefined;
  for (const { seconds: at, scene } of scenes) {
    const speaking = scene === 'sample:speaking';
    if (speaking && open === undefined) open = at;
    if (!speaking && open !== undefined) {
      spans.push({ start: open, end: at });
      open = undefined;
    }
  }
  if (open !== undefined) spans.push({ start: open, end: seconds });
  return spans;
}

/**
 * Writes the film's soundtrack to `file`: the greeting at every clip, heard from where he was
 * placed by the head the camera path moved, so his voice leans the way he is and fades as the
 * head backs away, as the app's own panner would have it.
 */
async function writeSoundtrack(render: Render, ffmpeg: string, clips: GreetingClip[], file: string) {
  const recording = await decodeMono(ffmpeg, RECORDING, SOUNDTRACK_SAMPLE_RATE);
  const { speaker } = render;
  const seconds = render.options.seconds;
  // He only ever speaks once he has been placed, so an unplaced render has no clips to be heard.
  const centred: StereoGains = { left: 1, right: 1 };
  const timeline = gainTimeline(
    (at) => (speaker === undefined ? centred : stereoGains(heardFrom(render.path.headAt(at), speaker))),
    seconds,
  );
  const track = spatialSoundtrack(recording, clips, timeline, {
    sampleRate: SOUNDTRACK_SAMPLE_RATE,
    seconds,
    level: filmLevel(recording),
  });
  await Bun.write(file, wavFile(track));
}

function prepareFramesDirectory(options: Options): string {
  if (options.frames === undefined) return mkdtempSync(path.join(tmpdir(), 'horizon-demo-'));
  mkdirSync(options.frames, { recursive: true });
  for (const file of readdirSync(options.frames).filter((name) => /^frame-\d+\.png$/.test(name))) {
    rmSync(path.join(options.frames, file));
  }
  return options.frames;
}

async function openPage(browser: Browser, options: Options, port: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    permissions: config.use?.permissions,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.warn(`page error: ${error.message}`));
  await keepOffline(page);
  await page.addInitScript({ content: await bundle('xr-harness.ts') });
  await withSavedSettings(page);
  await page.clock.install();
  await page.goto(`http://localhost:${port}${SITE_PREFIX}?film`);
  await page.evaluate(() => window.__xrHarness?.ready);
  await page.evaluate(
    (fovy) => {
      const device = window.__xrHarness?.device;
      if (device !== undefined) device.fovy = fovy;
    },
    (options.fieldOfViewDegrees * Math.PI) / 180,
  );
  return page;
}

async function main() {
  const options = readOptions();
  if (!existsSync(path.join(BUILD, 'index.html'))) {
    throw new Error(`${BUILD} has no build in it. Run: timeout 300 bunx turbo build --filter=horizon`);
  }
  const ffmpeg = await findFfmpeg();
  const script = demoScript(options.seconds);
  const totalFrames = Math.round(options.seconds * options.framesPerSecond);
  const cutFrame = Math.round(script.hintSeconds * options.framesPerSecond);
  const framesDirectory = prepareFramesDirectory(options);
  console.log(
    `Rendering ${totalFrames} frames at ${options.width}x${options.height}, ${options.framesPerSecond} fps, into ${framesDirectory}`,
  );

  const startedAt = Date.now();
  const port = freePort();
  const server = await serveBuild(port);
  // An interrupted render skips the `finally` below, and the server would outlive it on its port.
  // Chromium needs no such care: it goes when the pipe Playwright drives it through closes.
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      server.kill();
      process.exit(code);
    });
  }
  let browser: Browser | undefined;
  let render: Render;
  try {
    browser = await chromium.launch({ ...config.use?.launchOptions });
    const page = await openPage(browser, options, port);
    const start = await headStart(page);
    render = {
      page,
      options,
      script,
      start,
      path: createCameraPath(script, start),
      framesDirectory,
      totalFrames,
      segmentOrigin: { now: 0, frame: 0 },
      scenes: [],
      speaker: undefined,
      shootingSince: startedAt,
    };
    await shootWaitingRoom(render, cutFrame);
    await openSampleMode(render, cutFrame);
    await shootSampleMode(render, cutFrame);
  } catch (error) {
    console.error(`The render failed; the frames so far are in ${framesDirectory}.`);
    throw error;
  } finally {
    await browser?.close();
    server.kill();
  }
  const rendered = (Date.now() - startedAt) / 1000;

  const clips = greetingClips(
    speakingSpans(render.scenes, options.seconds),
    GREETING_SECONDS,
    GREETING_REPEAT_SECONDS,
    options.seconds - script.fadeOutSeconds,
  );
  console.log(
    `Encoding, with the greeting at ${clips.map((clip) => `${clip.start.toFixed(2)} s`).join(', ') || 'no point'}…`,
  );
  const soundtrack = path.join(framesDirectory, 'soundtrack.wav');
  await writeSoundtrack(render, ffmpeg, clips, soundtrack);
  mkdirSync(path.dirname(options.out), { recursive: true });
  await runFfmpeg(
    ffmpeg,
    encodeArguments(path.join(framesDirectory, 'frame-%05d.png'), soundtrack, options.out, {
      seconds: options.seconds,
      framesPerSecond: options.framesPerSecond,
      fadeInSeconds: script.fadeInSeconds,
      fadeOutSeconds: script.fadeOutSeconds,
    }),
  );
  if (options.readme) {
    const base = options.out.replace(/\.webm$/, '');
    const palette = path.join(framesDirectory, 'readme-palette.png');
    console.log('Writing the README copies…');
    await runFfmpeg(ffmpeg, readmeWebpArguments(options.out, `${base}.webp`));
    await runFfmpeg(ffmpeg, readmeGifPaletteArguments(options.out, palette));
    await runFfmpeg(ffmpeg, readmeGifArguments(options.out, palette, `${base}.gif`));
  }
  if (!options.keepFrames) rmSync(framesDirectory, { recursive: true, force: true });
  const total = (Date.now() - startedAt) / 1000;
  console.log(`Rendered in ${formatDuration(rendered)}, encoded in ${formatDuration(total - rendered)}.`);
  console.log(`Wrote ${options.out}`);
}

await main();
