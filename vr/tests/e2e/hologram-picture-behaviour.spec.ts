import type { Page } from '@playwright/test';
import type { PictureFacts, PictureFrame, PictureMoment, PictureOrbit } from '../../src/preview/preview-hook';
import { test as appTest, expect, keepOffline } from './fixtures';

/**
 * The hologram's picture of everything but his body, drawn for real on the GPU.
 *
 * `hologram/gpu`'s `drawGpuPicture` — the picture every device draws, the headset into a target of
 * three's (`hologram3d/picture-target.ts`), a phone and a watch onto their canvases — drawn by the
 * preview page in Chromium, so these tests look at actual pixels rather than at which functions were
 * called. They cannot say whether it is beautiful; they can say it moves, that it answers Jarvis's
 * voice the way the film's sphere does — with activity, never with a brightness pulse — that it
 * spirals out of its core without a flash, that nothing pops in or out as its slow script moves on,
 * that it stays inside its square, and that his satellites are drawn where their orbits say.
 *
 * These were `hologram`'s own tests, against Skia's picture under CanvasKit; there is no GPU under
 * `bun test`, so they moved here with the picture, with their thresholds as they were.
 *
 * **What is measured is what a view shows.** The picture is always drawn unfaded, premultiplied
 * light over transparent black; whoever shows him fades the whole of it as one layer by
 * `arrivalOf(appearance, presence)` over whatever is behind it — the phone's view and the headset's
 * quad both do. Skia's picture was faded inside the drawing, so every picture here is faded exactly
 * as a view fades it ({@link shown}): the picture times the arrival, over the background where the
 * picture lets it through. Over black that is the picture times the arrival.
 *
 * The pixel analysis runs here, in the test, on the pixels the page hands back.
 */

const SIZE = 256;

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
/** A bright screen behind him: the phone's '#8fb3ae'. */
const BRIGHT_SCREEN: Rgb = [0x8f, 0xb3, 0xae];

/** What the page knows of the drawing, and a way to draw with it, for one test. */
interface Picture {
  facts: PictureFacts;
  /** The sphere's radius in pixels, at rest. Taken from the drawing so the two cannot drift apart. */
  radius: number;
  /** Draws `moment` and returns it as a view shows it, over `background`: RGBA, top row first. */
  render(moment: PictureMoment | PictureFrame, background?: Rgb): Promise<Uint8Array>;
  /** Where each of `orbits` is round him at `time`, in pixels. */
  whereOnCanvas(orbits: PictureOrbit[], time: number): Promise<{ x: number; y: number }[]>;
}

function isMoment(value: PictureMoment | PictureFrame): value is PictureMoment {
  return 'frame' in value;
}

/**
 * The picture as a view shows it: the premultiplied picture `drawn` (bottom row first, as a
 * framebuffer is read) faded as one layer by `arrival`, over `background`, top row first.
 */
function shown(drawn: Uint8Array, arrival: number, background: Rgb): Uint8Array {
  const pixels = new Uint8Array(drawn.length);
  const row = SIZE * 4;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const from = (SIZE - 1 - y) * row + x * 4;
      const to = y * row + x * 4;
      const through = 1 - ((drawn[from + 3] ?? 0) / 255) * arrival;
      for (let channel = 0; channel < 3; channel++) {
        pixels[to + channel] = Math.round((drawn[from + channel] ?? 0) * arrival + background[channel] * through);
      }
      pixels[to + 3] = 255;
    }
  }
  return pixels;
}

async function openPicture(page: Page): Promise<Picture> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/hey-jarvis/vr/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  const facts = await page.evaluate(() => window.__hologramPreview?.pictureFacts());
  if (facts === undefined) throw new Error('The preview published no hook.');
  const radius = SIZE * facts.sphereFraction;
  return {
    facts,
    radius,
    async render(moment, background = BLACK) {
      const asked = isMoment(moment) ? moment : { frame: moment };
      const drawn = await page.evaluate((request) => window.__hologramPreview?.drawPictures(request), {
        size: SIZE,
        moments: [asked],
      });
      expect(problems).toEqual([]);
      const [picture] = drawn?.pictures ?? [];
      const [arrival] = drawn?.arrivals ?? [];
      if (picture === undefined || arrival === undefined) throw new Error('The preview drew nothing.');
      return shown(new Uint8Array(Buffer.from(picture, 'base64')), arrival, background);
    },
    async whereOnCanvas(orbits, time) {
      const points = await page.evaluate(([asked, at]) => window.__hologramPreview?.orbitPoints(asked, at), [
        orbits,
        time,
      ] as const);
      if (points === undefined) throw new Error('The preview published no hook.');
      return points.map(({ across, up }) => ({
        x: SIZE / 2 + across * radius * facts.screenOrbitRadii,
        y: SIZE / 2 - up * radius * facts.screenOrbitRadii,
      }));
    },
  };
}

/** A formed hologram with no voice at all. */
function silence(picture: Picture, time: number): PictureFrame {
  return {
    time,
    level: 0,
    bands: new Array(picture.facts.voiceBandCount).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    thinking: 0,
    presence: 1,
  };
}

/** A formed hologram while Jarvis talks: fully agitated, with the latest burst `burstAge` seconds ago. */
function speech(time: number, level: number, bands: number[], burstAge = 10, burstCount = 0): PictureFrame {
  return {
    time,
    level,
    bands,
    speaking: true,
    agitation: 1,
    burstAge,
    burstStrength: burstAge < 10 ? 1 : 0,
    burstCount,
    appearance: 1,
    thinking: 0,
    presence: 1,
  };
}

/** A spectrum with energy in the lowest bands only, or the highest only. */
function spectrum(picture: Picture, where: 'low' | 'high', energy: number): number[] {
  const count = picture.facts.voiceBandCount;
  return Array.from({ length: count }, (_, band) => {
    const isLow = band < count / 3;
    const isHigh = band >= (count * 2) / 3;
    return (where === 'low' ? isLow : isHigh) ? energy : 0;
  });
}

function evenBands(picture: Picture, energy: number): number[] {
  return new Array(picture.facts.voiceBandCount).fill(energy);
}

function luminance(pixels: Uint8Array, index: number): number {
  return 0.2126 * (pixels[index] ?? 0) + 0.7152 * (pixels[index + 1] ?? 0) + 0.0722 * (pixels[index + 2] ?? 0);
}

/** Distance of a pixel's centre from the sphere's centre, in sphere radii. */
function radiusOf(picture: Picture, x: number, y: number): number {
  return Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / picture.radius;
}

/** How far out the light sits, in sphere radii at rest: the luminance-weighted mean distance from the middle. */
function lightReach(picture: Picture, pixels: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const here = luminance(pixels, (y * SIZE + x) * 4);
      weighted += here * radiusOf(picture, x, y);
      total += here;
    }
  }
  return total === 0 ? 0 : weighted / total;
}

/** Mean luminance over the whole square, 0–255. */
function brightness(pixels: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += luminance(pixels, index);
  }
  return total / (pixels.length / 4);
}

/** Mean luminance inside 0.95 of the sphere's radius: the disc the film study measured. */
function discBrightness(picture: Picture, pixels: Uint8Array): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (radiusOf(picture, x, y) >= 0.95) continue;
      total += luminance(pixels, (y * SIZE + x) * 4);
      count++;
    }
  }
  return total / count;
}

/** Mean absolute difference per channel between two renders, 0–255. */
function difference(first: Uint8Array, second: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < first.length; index++) {
    total += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }
  return total / first.length;
}

/**
 * What share of the square's edge band is lit at all, 0-1.
 *
 * This is what tells the two ways of reaching the edge apart. The sphere's own rim running off the
 * canvas would light a long arc of this band; what the spread and the chips throw past the limb on
 * a syllable lights a scatter of pixels across it. A mean cannot separate those, and since the
 * sphere was made nearly as wide as the screen the second happens on purpose.
 */
function edgeLitShare(pixels: Uint8Array, band: number): number {
  let lit = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= band && x < SIZE - band && y >= band && y < SIZE - band) continue;
      if (luminance(pixels, (y * SIZE + x) * 4) > 8) lit++;
      count++;
    }
  }
  return lit / count;
}

/**
 * Red and blue summed over the square, how many pixels near the sphere are bluer than
 * they are red, and how many are nearly white.
 */
function colourCounts(picture: Picture, pixels: Uint8Array) {
  const counts = { red: 0, blue: 0, blueOverRedNearSphere: 0, nearWhite: 0 };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const index = (y * SIZE + x) * 4;
      const red = pixels[index] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      counts.red += red;
      counts.blue += blue;
      if (radiusOf(picture, x, y) < 1.2 && blue > red) counts.blueOverRedNearSphere++;
      if (red > 230 && (pixels[index + 1] ?? 0) > 230 && blue > 230) counts.nearWhite++;
    }
  }
  return counts;
}

/** How many bright pixels lie beyond 1.1 radii on the left half, where the film's chips fly. */
function brightBeyondLeftLimb(picture: Picture, pixels: Uint8Array): number {
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE / 2; x++) {
      if (radiusOf(picture, x, y) > 1.1 && luminance(pixels, (y * SIZE + x) * 4) > 100) count++;
    }
  }
  return count;
}

/** Brightness around a ring of radii, in 0.5° steps clockwise from 12 o'clock, minus its own running mean. */
function angularProfile(picture: Picture, pixels: Uint8Array, inner: number, outer: number): number[] {
  const profile: number[] = [];
  for (let step = 0; step < 720; step++) {
    const angle = ((step / 2) * Math.PI) / 180;
    let total = 0;
    for (let sample = 0; sample < 8; sample++) {
      const radius = (inner + ((outer - inner) * sample) / 7) * picture.radius;
      const x = Math.round(SIZE / 2 + Math.sin(angle) * radius);
      const y = Math.round(SIZE / 2 - Math.cos(angle) * radius);
      total += (pixels[(y * SIZE + x) * 4] ?? 0) - (pixels[(y * SIZE + x) * 4 + 2] ?? 0);
    }
    profile.push(total / 8);
  }
  return profile.map((value, step) => {
    let local = 0;
    for (let offset = -10; offset <= 10; offset++) local += profile[(step + offset + 720) % 720] ?? 0;
    return value - local / 21;
  });
}

/** The clockwise turn, in degrees, that best lines `later` up with `earlier`. */
function bestTurn(earlier: number[], later: number[]): number {
  let best = { turn: 0, score: -Infinity };
  for (let shift = -40; shift <= 40; shift++) {
    let score = 0;
    for (let step = 0; step < 720; step++) {
      score += (earlier[step] ?? 0) * (later[(step + shift + 720) % 720] ?? 0);
    }
    if (score > best.score) best = { turn: shift / 2, score };
  }
  return best.turn;
}

/** Luminance of every pixel, 0–255. */
function lumas(pixels: Uint8Array): Float32Array {
  const values = new Float32Array(pixels.length / 4);
  for (let pixel = 0; pixel < values.length; pixel++) values[pixel] = luminance(pixels, pixel * 4);
  return values;
}

/** How many pixels in each of an 8×8 grid of tiles change by more than 40 luminance between two renders. */
function changedPerTile(first: Float32Array, second: Float32Array): number[] {
  const tile = SIZE / 8;
  const counts = new Array(64).fill(0);
  for (let pixel = 0; pixel < first.length; pixel++) {
    if (Math.abs((first[pixel] ?? 0) - (second[pixel] ?? 0)) <= 40) continue;
    counts[Math.floor(Math.floor(pixel / SIZE) / tile) * 8 + Math.floor((pixel % SIZE) / tile)]++;
  }
  return counts;
}

/**
 * How much more of any one tile changes across the 60 Hz frame step at `time` than across
 * the steps either side of it. Something that pops lights a patch at once; the ordinary
 * churn changes the same patch alike on either side.
 */
async function largestJumpAt(picture: Picture, time: number): Promise<number> {
  const frameSeconds = 1 / 60;
  const renders: Float32Array[] = [];
  for (const shift of [-1.5, -0.5, 0.5, 1.5]) {
    renders.push(lumas(await picture.render(silence(picture, Math.max(0, time + shift * frameSeconds)))));
  }
  const [first, second, third, fourth] = renders;
  if (!first || !second || !third || !fourth) throw new Error('Could not render the frames around the boundary');
  const before = changedPerTile(first, second);
  const across = changedPerTile(second, third);
  const after = changedPerTile(third, fourth);
  return Math.max(...across.map((count, tile) => count - Math.max(before[tile] ?? 0, after[tile] ?? 0)));
}

/**
 * One preview page for every test in the file, made once a worker: the page takes the emulator some
 * fifteen seconds to open, and the pictures it draws a fraction of a second each. Every picture is
 * drawn from nothing but its own frame, so nothing one test draws reaches another (the test that
 * nothing leaks between frames says so); a failed test gets a fresh worker, and a fresh page, anyway.
 */
const test = appTest.extend<Record<never, never>, { picture: Picture }>({
  picture: [
    async ({ browser }, use, workerInfo) => {
      // A worker's page is not made by Playwright's own `page` fixture, so it is given the
      // project's base URL by hand.
      const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
      await keepOffline(page);
      await use(await openPicture(page));
      await page.close();
    },
    { scope: 'worker' },
  ],
});

test.describe('the hologram', () => {
  test('draws something, and something golden rather than white or blue', async ({ picture }) => {
    const pixels = await picture.render(speech(5, 0.7, spectrum(picture, 'low', 0.7)));
    const colour = colourCounts(picture, pixels);

    expect(brightness(pixels)).toBeGreaterThan(5);
    expect(colour.red).toBeGreaterThan(colour.blue * 1.5);
    // the film's sphere has no blue in it and next to no pure white
    expect(colour.blueOverRedNearSphere).toBe(0);
    expect(colour.nearWhite).toBeLessThanOrEqual(8);
  });

  test('moves while Jarvis is silent, so an idle screen still looks alive', async ({ picture }) => {
    expect(
      difference(await picture.render(silence(picture, 1)), await picture.render(silence(picture, 2.5))),
    ).toBeGreaterThan(1);
  });

  test('draws the same frame the same way every time', async ({ picture }) => {
    const frame = speech(4.2, 0.5, spectrum(picture, 'high', 0.5));
    expect(difference(await picture.render(frame), await picture.render(frame))).toBe(0);
  });

  test('draws a frame the same way after other frames on the same target, so nothing leaks between frames', async ({
    picture,
  }) => {
    // The page draws every picture of a size into the one target, with the one GpuPicture, as the
    // headset draws every frame of him: what twenty other frames leave behind would show here.
    const frame = speech(4.2, 0.5, spectrum(picture, 'high', 0.5), 0.07, 12);
    const first = await picture.render(frame);
    for (let step = 0; step < 20; step++) {
      await picture.render(
        speech(step * 3.1, (step % 5) / 4, spectrum(picture, step % 2 ? 'low' : 'high', 0.8), step * 0.013, step),
      );
    }

    expect(difference(first, await picture.render(frame))).toBe(0);
  });

  test('shows speech as activity: chips thrown beyond the limb, and more change than when calm', async ({
    picture,
  }) => {
    // Some forty renders, which SwiftShader draws on the CPU.
    test.setTimeout(300_000);
    const bands = evenBands(picture, 0.7);
    for (const time of [6, 13.4, 22.8]) {
      // a protrusion the script has out at this moment is there in both, so count what the burst adds
      const calm = brightBeyondLeftLimb(picture, await picture.render(silence(picture, time)));
      const burst = brightBeyondLeftLimb(picture, await picture.render(speech(time, 0.7, bands, 0.08, 3)));

      expect(burst - calm).toBeGreaterThan(200);
    }

    // Over a tenth of a second, the talking sphere changes clearly more than the calm one.
    let calmChange = 0;
    let talkingChange = 0;
    for (const time of [6, 9.3, 13.4, 17.1, 22.8]) {
      calmChange += difference(
        await picture.render(silence(picture, time)),
        await picture.render(silence(picture, time + 0.1)),
      );
      talkingChange += difference(
        await picture.render(speech(time, 0.7, bands, 0.05, 7)),
        await picture.render(speech(time + 0.1, 0.7, bands, 0.15, 7)),
      );
    }

    expect(talkingChange).toBeGreaterThan(calmChange * 1.3);

    // And with no burst anywhere near — agitation alone, which is most of what a slowed-down
    // replay on an emulator ever sees — it still churns and frays clearly more than when calm.
    let agitatedChange = 0;
    for (const time of [6, 9.3, 13.4, 17.1, 22.8]) {
      agitatedChange += difference(
        await picture.render(speech(time, 0.7, bands)),
        await picture.render(speech(time + 0.1, 0.7, bands)),
      );
    }

    expect(agitatedChange).toBeGreaterThan(calmChange * 1.3);
  });

  test('shows which frequencies are sounding while he talks, not just that he is talking', async ({ picture }) => {
    // Same moment, same overall level and agitation; only where the energy sits differs.
    const low = await picture.render(speech(7, 0.7, spectrum(picture, 'low', 0.9)));
    const high = await picture.render(speech(7, 0.7, spectrum(picture, 'high', 0.9)));

    // **The number falls as PARTICLE_COUNT rises, and it is the blending that does it**, not the
    // spectrum being answered any less. Fragments are Screen-blended, so a fragment's contribution
    // to a pixel is 1 - (1 - base)(1 - its own): the denser the swarm, the brighter the base under
    // every fragment, and the less any one of them moves the pixel it lands on. Measured over the
    // moments this suite renders: 0.71 at a thousand fragments, 0.65 at five thousand, 0.52-0.66 at
    // ten, 0.47-0.54 at fifteen. Nothing saturates at any of them — compression, not clipping.
    //
    // So this is measured rather than reasoned, and it keeps its teeth: the same spectrum rendered
    // twice differs by exactly 0, which is what ignoring the bands would score. Under the 0.52 the
    // sparsest moment measures rather than at it, because a threshold a test clears by three
    // percent is a threshold that fails on the next unrelated thing.
    expect(difference(low, high)).toBeGreaterThan(0.45);
  });

  test('turns its rim clockwise at the film rate', async ({ picture }) => {
    // The film's rim layer rolls at 10-12°/s, so 5-6° in half a second, whichever element
    // leads: on the script this seed builds, the crescent leads at 3 s, the thin ring at
    // 19 s and the ladder ring at 36 s, each well clear of its handover.
    for (const time of [3, 19, 36]) {
      const earlier = await picture.render(silence(picture, time));
      const later = await picture.render(silence(picture, time + 0.5));
      const turn = bestTurn(angularProfile(picture, earlier, 0.92, 1.1), angularProfile(picture, later, 0.92, 1.1));

      expect(turn).toBeGreaterThanOrEqual(4.5);
      expect(turn).toBeLessThanOrEqual(6.5);
    }
  });

  test('arrives as a vortex out of its core, and nothing else', async ({ picture }) => {
    // The whole of the arrival, at the user's asking: no point of light, no sparks, no spoked
    // dial — his particles leave the core, nearest first, and spiral out to where they sit.
    const at = (appearance: number) => picture.render({ ...silence(picture, 3), appearance });
    const formed = await at(1);

    expect(brightness(await at(0))).toBeLessThan(0.5);
    // Early on the light is still gathered at the core, and it spreads outward steadily.
    const reaches: number[] = [];
    for (const appearance of [0.2, 0.4, 0.6, 0.8, 1]) reaches.push(lightReach(picture, await at(appearance)));
    for (let step = 1; step < reaches.length; step++) {
      expect(reaches[step]).toBeGreaterThan(reaches[step - 1] ?? 0);
    }
    expect(reaches[0]).toBeLessThan((reaches[reaches.length - 1] ?? 0) * 0.5);
    expect(difference(await at(0.999), formed)).toBeLessThan(0.5);
  });

  test('says the greeting while it arrives without throwing anything off a limb that is not there yet', async ({
    picture,
  }) => {
    // The greeting plays during the vortex. Chips, fraying and the split crescent are what speech
    // does to a formed ball; early in the vortex there is no limb for them to leave, so a frame
    // spoken over must look like the same frame in silence.
    const bands = spectrum(picture, 'low', 0.8);
    for (const appearance of [0.2, 0.4]) {
      const silent = await picture.render({ ...silence(picture, 0.5), appearance });
      const spoken = await picture.render({ ...speech(0.5, 0.9, bands, 0.05, 3), appearance });
      expect(brightBeyondLeftLimb(picture, spoken)).toBeLessThanOrEqual(brightBeyondLeftLimb(picture, silent) + 1);
    }
  });

  test('brings its rim elements and protrusions in and out smoothly, with nothing popping at a script boundary', async ({
    picture,
  }) => {
    // Four renders at each of the script's epoch starts.
    test.setTimeout(300_000);
    expect(picture.facts.scriptBoundaries.length).toBeGreaterThan(0);
    for (const boundary of picture.facts.scriptBoundaries) {
      expect(await largestJumpAt(picture, boundary)).toBeLessThan(30);
    }
  });

  test('materialises without a flash: no one frame of it turns a tenth of the light on at once', async ({
    picture,
  }) => {
    // Two renders a frame for a hundred and ten frames: the slowest test here by an order.
    test.setTimeout(600_000);
    const { materialiseSeconds } = picture.facts;
    // The arrival is the vortex over MATERIALISE_SECONDS, and the script-boundary test above never
    // sees it, because it only walks a formed ball. An arrival so steep it jumped would read
    // as a flash: none of its frames may move a tenth of the light on in one.
    //
    // Measured as a share of the same moment fully formed, not of the formed ball at rest. The
    // script has one deliberate step in it — a red flash, two film frames long and off again,
    // straight out of the film — and it lands about a second in, which is inside this window.
    // Comparing each frame with itself at appearance 1 divides out everything time drives, the
    // flash included, and leaves exactly what this test is about: how fast the ball itself
    // arrives. It is the stricter measure of the two, since the denominator is no longer a ball
    // brighter than the one being walked past.
    let previous = 0;
    let worst = 0;
    for (let frame = 1; frame <= Math.round(60 * (materialiseSeconds + 0.4)); frame++) {
      const time = frame / 60;
      const appearance = Math.min(1, time / materialiseSeconds);
      const formedNow = brightness(await picture.render(silence(picture, time)));
      const share = brightness(await picture.render({ ...silence(picture, time), appearance })) / formedNow;
      worst = Math.max(worst, Math.abs(share - previous));
      previous = share;
    }

    expect(worst).toBeLessThan(0.1);
  });

  test('thinks without glowing, so a thought is never mistaken for a word', async ({ picture }) => {
    // Speech brightens the ball by 40% and more, deliberately. A thought must not, or the two
    // states say the same thing to anyone glancing at the screen.
    for (const time of [5.4, 6.3, 7.2]) {
      const calm = discBrightness(picture, await picture.render(silence(picture, time)));
      const thought = discBrightness(picture, await picture.render({ ...silence(picture, time), thinking: 1 }));

      expect(thought).toBeLessThan(calm);
    }
  });

  test('leaves by shrinking and fading, and leaves nothing of him behind', async ({ picture }) => {
    // The way out is the way in, run backwards and quicker: the whole sphere fades and draws back
    // toward the middle rather than being cut off where it stands. The drawing does the drawing
    // back; the fade is the view's, laid over the whole picture as one layer by its arrival, which
    // is what `shown` does here.
    const here = brightness(await picture.render({ ...silence(picture, 6), presence: 1 }));
    const halfway = brightness(await picture.render({ ...silence(picture, 6), presence: 0.5 }));
    // ...and over a bright screen for the ending, where what matters is that nothing is left on it.
    const gone = await picture.render({ ...silence(picture, 6), presence: 0 }, BRIGHT_SCREEN);
    const background = luminance(gone, 0);

    expect(halfway).toBeLessThan(here * 0.75);
    // Nothing of him: every pixel back to the screen behind. One expectation over the farthest of
    // them, rather than sixty-five thousand, each of which Playwright reports on its own.
    let farthest = 0;
    for (let index = 0; index < gone.length; index += 4) {
      farthest = Math.max(farthest, Math.abs(luminance(gone, index) - background));
    }
    expect(farthest).toBeLessThan(0.5);
  });

  test('stays inside its square even at full volume, chips and all', async ({ picture }) => {
    // Twenty renders of him at his loudest.
    test.setTimeout(300_000);
    // Strict again, and the round trip is worth recording. It began this way and held at
    // SPHERE_FRACTION 0.27. The user then asked for Jarvis as wide as the screen, and at 0.35 the
    // chips thrown to about 1.6R on a syllable were cut off in mid-air — so the rule was loosened
    // to let a few pixels of the band light up, telling a clipped chip from a clipped rim by how
    // much of the band was lit.
    //
    // Then the user saw the clipping and said so, and the answer turned out not to be a looser
    // rule but a wider square: the square is bigger than the *screen* now, so the only thing that
    // cuts a chip is the screen itself, where an edge cannot be seen.
    //
    // **The ten-pixel allowance is doing real work now, and it is worth knowing how much.** It
    // measured none of the band at five thousand fragments. At ten thousand the worst moment of the
    // worst burst lights seven pixels of 5020 — inside the allowance, but only just — and at
    // fifteen thousand it lit ninety and this failed. More fragments are more draws from the same
    // distribution, so the tail reaches further: 1.81R here against 1.79R at five thousand.
    //
    // What reaches out there is the speech-driven spread, not the chips: removing the burst
    // entirely changes nothing. And the square's own edge is 1.85R while *the screen ends at
    // 1.24R*, so all of it is half again further out than anything the user can see. That is why
    // seven pixels is a note rather than a bug — but the allowance is the thing to re-measure,
    // rather than widen, the next time this trips.
    //
    // It keeps its teeth either way. Shrink the square to the 1.61R that clipped visibly and the
    // band lights 0.0998 of itself — 501 pixels, seventy times this — and at 1.37R, 0.251. A rim
    // running off the canvas is an arc, not a spray.
    const band = Math.round(SIZE * 0.02);
    for (const time of [8, 23.4, 31.2, 47.9, 55.1]) {
      for (const burstAge of [0, 0.06, 0.12, 0.2]) {
        const loudest = await picture.render(speech(time, 1, evenBands(picture, 1), burstAge, Math.round(time * 10)));

        expect(edgeLitShare(loudest, band)).toBeLessThan(0.002);
      }
    }
  });
});

/** A satellite on the orbit, lit, with nothing else going on: what each test changes one thing of. */
function orbit(picture: Picture, overrides: Partial<PictureOrbit> = {}): PictureOrbit {
  return { glyph: picture.facts.plainRingGlyph, level: 1, flare: 0, asking: false, turn: 0, reach: 1, ...overrides };
}

/** Every glyph `hologram` knows: the plain ring, and sample mode's own. The real ones are the server's. */
function glyphsOf(picture: Picture): string[] {
  return [picture.facts.plainRingGlyph, ...picture.facts.sampleGlyphs];
}

/**
 * What `orbits` add to him at `time`: the picture drawn with them less the same frame drawn without.
 *
 * The satellites are drawn over him, never on their own, so this is how they are seen alone. Each
 * is Screened over him, so what one adds is never less than nothing.
 */
async function satellitesAdded(picture: Picture, orbits: PictureOrbit[], time = 0): Promise<Uint8Array> {
  const frame = silence(picture, time);
  const without = await picture.render(frame);
  const withThem = await picture.render({ frame, satellites: orbits });
  const added = new Uint8Array(without.length);
  for (let index = 0; index < added.length; index++) {
    added[index] = Math.max(0, (withThem[index] ?? 0) - (without[index] ?? 0));
  }
  return added;
}

/** The brightest red within `reach` pixels of (x, y). */
function brightestNear(pixels: Uint8Array, x: number, y: number, reach: number): number {
  let brightest = 0;
  for (let row = Math.max(0, Math.floor(y - reach)); row <= Math.min(SIZE - 1, Math.ceil(y + reach)); row++) {
    for (
      let column = Math.max(0, Math.floor(x - reach));
      column <= Math.min(SIZE - 1, Math.ceil(x + reach));
      column++
    ) {
      brightest = Math.max(brightest, pixels[(row * SIZE + column) * 4] ?? 0);
    }
  }
  return brightest;
}

function litPixels(pixels: Uint8Array): number {
  let lit = 0;
  for (let index = 0; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 24) lit++;
  return lit;
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return Buffer.from(first).equals(Buffer.from(second));
}

test.describe('the satellites on a screen', () => {
  test('draw nothing when there are none', async ({ picture }) => {
    const added = await satellitesAdded(picture, []);
    expect(litPixels(added)).toBe(0);
    expect(added.every((value) => value === 0)).toBe(true);
  });

  test('draw the glyph each is sent where its orbit says, and nothing at his centre', async ({ picture }) => {
    const glyphs = glyphsOf(picture);
    for (const [index, glyph] of glyphs.entries()) {
      const drawn = orbit(picture, { glyph, turn: index / glyphs.length });
      const pixels = await satellitesAdded(picture, [drawn], 1.2);
      const [where] = await picture.whereOnCanvas([drawn], 1.2);
      if (where === undefined) throw new Error('The preview put the satellite nowhere.');

      expect(brightestNear(pixels, where.x, where.y, picture.radius * picture.facts.screenGlyphRadii)).toBeGreaterThan(
        120,
      );
      expect(brightestNear(pixels, SIZE / 2, SIZE / 2, 4)).toBe(0);
    }
  });

  test('are dimmer passing behind him than in front of him', async ({ picture }) => {
    const front = orbit(picture, { turn: 0.25 });
    const behind = orbit(picture, { turn: 0.75 });
    const [frontAt, behindAt] = await picture.whereOnCanvas([front, behind], 0);
    if (frontAt === undefined || behindAt === undefined) throw new Error('The preview put the satellites nowhere.');

    expect(litPixels(await satellitesAdded(picture, [front]))).toBeGreaterThan(
      litPixels(await satellitesAdded(picture, [behind])),
    );
    expect(frontAt.y).toBeGreaterThan(behindAt.y);
  });

  test('flare with a ring going out from the glyph as a tool is called', async ({ picture }) => {
    expect(litPixels(await satellitesAdded(picture, [orbit(picture, { flare: 0.6 })]))).toBeGreaterThan(
      litPixels(await satellitesAdded(picture, [orbit(picture)])),
    );
  });

  test('draw a different picture for each glyph they are sent', async ({ picture }) => {
    const glyphs = glyphsOf(picture);
    const pictures = new Set<string>();
    for (const glyph of glyphs) {
      pictures.add(Buffer.from(await satellitesAdded(picture, [orbit(picture, { glyph })])).toString('base64'));
    }

    expect(pictures.size).toBe(glyphs.length);
  });

  test('draw a glyph the drawing cannot read as the plain ring, since its agent is still at work', async ({
    picture,
  }) => {
    const unreadable = await satellitesAdded(picture, [orbit(picture, { glyph: 'M 0 0 L' })]);
    const plain = await satellitesAdded(picture, [orbit(picture, { glyph: picture.facts.plainRingGlyph })]);

    expect(litPixels(plain)).toBeGreaterThan(0);
    expect(sameBytes(unreadable, plain)).toBe(true);
  });

  test('are not drawn once they have gone out', async ({ picture }) => {
    const added = await satellitesAdded(picture, [orbit(picture, { level: 0 })]);
    expect(litPixels(added)).toBe(0);
    expect(added.every((value) => value === 0)).toBe(true);
  });
});
