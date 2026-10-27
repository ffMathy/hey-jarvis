import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { blockExternalRequests } from './external-requests';

/**
 * Jarvis on the GPU, in the phone's web build: all of him — his body and the rest of him, the
 * core, the cage, the aura, the embers and the satellites — is drawn by `hologram/gpu` into one canvas
 * (`hologram-canvas`). Where the browser cannot draw him there is no GL view and nothing of him, and
 * the screen goes on without him. See "His body on the GPU, on a phone and a watch" in `.claude/rules/hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md`.
 *
 * **Every test here runs on a stopped clock.** Playwright's fake clock replaces the page's
 * `requestAnimationFrame`, timers, `Date` and `performance`, and the page is stopped before sample
 * mode opens, so every frame he is drawn in is one this file steps. That is what makes the pictures
 * comparable at all. On the real clock the frame rate is whatever the machine running the tests
 * manages and the density loop steers the share of particles by it, so two pictures would be of
 * different moments with different particles in them. Stepped, both are of the same moment, with
 * the same particles, every time.
 *
 * What the clock does not stop is React. Its scheduler runs renders, commits and effects in tasks of
 * its own, on real time, so after a tap and after every step the spec waits for those to have run
 * (`untilReactIsIdle`) before it reads the page or steps again. Otherwise how far React had got
 * would be a race with the machine's speed, and a busy one would land the same work a step later.
 *
 * The numbers below that are the hologram's own are written out rather than imported, so the page
 * is held to numbers this file states rather than to whatever it and the bundle happen to share.
 * Each says which constant it is, and a change to one shows up here as a failure rather than as a
 * quiet mismatch.
 *
 * What these cannot see is a device: expo-gl's native view, Android composing it, and a phone's own
 * gravity sensor. The browser's GLView is a `<canvas>` with a WebGL 2 context drawn from the page's
 * thread, and the tilt is fed by a stand-in for the browser's sensor (`installAGravitySensor`).
 */

declare global {
  interface Window {
    /** His canvas at the end of each frame drawn into it, kept by `measureEveryFrame`. */
    canvasFrames?: Array<{ width: number; height: number; pixels: Uint8Array<ArrayBuffer> }>;
    /** Hands every started gravity sensor a reading at once: see `installAGravitySensor`. */
    tiltTo?: (x: number, y: number, z: number) => void;
    /** How many gravity sensors are started: one while the tilt is listening, none otherwise. */
    startedGravitySensors?: () => number;
    /** What lost his canvas's context, kept to give it back with. */
    canvasContextLoss?: WEBGL_lose_context;
    /** How many messages the page has posted on any `MessagePort`: see `countPostedMessages`. */
    postedMessages?: () => number;
  }
}

/** A gravity reading in Reanimated's device coordinates: x right, y up the screen, z out of it, pointing at the ground. */
type Reading = [x: number, y: number, z: number];

/** A picture's pixels, four bytes each, rows from the top. */
interface Pixels {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** What one frame put on his canvas, measured from its own pixels. */
interface CanvasFrame {
  /** The share of the canvas's pixels it lit at all. */
  litShare: number;
  /** Where its light is centred, from the canvas's centre, in sides of the canvas. */
  centreX: number;
  centreY: number;
  /** The share of its light that falls inside the sphere at its largest: see SPHERE_AT_LARGEST. */
  insideTheSphere: number;
}

/** Coarse measures of a picture of the page, over a box in it. */
interface Look {
  /** The share of the box's pixels that are lit: see LIT_LUMA. */
  litShare: number;
  /** Lit pixels anywhere outside the box. */
  litOutside: number;
  /** The mean luma over the box, 0–255. */
  meanLuma: number;
  /** Where the box's light is centred, from the box's centre, in sides of the box. */
  centreX: number;
  centreY: number;
}

/** Where in a picture to measure, in its pixels. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How long each stepped frame is, in milliseconds of the page's clock: ten frames a second, a
 * quarter of the forty the density loop holds (`TARGET_FRAMES_PER_SECOND`). Below half of that the
 * loop reads a device that cannot keep up and sheds particles as fast as it sheds them, so it ends
 * at the floor, the same share in every page stepped alike.
 */
const FRAME_MS = 100;

/** Frames until he has finished arriving (`MATERIALISE_SECONDS`, 0.7 s), and a few more. */
const ARRIVED_FRAMES = 10;

/**
 * Frames until the share is at the floor. It starts at half the particles (`STARTING_SHARE`) and was
 * measured reaching the floor by the fortieth stepped frame, the readout halving every half second
 * on the way; ten more for margin.
 */
const SHED_FRAMES = 50;

/** Frames for a tilt to settle back to the front, held: five seconds, past three of `TILT_REST_SECONDS` (1.5 s). */
const SETTLED_FRAMES = 50;

/**
 * The least share of his canvas that comes out differently when the eye moves: as it
 * comes in from infinitely far to the phone's, measured at 22%, and as a 15° tip turns him, at 38%.
 * A tenth is well below either and far above the nothing a view that never moved would differ by.
 */
const MOVED_EYE_SHARE = 0.1;

/** What the readout calls the floor: `FEWEST_PARTICLES` of `PARTICLE_COUNT`, 2.5% of 10,000. */
const FLOOR_SPARKS = '250 sparks';

/**
 * The last frame before a GPU that is never ready would stop holding his arrival
 * (`GPU_READY_TIMEOUT_MS`, 800 ms), with a frame to spare: drawn by then, he was not kept waiting.
 */
const BEFORE_THE_TIMEOUT_FRAMES = 6;

/**
 * The sphere at its largest, as a radius in sides of the drawing's square: `SPHERE_FRACTION` (0.27)
 * swollen as far as his voice swells him (`SWELL_WITH_VOICE`, 18%). His body is the shell of specks
 * inside it, round the white-hot ring at his core. What lies beyond it is the cage, the aura and the
 * embers round him, and the fray and the chips he throws past the limb while he speaks.
 */
const SPHERE_AT_LARGEST = 0.27 * 1.18;

/**
 * A pixel of the page counts as lit when its luma is past this, out of 255. The page behind him is
 * 7, and the faintest of his halos are in the twenties and thirties.
 */
const LIT_LUMA = 24;

/** What a phone held upright reads: gravity down the screen. */
const UPRIGHT: Reading = [0, -9.81, 0];

/** What a phone reads with its top edge tipped `degrees` away from the person holding it. */
function tippedAway(degrees: number): Reading {
  const radians = (degrees * Math.PI) / 180;
  return [0, -9.81 * Math.cos(radians), -9.81 * Math.sin(radians)];
}

/**
 * The most messages `untilReactIsIdle` sends round before it gives up on React running out of work.
 * A tap or a step sets React off on a handful of tasks, and ten thousand round trips take a quarter
 * of a second in Chromium here, so this is only there for a page that never stops posting: it fails
 * with a reason rather than hanging until the test's own timeout.
 */
const ROUND_TRIPS_AT_MOST = 10_000;

/** Keeps every error the page throws, for a test to say there were none. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * Counts every message the page posts on a `MessagePort`, passing each one on as it was, for
 * `untilReactIsIdle`. React DOM's scheduler queues each piece of its work by posting itself a message
 * on a `MessageChannel`, and its count going up is the one sign there is that it has queued more.
 */
function countPostedMessages() {
  const postMessage = MessagePort.prototype.postMessage;
  let posted = 0;
  Reflect.defineProperty(MessagePort.prototype, 'postMessage', {
    configurable: true,
    writable: true,
    value(this: MessagePort, ...message: unknown[]) {
      posted++;
      return Reflect.apply(postMessage, this, message);
    },
  });
  window.postedMessages = () => posted;
}

/**
 * Waits until React has run all the work the page has queued for it, so what a test reads or steps
 * next is the same on a fast machine and a slow one.
 *
 * Playwright's clock fakes timers, animation frames, `Date` and `performance`, so all of his drawing
 * happens inside a step. React DOM's scheduler uses none of them: it renders, commits and runs
 * effects — and the renders those set off — in tasks it queues by posting itself a message on a
 * `MessageChannel`, on real time. So after a tap or a step some of what follows from it is still
 * queued, and a test that reads the page or steps the clock straight away races it. On a busy
 * machine the test's next command can run before React's task does, and the work then lands a step
 * later than it would have: the view mounting, expo-gl making his context, the frame callback and
 * the tilt's sensor starting.
 *
 * A message posted here is delivered after every message posted before it, React's among them, so
 * by the time it arrives React has run what it had queued — unless that queued more, which the page's
 * count of posted messages says (`countPostedMessages`). So it is sent round again until one comes
 * back with nothing posted meanwhile but itself. React then has nothing left to do on real time:
 * whatever it still has waits on the stopped clock, for a step to run it.
 */
async function untilReactIsIdle(page: Page): Promise<void> {
  const idle = await page.evaluate(async (roundTripsAtMost) => {
    const postedMessages = window.postedMessages;
    if (postedMessages === undefined) {
      throw new Error('The page is not counting the messages it posts: see countPostedMessages');
    }
    const roundTrip = () =>
      new Promise<void>((arrived) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          arrived();
        };
        channel.port2.postMessage(undefined);
      });
    for (let roundTrips = 0; roundTrips < roundTripsAtMost; roundTrips++) {
      const postedBefore = postedMessages();
      await roundTrip();
      if (postedMessages() === postedBefore + 1) {
        return true;
      }
    }
    return false;
  }, ROUND_TRIPS_AT_MOST);
  expect(idle, `React was still queuing work after ${ROUND_TRIPS_AT_MOST} round trips`).toBe(true);
}

/**
 * Opens sample mode on a stopped clock, with the hologram's view mounted before the clock has moved.
 *
 * The clock runs while the page loads, so nothing in the app waits on a timer that never fires,
 * and stops on the tour. In a browser there is no sheet for him to wait for, so the view mounts in
 * the renders the tap sets off, which take no timer at all: once React has run them
 * (`untilReactIsIdle`) the view is there, expo-gl has made his context and set him up in it, and
 * his frame callback is waiting for the first step. So every page is at the same moment of him when
 * a test starts stepping, however fast the machine got there. The view is whatever is inside sample
 * mode's `hologram`: where there is a GL view it is in there, and where there is none the view's own
 * square still is.
 */
async function openSampleModeOnAStoppedClock(page: Page, path: string): Promise<void> {
  await page.clock.install();
  await page.addInitScript(countPostedMessages);
  await page.goto(path);
  await expect(page.getByTestId('try-sample')).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + FRAME_MS);

  await page.getByTestId('try-sample').click();
  await untilReactIsIdle(page);
  await expect(page.getByTestId('hologram')).toBeVisible();
  expect(
    await page.getByTestId('hologram').locator(':scope > *').count(),
    'the hologram view had not mounted before the clock moved',
  ).toBe(1);
}

/**
 * Steps the stopped clock by one frame, which runs exactly one animation frame, and waits for what
 * React makes of it.
 */
async function stepOneFrame(page: Page): Promise<void> {
  await page.clock.fastForward(FRAME_MS);
  await untilReactIsIdle(page);
}

/** Steps the stopped clock one frame at a time, as `stepOneFrame` does. */
async function stepFrames(page: Page, frames: number): Promise<void> {
  for (let frame = 0; frame < frames; frame++) {
    await stepOneFrame(page);
  }
}

/**
 * A gravity sensor where the browser has none, in the shape Reanimated's web path uses: it makes a
 * `GravitySensor`, listens for its `reading` events and reads its `x`, `y` and `z` — on a desktop,
 * in its own device coordinates, as they are handed on. Nothing reads on its own:
 * `window.tiltTo` hands every started sensor a reading at once, so a test gives one before each
 * frame it steps and the stopped clock stays the only thing that moves.
 */
function installAGravitySensor() {
  const started = new Set<FakeGravitySensor>();
  class FakeGravitySensor extends EventTarget {
    x = 0;
    y = 0;
    z = 0;
    start() {
      started.add(this);
    }
    stop() {
      started.delete(this);
    }
  }
  Reflect.set(window, 'GravitySensor', FakeGravitySensor);
  window.tiltTo = (x, y, z) => {
    for (const sensor of started) {
      sensor.x = x;
      sensor.y = y;
      sensor.z = z;
      sensor.dispatchEvent(new Event('reading'));
    }
  };
  window.startedGravitySensors = () => started.size;
}

/** Steps the stopped clock as `stepFrames` does, handing the gravity sensor `reading` before each frame, or nothing. */
async function stepReading(page: Page, frames: number, reading: Reading | undefined): Promise<void> {
  for (let frame = 0; frame < frames; frame++) {
    if (reading !== undefined) {
      await page.evaluate(([x, y, z]) => window.tiltTo?.(x, y, z), reading);
    }
    await stepOneFrame(page);
  }
}

/**
 * Sends the page to the background or brings it back, as far as the app can tell — which is what
 * the phone's app sees between summonings — and waits for React to have done what it does about
 * that, which stops or starts the tilt's sensor with it.
 */
async function bringToTheFront(page: Page, front: boolean): Promise<void> {
  await page.evaluate((visible) => {
    Reflect.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, front);
  await untilReactIsIdle(page);
  expect(await page.evaluate(() => window.startedGravitySensors?.())).toBe(front ? 1 : 0);
}

/** Another page in a context of its own, the size of `like`, opened as `like` was. */
async function anotherPageLike(browser: Browser, like: Page): Promise<Page> {
  const context = await browser.newContext({ viewport: like.viewportSize() });
  const page = await context.newPage();
  await blockExternalRequests(page);
  return page;
}

/**
 * Keeps his canvas at the end of every frame drawn into it, from now on, in `window.canvasFrames`.
 *
 * Read inside the frame because nothing else can read it: the canvas keeps no drawing buffer
 * between frames (`preserveDrawingBuffer` is off, as on a device). expo-gl's browser context has an
 * `endFrameEXP` of its own, which the view calls straight after drawing, so that is where this
 * reads the pixels before handing on.
 */
async function measureEveryFrame(canvas: Locator): Promise<void> {
  await canvas.evaluate((element) => {
    const gl = element instanceof HTMLCanvasElement ? element.getContext('webgl2') : null;
    const present: unknown = gl === null ? undefined : Reflect.get(gl, 'endFrameEXP');
    if (gl === null || typeof present !== 'function') {
      throw new Error('His canvas has no WebGL 2 context of expo-gl’s');
    }
    window.canvasFrames = [];
    Reflect.set(gl, 'endFrameEXP', () => {
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      window.canvasFrames?.push({ width, height, pixels });
      Reflect.apply(present, gl, []);
    });
  });
}

/** Bytes from the page, which hands them over as base64 rather than as a list of numbers. */
function bytesFromThePage(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** The frames `measureEveryFrame` has kept since it last handed any over, as pictures. */
async function takeCanvasPictures(page: Page): Promise<Pixels[]> {
  const frames = await page.evaluate(async () => {
    const kept = window.canvasFrames ?? [];
    window.canvasFrames = [];
    return Promise.all(
      kept.map(async ({ width, height, pixels }) => {
        const asDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(new Blob([pixels]));
        });
        return { width, height, base64: asDataUrl.slice(asDataUrl.indexOf(',') + 1) };
      }),
    );
  });
  return frames.map(({ width, height, base64 }) => ({
    width,
    height,
    rgba: flipRows(bytesFromThePage(base64), width, height),
  }));
}

/** The frames `measureEveryFrame` has kept since it last handed any over, measured. */
async function takeCanvasFrames(page: Page): Promise<CanvasFrame[]> {
  return (await takeCanvasPictures(page)).map(canvasFrameOf);
}

/**
 * Steps `frames` as `stepReading` does and returns his canvas in the last of them, dropping the
 * rest unread.
 */
async function stepToTheCanvas(page: Page, frames: number, reading: Reading | undefined): Promise<Pixels> {
  await stepReading(page, frames - 1, reading);
  await page.evaluate(() => {
    window.canvasFrames = [];
  });
  await stepReading(page, 1, reading);
  const last = (await takeCanvasPictures(page)).at(-1);
  if (last === undefined) {
    throw new Error('Nothing was drawn into his canvas in that frame');
  }
  return last;
}

/** How many pixels two pictures of one size differ at, in any channel. */
function differingPixels(first: Pixels, second: Pixels): number {
  expect([second.width, second.height]).toEqual([first.width, first.height]);
  let differing = 0;
  for (let index = 0; index < first.width * first.height; index++) {
    const offset = index * 4;
    const same =
      first.rgba[offset] === second.rgba[offset] &&
      first.rgba[offset + 1] === second.rgba[offset + 1] &&
      first.rgba[offset + 2] === second.rgba[offset + 2] &&
      first.rgba[offset + 3] === second.rgba[offset + 3];
    differing += same ? 0 : 1;
  }
  return differing;
}

/** GL's rows run from the bottom, a picture's from the top. */
function flipRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const flipped = new Uint8Array(rgba.length);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    flipped.set(rgba.subarray(row * rowBytes, (row + 1) * rowBytes), (height - 1 - row) * rowBytes);
  }
  return flipped;
}

/**
 * One frame of him, from his canvas. The canvas is premultiplied, with alpha its brightest channel
 * (`alphaFromLight`), so the brightest channel is the light.
 */
function canvasFrameOf({ width, height, rgba }: Pixels): CanvasFrame {
  const sphereRadius = SPHERE_AT_LARGEST * width;
  let lit = 0;
  let light = 0;
  let lightInside = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < width * height; index++) {
    const brightest = Math.max(rgba[index * 4] ?? 0, rgba[index * 4 + 1] ?? 0, rgba[index * 4 + 2] ?? 0);
    const x = (index % width) + 0.5 - width / 2;
    const y = Math.floor(index / width) + 0.5 - height / 2;
    lit += brightest > 0 ? 1 : 0;
    light += brightest;
    weightedX += brightest * x;
    weightedY += brightest * y;
    lightInside += Math.hypot(x, y) <= sphereRadius ? brightest : 0;
  }
  return {
    litShare: lit / (width * height),
    centreX: weightedX / Math.max(light, 1) / width,
    centreY: weightedY / Math.max(light, 1) / height,
    insideTheSphere: lightInside / Math.max(light, 1),
  };
}

/** A screenshot's pixels, decoded by the page, which has a decoder. */
async function pixelsOf(page: Page, screenshot: Buffer): Promise<Pixels> {
  const { width, height, base64 } = await page.evaluate(async (png) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('No 2D context to decode the screenshot with');
    }
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    const asDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(new Blob([data]));
    });
    return { width: image.width, height: image.height, base64: asDataUrl.slice(asDataUrl.indexOf(',') + 1) };
  }, screenshot.toString('base64'));
  return { width, height, rgba: bytesFromThePage(base64) };
}

/** A pixel's luma, 0–255. */
function lumaAt(rgba: Uint8Array, index: number): number {
  return 0.2126 * (rgba[index * 4] ?? 0) + 0.7152 * (rgba[index * 4 + 1] ?? 0) + 0.0722 * (rgba[index * 4 + 2] ?? 0);
}

/**
 * The share of a picture's light that falls inside the sphere at its largest, centred on a box in
 * it: the light being each pixel's luma above the box's corner, which is the page behind him.
 */
function shareInsideTheSphere({ width, rgba }: Pixels, box: Box): number {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const behind = lumaAt(rgba, Math.round(box.y) * width + Math.round(box.x));
  let light = 0;
  let inside = 0;
  for (let index = 0; index < rgba.length / 4; index++) {
    const above = Math.max(0, lumaAt(rgba, index) - behind);
    const distance = Math.hypot((index % width) + 0.5 - centreX, Math.floor(index / width) + 0.5 - centreY);
    light += above;
    inside += distance <= SPHERE_AT_LARGEST * box.width ? above : 0;
  }
  return inside / Math.max(light, 1);
}

/** Whether a pixel is inside a box. */
function isInside(x: number, y: number, box: Box): boolean {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

/** Measures a picture over a box in it, the whole of it when left out. */
function lookOf({ width, height, rgba }: Pixels, box: Box = { x: 0, y: 0, width, height }): Look {
  let lit = 0;
  let litOutside = 0;
  let luma = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < width * height; index++) {
    const x = index % width;
    const y = Math.floor(index / width);
    const pixelLuma = lumaAt(rgba, index);
    const isLit = pixelLuma > LIT_LUMA ? 1 : 0;
    if (!isInside(x, y, box)) {
      litOutside += isLit;
      continue;
    }
    lit += isLit;
    luma += pixelLuma;
    weightedX += pixelLuma * (x + 0.5 - box.x - box.width / 2);
    weightedY += pixelLuma * (y + 0.5 - box.y - box.height / 2);
  }
  return {
    litShare: lit / (box.width * box.height),
    litOutside,
    meanLuma: luma / (box.width * box.height),
    centreX: weightedX / Math.max(luma, 1) / box.width,
    centreY: weightedY / Math.max(luma, 1) / box.height,
  };
}

/**
 * Runs `take` with the elements of the given test ids hidden, putting them back afterwards. On a
 * stopped clock nothing is drawn in between, so what is taken this way and without is of one moment.
 */
async function withHidden<T>(page: Page, testIds: string[], take: () => Promise<T>): Promise<T> {
  const hide = (hidden: boolean) =>
    page.evaluate(
      ({ ids, hidden }) => {
        for (const id of ids) {
          const element = document.querySelector(`[data-testid="${id}"]`);
          if (element instanceof HTMLElement) {
            element.style.visibility = hidden ? 'hidden' : '';
          }
        }
      },
      { ids: testIds, hidden },
    );
  await hide(true);
  try {
    return await take();
  } finally {
    await hide(false);
  }
}

/** The hologram as it is on screen, his canvas over the page. */
async function lookAtHim(page: Page): Promise<Look> {
  return lookOf(await pixelsOf(page, await page.getByTestId('hologram').screenshot()));
}

/** His canvas, which a test finds by its id: there is one canvas, and it holds all of him. */
function hisCanvas(page: Page): Locator {
  return page.getByTestId('hologram-canvas').locator('canvas');
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test('draws all of him on the GPU where the browser has WebGL 2, centred in the sphere', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSampleModeOnAStoppedClock(page, '/');

  // One canvas, holding a WebGL 2 context: there is no second canvas for the rest of him.
  await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(1);
  const canvas = hisCanvas(page);
  await expect(canvas).toHaveCount(1);
  expect(
    await canvas.evaluate(
      (element) =>
        element instanceof HTMLCanvasElement && element.getContext('webgl2') instanceof WebGL2RenderingContext,
    ),
  ).toBe(true);

  await measureEveryFrame(canvas);
  await stepFrames(page, ARRIVED_FRAMES);
  await takeCanvasFrames(page);
  await stepFrames(page, 10);
  const frames = await takeCanvasFrames(page);

  // Every frame after the arrival draws him, from the GPU's own pixels: lit, centred in the canvas,
  // and the size of the sphere. Measured over these frames when he was redrawn after the Vision Quest
  // footage: 56–75% of the canvas lit, the light's centre at most 1.5% of the side from the middle —
  // a little up and to the left, where his core sits — and 81% to 94% of the light inside the sphere
  // at its largest, the rest the cage, the aura and the embers round him and the chips he throws past
  // the limb while he speaks. The worst frame is close to the 0.8 held here: light moving out past
  // the sphere is a change to how he looks, to be looked at rather than allowed for by lowering it.
  // Drawn off-centre or at the wrong scale (`FlatScreen` given the wrong square), he is neither.
  expect(frames).toHaveLength(10);
  for (const frame of frames) {
    expect(frame.litShare).toBeGreaterThan(0.05);
    expect(Math.abs(frame.centreX)).toBeLessThan(0.05);
    expect(Math.abs(frame.centreY)).toBeLessThan(0.05);
    expect(frame.insideTheSphere).toBeGreaterThan(0.8);
  }

  // And on the page his light lands inside the hologram's square and nowhere else: the canvas is
  // laid out over his square, not over the screen.
  const square = await page.getByTestId('hologram').boundingBox();
  if (square === null) {
    throw new Error('The hologram has no box on the page');
  }
  const onThePage = await withHidden(page, ['frame-rate'], async () => pixelsOf(page, await page.screenshot()));
  const inTheSquare = lookOf(onThePage, square);
  expect(inTheSquare.litShare).toBeGreaterThan(0.02);
  expect(inTheSquare.litOutside).toBe(0);
  // And where the sphere is in that square, not only somewhere in it: 96% of the light the screen
  // shows was, at this moment, when he was redrawn after the Vision Quest footage.
  expect(shareInsideTheSphere(onThePage, square)).toBeGreaterThan(0.85);

  expect(pageErrors).toEqual([]);
});

/**
 * Two ways a browser leaves him without WebGL 2: one that has none at all — no
 * `WebGL2RenderingContext`, and no context for asking — where the view never makes a GL view; and
 * one that has the API but will not give his canvas a context, where expo-gl quietly hands over a
 * WebGL 1 context instead and the view has to turn it down and take the GL view away.
 */
const BROWSERS_WITHOUT_WEBGL_2 = [
  {
    name: 'a browser without WebGL 2',
    takeAway: () => {
      Reflect.deleteProperty(window, 'WebGL2RenderingContext');
      const getContext = HTMLCanvasElement.prototype.getContext;
      Reflect.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          return kind === 'webgl2' ? null : Reflect.apply(getContext, this, [kind, ...rest]);
        },
      });
    },
  },
  {
    name: 'a browser that refuses his canvas WebGL 2',
    takeAway: () => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      Reflect.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          const isHisCanvas = this.closest('[data-testid="hologram-canvas"]') !== null;
          return kind === 'webgl2' && isHisCanvas ? null : Reflect.apply(getContext, this, [kind, ...rest]);
        },
      });
    },
  },
];

for (const withoutWebGl2 of BROWSERS_WITHOUT_WEBGL_2) {
  test(`gives up his GL view from the start, and keeps going without him, in ${withoutWebGl2.name}`, async ({
    page,
  }) => {
    await page.addInitScript(withoutWebGl2.takeAway);
    const pageErrors = collectPageErrors(page);
    await openSampleModeOnAStoppedClock(page, '/');

    // No GL view, before a GPU that never came would have stopped holding him: with nothing to wait
    // for, nothing is pending, and nothing of him is drawn.
    await stepFrames(page, BEFORE_THE_TIMEOUT_FRAMES);
    await expect(page.getByTestId('hologram-canvas')).toHaveCount(0);
    await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(0);
    expect((await withHidden(page, ['frame-rate'], () => lookAtHim(page))).litShare).toBe(0);

    // And the screen goes on with nothing broken: his clock runs, the density loop with it, and
    // there is no error.
    await stepFrames(page, SHED_FRAMES);
    await expect(page.getByTestId('frame-rate')).toHaveText(new RegExp(`${FLOOR_SPARKS}$`));
    expect(pageErrors).toEqual([]);
  });
}

test('takes him away while the GPU’s context is lost, and draws him again once it is restored', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSampleModeOnAStoppedClock(page, '/');
  await stepFrames(page, SHED_FRAMES);
  await expect(page.getByTestId('frame-rate')).toHaveText(new RegExp(`${FLOOR_SPARKS}$`));

  // What he lights, at the floor.
  const drawn = await withHidden(page, ['frame-rate'], () => lookAtHim(page));
  expect(drawn.litShare).toBeGreaterThan(0.02);

  const lost = await hisCanvas(page).evaluate((element) => {
    const gl = element instanceof HTMLCanvasElement ? element.getContext('webgl2') : null;
    const extension = gl?.getExtension('WEBGL_lose_context') ?? undefined;
    extension?.loseContext();
    // Kept, since a context that has gone hands out no extensions: it is what gives it back.
    window.canvasContextLoss = extension;
    return extension !== undefined;
  });
  expect(lost).toBe(true);

  // A few frames later nothing of him is on screen, where a view still showing the canvas would
  // show its last frame or the browser's placeholder.
  await stepFrames(page, 3);
  const gone = await withHidden(page, ['frame-rate'], () => lookAtHim(page));
  expect(gone.litShare).toBeLessThan(drawn.litShare / 20);

  // Laid out again — a window resized, a phone turned — and still nothing: a browser paints a
  // canvas whose context has gone as a placeholder of its own, a white square, which would be all
  // there was to see.
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('The page has no viewport');
  }
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 40 });
  await stepFrames(page, 2);
  const laidOutAgain = await withHidden(page, ['frame-rate'], () => lookAtHim(page));
  expect(laidOutAgain.litShare).toBeLessThan(drawn.litShare / 20);

  // The browser hands the context back, expo-gl hands it to the view again, and he is set up in it
  // afresh and drawn from the next frame on.
  await page.evaluate(() => window.canvasContextLoss?.restoreContext());
  await expect
    .poll(async () => {
      await stepFrames(page, 1);
      return (await withHidden(page, ['frame-rate'], () => lookAtHim(page))).litShare;
    })
    .toBeGreaterThan(drawn.litShare / 2);
  expect(pageErrors).toEqual([]);
});

/**
 * Makes his canvas's context look lost to every frame, while leaving it to be made and him set up
 * in it: the frame callback's first look at it (`finishPreviousFrame`) finds it gone. That is the
 * browser's version of the case a device cannot be made to show here — expo-gl's lookup on the UI
 * runtime coming back empty, or its first `flushEXP` failing — where nothing takes the GL view away
 * and only `GPU_READY_TIMEOUT_MS` lets his clock go.
 */
function loseHisContextToEveryFrame() {
  const isContextLost = WebGL2RenderingContext.prototype.isContextLost;
  Reflect.defineProperty(WebGL2RenderingContext.prototype, 'isContextLost', {
    value(this: WebGL2RenderingContext) {
      const canvas = this.canvas;
      const isHisCanvas =
        canvas instanceof HTMLCanvasElement && canvas.closest('[data-testid="hologram-canvas"]') !== null;
      return isHisCanvas || Reflect.apply(isContextLost, this, []);
    },
  });
}

test('lets his clock go once a GPU that never comes has kept him waiting long enough', async ({ page }) => {
  await page.addInitScript(loseHisContextToEveryFrame);
  const pageErrors = collectPageErrors(page);
  await openSampleModeOnAStoppedClock(page, '/');

  // Held at the start of his arrival, where nothing of him shows, with the GL view still there:
  // waiting, which a GPU given up at once would not be. His clock is held with him, so the density
  // loop has measured nothing and the readout has not moved off where it starts.
  await stepFrames(page, BEFORE_THE_TIMEOUT_FRAMES);
  await expect(page.getByTestId('hologram-canvas')).toHaveCount(1);
  await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(1);
  expect((await withHidden(page, ['frame-rate'], () => lookAtHim(page))).litShare).toBe(0);
  await expect(page.getByTestId('frame-rate')).not.toHaveText(new RegExp(`${FLOOR_SPARKS}$`));

  // Then the wait runs out and his clock goes, with the density loop behind it, and still nothing
  // is drawn into the canvas.
  await stepFrames(page, SHED_FRAMES);
  await expect(page.getByTestId('frame-rate')).toHaveText(new RegExp(`${FLOOR_SPARKS}$`));
  expect((await withHidden(page, ['frame-rate'], () => lookAtHim(page))).litShare).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('turns him as the phone tilts, from the phone’s eye, and back to the front once it is held still', async ({
  page,
  browser,
}) => {
  // Three phones stepped alike from the same moment of him, before any step: one whose sensor never
  // reads, one held upright throughout, and one held upright and then tipped.
  const unread = page;
  const still = await anotherPageLike(browser, page);
  const tipped = await anotherPageLike(browser, page);
  const pageErrors = [unread, still, tipped].map(collectPageErrors);
  for (const phone of [unread, still, tipped]) {
    await phone.addInitScript(installAGravitySensor);
    await openSampleModeOnAStoppedClock(phone, '/');
    await measureEveryFrame(hisCanvas(phone));
  }

  // Readings arriving bring the eye in from infinitely far, straight on as a flat projection, to
  // the phone's: the same moment drawn differently. And two phones handed the same readings draw the
  // same picture to the byte, which is what lets the two after this be compared at all.
  const neverRead = await stepToTheCanvas(unread, ARRIVED_FRAMES, undefined);
  const heldStill = await stepToTheCanvas(still, ARRIVED_FRAMES, UPRIGHT);
  const notYetTipped = await stepToTheCanvas(tipped, ARRIVED_FRAMES, UPRIGHT);
  const canvasPixels = heldStill.width * heldStill.height;
  expect(differingPixels(heldStill, neverRead)).toBeGreaterThan(canvasPixels * MOVED_EYE_SHARE);
  expect(differingPixels(heldStill, notYetTipped)).toBe(0);

  // Tipped 15° top edge away, he turns within half a second.
  const stillThen = await stepToTheCanvas(still, 5, UPRIGHT);
  const tippedThen = await stepToTheCanvas(tipped, 5, tippedAway(15));
  const turned = differingPixels(stillThen, tippedThen);
  expect(turned).toBeGreaterThan(canvasPixels * MOVED_EYE_SHARE);

  // Held there, he comes back to the front as the rest pose follows the phone: a phone held still,
  // however it is held, shows him straight on. Measured at no pixel apart; a hundredth of the turn
  // allows for the last of the ease, and is far below a view still turned by any of it.
  const stillLater = await stepToTheCanvas(still, SETTLED_FRAMES, UPRIGHT);
  const tippedLater = await stepToTheCanvas(tipped, SETTLED_FRAMES, tippedAway(15));
  expect(differingPixels(stillLater, tippedLater)).toBeLessThan(turned / 100);

  await still.context().close();
  await tipped.context().close();
  for (const errors of pageErrors) {
    expect(errors).toEqual([]);
  }
});

test('arrives straight on after the app was away, however the phone was turned meanwhile', async ({
  page,
  browser,
}) => {
  // Two phones held upright through his arrival; then the app goes away and comes back, one phone
  // still upright and the other lying back, as from a pocket to a hand.
  const still = page;
  const moved = await anotherPageLike(browser, page);
  const pageErrors = [still, moved].map(collectPageErrors);
  for (const phone of [still, moved]) {
    await phone.addInitScript(installAGravitySensor);
    await openSampleModeOnAStoppedClock(phone, '/');
    await measureEveryFrame(hisCanvas(phone));
    await stepReading(phone, ARRIVED_FRAMES, UPRIGHT);
    await bringToTheFront(phone, false);
    await bringToTheFront(phone, true);
    // A phone's sensor answers an interval after it starts, not at once.
    await stepReading(phone, 2, undefined);
  }

  // The first reading after he comes back is the rest pose, so both show him straight on, to the
  // byte. One kept from before the app went away would be the rest pose instead, and the phone that
  // moved would show him turned as far as the tilt goes.
  const heldStill = await stepToTheCanvas(still, ARRIVED_FRAMES, UPRIGHT);
  const lyingBack = await stepToTheCanvas(moved, ARRIVED_FRAMES, tippedAway(60));
  expect(differingPixels(heldStill, lyingBack)).toBe(0);

  await moved.context().close();
  for (const errors of pageErrors) {
    expect(errors).toEqual([]);
  }
});
