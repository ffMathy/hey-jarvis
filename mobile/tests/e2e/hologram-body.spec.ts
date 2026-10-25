import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { blockExternalRequests } from './external-requests';

/**
 * Jarvis's body on the GPU, in the phone's web build: his body is drawn by `hologram/gpu` on a
 * canvas of its own (`hologram-body`), Screened onto Skia's picture of the rest of him
 * (`hologram-picture`). Where the browser cannot draw it, there is no body and the rest of him is
 * drawn all the same. See "His body on the GPU, on a phone and a watch" in `.claude/rules/hologram.md`.
 *
 * **Every test here runs on a stopped clock.** Playwright's fake clock replaces the page's
 * `requestAnimationFrame`, timers, `Date` and `performance`, and the page is stopped before sample
 * mode opens, so every frame he is drawn in is one this file steps. That is what makes the pictures
 * comparable at all. On the real clock the frame rate is whatever the machine running the tests
 * manages and the density loop steers the share of particles by it, so two pictures would be of
 * different moments with different particles in them. Stepped, both are of the same moment, with
 * the same particles, every time.
 *
 * The numbers below that are the hologram's own are written out rather than imported: its main
 * entry takes Skia's enums from a module Node cannot load, and this runs under Node. Each says which
 * constant it is, and a change to one shows up here as a failure rather than as a quiet mismatch.
 *
 * What these cannot see is a device: expo-gl's native view, Android composing it, and a phone's own
 * gravity sensor. The browser's GLView is a `<canvas>` with a WebGL 2 context drawn from the page's
 * thread, and the tilt is fed by a stand-in for the browser's sensor (`installAGravitySensor`).
 */

declare global {
  interface Window {
    /** The GPU body's canvas at the end of each frame it drew, kept by `measureEveryBodyFrame`. */
    bodyFrames?: Array<{ width: number; height: number; pixels: Uint8Array<ArrayBuffer> }>;
    /** Hands every started gravity sensor a reading at once: see `installAGravitySensor`. */
    tiltTo?: (x: number, y: number, z: number) => void;
    /** How many gravity sensors are started: one while the tilt is listening, none otherwise. */
    startedGravitySensors?: () => number;
    /** What lost the GPU body's context, kept to give it back with. */
    bodyContextLoss?: WEBGL_lose_context;
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

/** What one frame of the GPU body put on its canvas, measured from its own pixels. */
interface BodyFrame {
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
 * The least share of the GPU body's canvas that comes out differently when the eye moves: as it
 * comes in from infinitely far to the phone's, measured at 36%, and as a 15° tip turns him, at 31%.
 * A tenth is far below either and far above the nothing a view that never moved would differ by.
 */
const MOVED_EYE_SHARE = 0.1;

/** What the readout calls the floor: `FEWEST_PARTICLES` of `PARTICLE_COUNT`, 2.5% of 10,000. */
const FLOOR_SPARKS = '250 sparks';

/**
 * The last frame before a body that is never ready would stop holding his arrival
 * (`BODY_READY_TIMEOUT_MS`, 800 ms), with a frame to spare: drawn by then, he was not kept waiting.
 */
const BEFORE_THE_TIMEOUT_FRAMES = 6;

/**
 * The sphere at its largest, as a radius in sides of the drawing's square: `SPHERE_FRACTION` (0.27)
 * swollen as far as his voice swells him (`SWELL_WITH_VOICE`, 18%). The body is the fragments
 * inside it. What lies beyond is the stream flowing out of it, which in the frames measured here
 * carried at most six percent of the body's light.
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

/** How many steps the lazily loaded view may take to mount: React reveals it after a timer of its own. */
const MOUNT_STEPS_AT_MOST = 10;

/** The view's chunk, which the browser build imports only once CanvasKit has loaded. */
const HOLOGRAM_VIEW_CHUNK = /\/hologram-view-[0-9a-f]+\.js$/;

/** Keeps every error the page throws, for a test to say there were none. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * Opens sample mode on a stopped clock and steps it until the hologram has mounted, returning how
 * many steps that took.
 *
 * The clock runs while the page loads, so nothing in the app waits on a timer that never fires,
 * and stops on the tour. Opening sample mode then fetches CanvasKit and the view's chunk, which
 * are not timers and arrive on their own; React reveals the view a fixed time after its
 * placeholder (Suspense's own throttle), and that timer is the page's, so once the chunk is in
 * the view mounts on the same step every time, and his clock starts on the next.
 */
async function openSampleModeOnAStoppedClock(page: Page, path: string): Promise<number> {
  await page.clock.install();
  await page.goto(path);
  await expect(page.getByTestId('try-sample')).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + FRAME_MS);

  const viewChunk = page.waitForResponse(HOLOGRAM_VIEW_CHUNK);
  await page.getByTestId('try-sample').click();
  await (await viewChunk).finished();

  let steps = 0;
  while ((await page.getByTestId('hologram-picture').count()) === 0) {
    expect(steps, 'the hologram view never mounted').toBeLessThan(MOUNT_STEPS_AT_MOST);
    await page.clock.fastForward(FRAME_MS);
    steps++;
  }
  return steps;
}

/** Steps the stopped clock one frame at a time: each step runs exactly one animation frame. */
async function stepFrames(page: Page, frames: number): Promise<void> {
  for (let frame = 0; frame < frames; frame++) {
    await page.clock.fastForward(FRAME_MS);
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
    await page.clock.fastForward(FRAME_MS);
  }
}

/**
 * Sends the page to the background or brings it back, as far as the app can tell — which is what
 * the phone's app sees between summonings — and waits for the tilt's sensor to stop or start with it.
 */
async function bringToTheFront(page: Page, front: boolean): Promise<void> {
  await page.evaluate((visible) => {
    Reflect.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, front);
  await expect.poll(() => page.evaluate(() => window.startedGravitySensors?.())).toBe(front ? 1 : 0);
}

/** Another page in a context of its own, the size of `like`, opened as `like` was. */
async function anotherPageLike(browser: Browser, like: Page): Promise<Page> {
  const context = await browser.newContext({ viewport: like.viewportSize() });
  const page = await context.newPage();
  await blockExternalRequests(page);
  return page;
}

/**
 * Keeps the GPU body's canvas at the end of every frame it draws, from now on, in
 * `window.bodyFrames`.
 *
 * Read inside the frame because nothing else can read it: the canvas keeps no drawing buffer
 * between frames (`preserveDrawingBuffer` is off, as on a device). expo-gl's browser context has an
 * `endFrameEXP` of its own, which the view calls straight after drawing, so that is where this
 * reads the pixels before handing on.
 */
async function measureEveryBodyFrame(body: Locator): Promise<void> {
  await body.evaluate((canvas) => {
    const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext('webgl2') : null;
    const present: unknown = gl === null ? undefined : Reflect.get(gl, 'endFrameEXP');
    if (gl === null || typeof present !== 'function') {
      throw new Error('The GPU body has no WebGL 2 context of expo-gl’s');
    }
    window.bodyFrames = [];
    Reflect.set(gl, 'endFrameEXP', () => {
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      window.bodyFrames?.push({ width, height, pixels });
      Reflect.apply(present, gl, []);
    });
  });
}

/** The colour space a canvas's WebGL 2 drawing buffer is read in, from the context it already has. */
function colourSpaceOf(canvas: Locator): Promise<string | undefined> {
  return canvas.evaluate((element) =>
    element instanceof HTMLCanvasElement ? element.getContext('webgl2')?.drawingBufferColorSpace : undefined,
  );
}

/** Bytes from the page, which hands them over as base64 rather than as a list of numbers. */
function bytesFromThePage(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** The frames `measureEveryBodyFrame` has kept since it last handed any over, as pictures. */
async function takeBodyPictures(page: Page): Promise<Pixels[]> {
  const frames = await page.evaluate(async () => {
    const kept = window.bodyFrames ?? [];
    window.bodyFrames = [];
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

/** The frames `measureEveryBodyFrame` has kept since it last handed any over, measured. */
async function takeBodyFrames(page: Page): Promise<BodyFrame[]> {
  return (await takeBodyPictures(page)).map(bodyFrameOf);
}

/**
 * Steps `frames` as `stepReading` does and returns the GPU body's picture in the last of them,
 * dropping the rest unread.
 */
async function stepToTheBody(page: Page, frames: number, reading: Reading | undefined): Promise<Pixels> {
  await stepReading(page, frames - 1, reading);
  await page.evaluate(() => {
    window.bodyFrames = [];
  });
  await stepReading(page, 1, reading);
  const last = (await takeBodyPictures(page)).at(-1);
  if (last === undefined) {
    throw new Error('The GPU body drew nothing in that frame');
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
 * One frame of the GPU body, from its canvas. The canvas is premultiplied, with alpha its brightest
 * channel (`alphaFromLight`), so the brightest channel is the light.
 */
function bodyFrameOf({ width, height, rgba }: Pixels): BodyFrame {
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

/**
 * Screens two channel values over the page behind them: each is taken as light added to that dark
 * background, and the background is counted once.
 */
function screened(first: number, second: number, behind: number): number {
  const firstLight = Math.max(0, first - behind);
  const secondLight = Math.max(0, second - behind);
  return behind + firstLight + secondLight - (firstLight * secondLight) / 255;
}

/**
 * The most any channel of the composed picture is from Skia's picture and the GPU body's Screened
 * together, each taken with the other's canvas hidden: three pictures of one moment.
 */
function largestScreenError(composed: Pixels, skiaAlone: Pixels, bodyAlone: Pixels): number {
  let largest = 0;
  for (let index = 0; index < composed.rgba.length; index++) {
    if (index % 4 === 3) {
      continue;
    }
    // The first pixel is the corner of the square, which is the page behind him.
    const behind = composed.rgba[index % 4] ?? 0;
    const expected = screened(skiaAlone.rgba[index] ?? 0, bodyAlone.rgba[index] ?? 0, behind);
    largest = Math.max(largest, Math.abs((composed.rgba[index] ?? 0) - expected));
  }
  return largest;
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

/** The hologram as it is on screen: his body, the rest of him and the background, composed. */
async function lookAtHim(page: Page): Promise<Look> {
  return lookOf(await pixelsOf(page, await page.getByTestId('hologram').screenshot()));
}

/** Skia's picture alone, at the same moment: the hologram with the GPU body's canvas hidden. */
async function lookAtSkiaAlone(page: Page): Promise<Look> {
  return withHidden(page, ['hologram-body'], () => lookAtHim(page));
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test('draws his body on the GPU where the browser has WebGL 2, centred in the sphere', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSampleModeOnAStoppedClock(page, '/');

  // Two canvases: Skia's, and the GPU body's laid over it, which holds a WebGL 2 context.
  await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(2);
  const body = page.getByTestId('hologram-body').locator('canvas');
  await expect(body).toHaveCount(1);
  expect(
    await body.evaluate(
      (canvas) => canvas instanceof HTMLCanvasElement && canvas.getContext('webgl2') instanceof WebGL2RenderingContext,
    ),
  ).toBe(true);

  await measureEveryBodyFrame(body);
  await stepFrames(page, ARRIVED_FRAMES);
  await takeBodyFrames(page);
  await stepFrames(page, 10);
  const frames = await takeBodyFrames(page);

  // Every frame after the arrival draws a body, from the GPU's own pixels: lit, where Skia's sphere
  // is, and the size of it. The share lit fell from 37% to 19% over these frames as the loop shed
  // particles, the light's centre wandered at most 2.3% of the side as the stream flowed out on one
  // side and then another, and at least 94% of the light was inside the sphere at its largest.
  // Drawn off-centre or at the wrong scale (`FlatScreen` given the wrong square), it is neither.
  expect(frames).toHaveLength(10);
  for (const frame of frames) {
    expect(frame.litShare).toBeGreaterThan(0.05);
    expect(Math.abs(frame.centreX)).toBeLessThan(0.05);
    expect(Math.abs(frame.centreY)).toBeLessThan(0.05);
    expect(frame.insideTheSphere).toBeGreaterThan(0.85);
  }

  // And on the page his body's light lands inside the hologram's square and nowhere else: the
  // canvas is laid out over Skia's, not over the screen.
  const square = await page.getByTestId('hologram').boundingBox();
  if (square === null) {
    throw new Error('The hologram has no box on the page');
  }
  const bodyOnThePage = await withHidden(page, ['hologram-picture', 'frame-rate'], async () =>
    pixelsOf(page, await page.screenshot()),
  );
  const bodyInTheSquare = lookOf(bodyOnThePage, square);
  expect(bodyInTheSquare.litShare).toBeGreaterThan(0.02);
  expect(bodyInTheSquare.litOutside).toBe(0);
  // And where the sphere is in that square, not only somewhere in it: all of its light was, at this
  // moment, against 76% for a canvas laid out half again too large and 8% for one laid out to the side.
  expect(shareInsideTheSphere(bodyOnThePage, square)).toBeGreaterThan(0.85);

  // Screened onto Skia's picture, light added to light: the page shows, pixel by pixel, what Screening
  // the two pictures together gives, each taken with the other's canvas hidden. Measured at most 8
  // levels off, from counting the page's own dark background into each picture; laid over Skia's
  // picture instead of Screened onto it, the body put pixels 58 levels off.
  const hologram = page.getByTestId('hologram');
  const composed = await pixelsOf(page, await hologram.screenshot());
  const skiaAlone = await withHidden(page, ['hologram-body'], async () => pixelsOf(page, await hologram.screenshot()));
  const bodyAlone = await withHidden(page, ['hologram-picture'], async () =>
    pixelsOf(page, await hologram.screenshot()),
  );
  expect(largestScreenError(composed, skiaAlone, bodyAlone)).toBeLessThan(16);

  // Its canvas is read in the colour space Skia's is, which React Native Skia tags Display P3, so
  // one paint is one colour across the two wherever the browser manages colour. Chromium here does
  // not, so the pictures above look the same either way, and only the tag can say.
  const skiasCanvas = page.getByTestId('hologram-picture').locator('canvas');
  expect(await colourSpaceOf(skiasCanvas)).toBe('display-p3');
  expect(await colourSpaceOf(body)).toBe('display-p3');

  expect(pageErrors).toEqual([]);
});

/**
 * Two ways a browser leaves him without WebGL 2 for his body: one that has none at all — no
 * `WebGL2RenderingContext`, and no context for asking — where the view never makes a GL view; and
 * one that has the API but will not give the body's canvas a context, where expo-gl quietly hands
 * over a WebGL 1 context instead and the view has to turn it down and take the GL view away. Only the
 * body's canvas is refused there, because CanvasKit cannot do without WebGL 2 where the API exists
 * either, and that is CanvasKit's to fail, not this.
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
    name: 'a browser that refuses the body’s canvas WebGL 2',
    takeAway: () => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      Reflect.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          const isTheBody = this.closest('[data-testid="hologram-body"]') !== null;
          return kind === 'webgl2' && isTheBody ? null : Reflect.apply(getContext, this, [kind, ...rest]);
        },
      });
    },
  },
];

for (const withoutWebGl2 of BROWSERS_WITHOUT_WEBGL_2) {
  test(`draws the rest of him without a body, from the start, in ${withoutWebGl2.name}`, async ({ page }) => {
    await page.addInitScript(withoutWebGl2.takeAway);
    const pageErrors = collectPageErrors(page);
    await openSampleModeOnAStoppedClock(page, '/');

    // He is arriving already, before a body that never came would have stopped holding him: with no
    // GL view to wait for, nothing held him back at the start of the arrival.
    await stepFrames(page, BEFORE_THE_TIMEOUT_FRAMES);
    await expect(page.getByTestId('hologram-body')).toHaveCount(0);
    await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(1);
    const arriving = await withHidden(page, ['frame-rate'], () => lookAtHim(page));
    expect(arriving.litShare).toBeGreaterThan(0.01);

    // And goes on moving, with nothing broken: his clock runs, the density loop with it, and there
    // is no error.
    await stepFrames(page, SHED_FRAMES);
    const arrived = await withHidden(page, ['frame-rate'], () => lookAtHim(page));
    expect(arrived.litShare).toBeGreaterThan(0.03);
    expect(arrived.meanLuma).not.toBe(arriving.meanLuma);
    await expect(page.getByTestId('frame-rate')).toHaveText(new RegExp(`${FLOOR_SPARKS}$`));
    expect(pageErrors).toEqual([]);
  });
}

test('takes his body away while the GPU’s context is lost, and draws it again once it is restored', async ({
  page,
}) => {
  const pageErrors = collectPageErrors(page);
  await openSampleModeOnAStoppedClock(page, '/');
  await stepFrames(page, SHED_FRAMES);
  await expect(page.getByTestId('frame-rate')).toHaveText(new RegExp(`${FLOOR_SPARKS}$`));

  // What his body adds to the picture, at the floor.
  const withTheGpuBody = await lookAtHim(page);
  const withoutABody = await lookAtSkiaAlone(page);
  const bodyLit = withTheGpuBody.litShare - withoutABody.litShare;
  expect(bodyLit).toBeGreaterThan(0.02);

  const canvas = page.getByTestId('hologram-body').locator('canvas');
  const lost = await canvas.evaluate((element) => {
    const gl = element instanceof HTMLCanvasElement ? element.getContext('webgl2') : null;
    const extension = gl?.getExtension('WEBGL_lose_context') ?? undefined;
    extension?.loseContext();
    // Kept, since a context that has gone hands out no extensions: it is what gives it back.
    window.bodyContextLoss = extension;
    return extension !== undefined;
  });
  expect(lost).toBe(true);

  // A few frames later there is no body on screen, and the rest of him goes on: what is lit is what
  // Skia's picture lights, to within a few hundredths of what the body added, where a view still
  // showing the canvas would show its last frame or the browser's placeholder.
  await stepFrames(page, 3);
  const bodiless = await lookAtHim(page);
  expect(Math.abs(bodiless.litShare - withoutABody.litShare)).toBeLessThan(bodyLit / 4);

  // Laid out again — a window resized, a phone turned — and still him: a browser paints a canvas
  // whose context has gone as a placeholder of its own, a white square, which Screened over him
  // would be all there was to see.
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('The page has no viewport');
  }
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 40 });
  await stepFrames(page, 2);
  const laidOutAgain = await lookAtHim(page);
  expect(laidOutAgain.litShare).toBeLessThan(bodiless.litShare * 1.5);
  expect(laidOutAgain.litShare).toBeGreaterThan(bodiless.litShare / 1.5);

  // The browser hands the context back, expo-gl hands it to the view again, and the body is set up
  // in it afresh and drawn from the next frame on.
  await page.evaluate(() => window.bodyContextLoss?.restoreContext());
  await expect
    .poll(async () => {
      await stepFrames(page, 1);
      return (await lookAtHim(page)).litShare - (await lookAtSkiaAlone(page)).litShare;
    })
    .toBeGreaterThan(bodyLit / 2);
  expect(pageErrors).toEqual([]);
});

/**
 * Makes the GPU body's context look lost to every frame, while leaving it to be made and the body
 * built in it: the frame callback's first look at it (`finishPreviousFrame`) finds it gone. That is
 * the browser's version of the case a device cannot be made to show here — expo-gl's lookup on the
 * UI runtime coming back empty, or its first `flushEXP` failing — where nothing takes the GL view
 * away and only `BODY_READY_TIMEOUT_MS` lets his clock go.
 */
function loseTheBodysContextToEveryFrame() {
  const isContextLost = WebGL2RenderingContext.prototype.isContextLost;
  Reflect.defineProperty(WebGL2RenderingContext.prototype, 'isContextLost', {
    value(this: WebGL2RenderingContext) {
      const canvas = this.canvas;
      const isTheBody = canvas instanceof HTMLCanvasElement && canvas.closest('[data-testid="hologram-body"]') !== null;
      return isTheBody || Reflect.apply(isContextLost, this, []);
    },
  });
}

test('arrives without a body once a body that never comes has kept him waiting long enough', async ({ page }) => {
  await page.addInitScript(loseTheBodysContextToEveryFrame);
  const pageErrors = collectPageErrors(page);
  await openSampleModeOnAStoppedClock(page, '/');

  // Held at the start of his arrival, where nothing of him shows (measured at no pixel lit), with
  // the GL view still there: waiting, which a GPU body given up at once would not be.
  await stepFrames(page, BEFORE_THE_TIMEOUT_FRAMES);
  await expect(page.getByTestId('hologram-body')).toHaveCount(1);
  await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(2);
  expect((await withHidden(page, ['frame-rate'], () => lookAtHim(page))).litShare).toBeLessThan(0.005);

  // Then the wait runs out, and the rest of him arrives, with his clock running and nothing drawn
  // on the body's canvas.
  await stepFrames(page, ARRIVED_FRAMES + 4);
  const arrived = await withHidden(page, ['frame-rate'], () => lookAtHim(page));
  expect(arrived.litShare).toBeGreaterThan(0.03);
  const skiaAlone = await withHidden(page, ['frame-rate', 'hologram-body'], () => lookAtHim(page));
  expect(arrived.litShare).toBe(skiaAlone.litShare);
  await stepFrames(page, 2);
  expect((await withHidden(page, ['frame-rate'], () => lookAtHim(page))).meanLuma).not.toBe(arrived.meanLuma);
  expect(pageErrors).toEqual([]);
});

test('turns his body as the phone tilts, from the phone’s eye, and back to the front once it is held still', async ({
  page,
  browser,
}) => {
  // Three phones stepped alike: one whose sensor never reads, one held upright throughout, and one
  // held upright and then tipped.
  const unread = page;
  const still = await anotherPageLike(browser, page);
  const tipped = await anotherPageLike(browser, page);
  const pageErrors = [unread, still, tipped].map(collectPageErrors);
  const mountedAfter: number[] = [];
  for (const phone of [unread, still, tipped]) {
    await phone.addInitScript(installAGravitySensor);
    mountedAfter.push(await openSampleModeOnAStoppedClock(phone, '/'));
    await measureEveryBodyFrame(phone.getByTestId('hologram-body').locator('canvas'));
  }
  expect(new Set(mountedAfter).size).toBe(1);

  // Readings arriving bring the eye in from infinitely far, straight on as a flat projection, to
  // the phone's: the same moment drawn differently. And two phones handed the same readings draw the
  // same picture to the byte, which is what lets the two after this be compared at all.
  const neverRead = await stepToTheBody(unread, ARRIVED_FRAMES, undefined);
  const heldStill = await stepToTheBody(still, ARRIVED_FRAMES, UPRIGHT);
  const notYetTipped = await stepToTheBody(tipped, ARRIVED_FRAMES, UPRIGHT);
  const canvasPixels = heldStill.width * heldStill.height;
  expect(differingPixels(heldStill, neverRead)).toBeGreaterThan(canvasPixels * MOVED_EYE_SHARE);
  expect(differingPixels(heldStill, notYetTipped)).toBe(0);

  // Tipped 15° top edge away, he turns within half a second.
  const stillThen = await stepToTheBody(still, 5, UPRIGHT);
  const tippedThen = await stepToTheBody(tipped, 5, tippedAway(15));
  const turned = differingPixels(stillThen, tippedThen);
  expect(turned).toBeGreaterThan(canvasPixels * MOVED_EYE_SHARE);

  // Held there, he comes back to the front as the rest pose follows the phone: a phone held still,
  // however it is held, shows him straight on. Measured at no pixel apart; a hundredth of the turn
  // allows for the last of the ease, and is far below a view still turned by any of it.
  const stillLater = await stepToTheBody(still, SETTLED_FRAMES, UPRIGHT);
  const tippedLater = await stepToTheBody(tipped, SETTLED_FRAMES, tippedAway(15));
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
    await measureEveryBodyFrame(phone.getByTestId('hologram-body').locator('canvas'));
    await stepReading(phone, ARRIVED_FRAMES, UPRIGHT);
    await bringToTheFront(phone, false);
    await bringToTheFront(phone, true);
    // A phone's sensor answers an interval after it starts, not at once.
    await stepReading(phone, 2, undefined);
  }

  // The first reading after he comes back is the rest pose, so both show him straight on, to the
  // byte. One kept from before the app went away would be the rest pose instead, and the phone that
  // moved would show him turned as far as the tilt goes: a fifth of the canvas apart, measured.
  const heldStill = await stepToTheBody(still, ARRIVED_FRAMES, UPRIGHT);
  const lyingBack = await stepToTheBody(moved, ARRIVED_FRAMES, tippedAway(60));
  expect(differingPixels(heldStill, lyingBack)).toBe(0);

  await moved.context().close();
  for (const errors of pageErrors) {
    expect(errors).toEqual([]);
  }
});
