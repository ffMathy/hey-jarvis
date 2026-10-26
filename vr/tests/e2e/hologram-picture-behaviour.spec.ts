import type { Page } from '@playwright/test';
import type { PictureFacts, PictureFrame, PictureMoment, PictureOrbit } from '../../src/preview/preview-hook';
import { test as appTest, expect, keepOffline } from './fixtures';

/**
 * The hologram's picture of everything but his body, drawn for real on the GPU.
 *
 * `hologram/gpu`'s `drawGpuPicture` — the picture every device draws, the headset into a target of
 * three's (`hologram3d/picture-target.ts`), a phone and a watch onto their canvases — drawn by the
 * preview page in Chromium, so these tests look at actual pixels rather than at which functions were
 * called. They cannot say whether it is beautiful; they can say it is golden, that it moves the way
 * it means to — the core ring's brighter stretches rolling round it, the cage turning with his body
 * — that it answers Jarvis's voice with activity, never with a brightness pulse, that it spirals out
 * of its core without a flash, that nothing pops in or out as its slow script moves on, that it
 * stays inside its square, and that his satellites are drawn where their orbits say.
 *
 * They began as `hologram`'s own tests, against Skia's picture under CanvasKit, and moved here with
 * the picture, since there is no GPU under `bun test`. When he was redrawn after the Vision Quest
 * footage the ones that held the old film study — its colours, its rolling rim, the crescent its
 * low notes split — were written again for the new look on purpose, and every threshold that moved
 * says what was measured when it did.
 *
 * **What is measured is what a view shows.** The picture is always drawn unfaded, premultiplied
 * light over transparent black; whoever shows him fades the whole of it as one layer by
 * `arrivalOf(appearance, presence)` over whatever is behind it — the phone's view and the headset's
 * quad both do. So every picture here is faded exactly as a view fades it ({@link shown}): the
 * picture times the arrival, over the background where the picture lets it through. Over black that
 * is the picture times the arrival.
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

/** Mean luminance inside 0.95 of the sphere's radius: the disc his shell's edge closes. */
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
 * This is what tells the two ways of reaching the edge apart. Something round him running off the
 * canvas — the aura, the cage — would light a long arc of this band; what the chips, the fray and
 * the embers throw past the shell on a syllable would light a scatter of pixels across it. A mean
 * cannot separate those.
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

/** Where his white-hot core ring is the one thing allowed to come near white: inside this many radii. */
const WHITE_HOT_REACH = 0.45;

/**
 * Red and blue summed over the square, how many pixels are bluer than they are red, and how many
 * outside {@link WHITE_HOT_REACH} are nearly white.
 */
function colourCounts(picture: Picture, pixels: Uint8Array) {
  const counts = { red: 0, blue: 0, blueOverRed: 0, nearWhiteOutsideTheCore: 0 };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const index = (y * SIZE + x) * 4;
      const red = pixels[index] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      counts.red += red;
      counts.blue += blue;
      if (blue > red) counts.blueOverRed++;
      const nearWhite = red > 230 && (pixels[index + 1] ?? 0) > 230 && blue > 230;
      if (nearWhite && radiusOf(picture, x, y) > WHITE_HOT_REACH) counts.nearWhiteOutsideTheCore++;
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

/** How far either side of the core ring its profile is taken, in radii: the ring's glow and no more. */
const CORE_RING_BAND = 0.03;

/**
 * Mean luminance round the core ring in 1° steps clockwise from 12 o'clock, over the band of
 * {@link CORE_RING_BAND} either side of it, about the core's own centre (a little off his middle).
 */
function coreRingProfile(picture: Picture, pixels: Uint8Array): number[] {
  const { coreAcross, coreDown, coreRingRadius } = picture.facts;
  const centreX = SIZE / 2 + coreAcross * picture.radius;
  const centreY = SIZE / 2 + coreDown * picture.radius;
  const totals = new Array(360).fill(0);
  const counts = new Array(360).fill(0);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const across = x + 0.5 - centreX;
      const down = y + 0.5 - centreY;
      if (Math.abs(Math.hypot(across, down) / picture.radius - coreRingRadius) > CORE_RING_BAND) continue;
      const degree = Math.floor(((Math.atan2(across, -down) * 180) / Math.PI + 360) % 360);
      totals[degree] += luminance(pixels, (y * SIZE + x) * 4);
      counts[degree]++;
    }
  }
  return totals.map((total, degree) => (counts[degree] ? total / counts[degree] : 0));
}

/** `profile` less `still`, degree by degree, then averaged over `reach` degrees either side. */
function movingPart(profile: number[], still: number[], reach: number): number[] {
  return profile.map((_, degree) => {
    let total = 0;
    for (let offset = -reach; offset <= reach; offset++) {
      const at = (degree + offset + 360) % 360;
      total += (profile[at] ?? 0) - (still[at] ?? 0);
    }
    return total / (2 * reach + 1);
  });
}

/** How well `later` lines up with `earlier` turned clockwise by each shift from -`reach` to `reach` degrees. */
function turnScores(earlier: number[], later: number[], reach: number): number[] {
  const scores: number[] = [];
  for (let shift = -reach; shift <= reach; shift++) {
    let score = 0;
    for (let degree = 0; degree < 360; degree++) {
      score += (earlier[degree] ?? 0) * (later[(degree + shift + 360) % 360] ?? 0);
    }
    scores.push(score);
  }
  return scores;
}

/**
 * Each pixel's luminance between `inner` and `outer` radii, read from `pixels` turned left to right
 * when `mirrored`, less the mean of the pixels as far out as it: what is round him alike in every
 * direction — the aura — drops out, and what is left is what lies somewhere in particular.
 */
function bandAgainstItsRings(
  picture: Picture,
  pixels: Uint8Array,
  inner: number,
  outer: number,
  mirrored: boolean,
): number[] {
  const rings = new Map<number, { total: number; count: number }>();
  const samples: { ring: number; light: number }[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const radius = radiusOf(picture, x, y);
      if (radius < inner || radius > outer) continue;
      const ring = Math.round(radius * picture.radius);
      const light = luminance(pixels, (y * SIZE + (mirrored ? SIZE - 1 - x : x)) * 4);
      const sum = rings.get(ring) ?? { total: 0, count: 0 };
      sum.total += light;
      sum.count++;
      rings.set(ring, sum);
      samples.push({ ring, light });
    }
  }
  return samples.map(({ ring, light }) => {
    const sum = rings.get(ring);
    return sum === undefined ? light : light - sum.total / sum.count;
  });
}

/** How alike two lists of numbers that each average about nothing are: their cosine, -1 to 1. */
function likeness(first: number[], second: number[]): number {
  let both = 0;
  let firstOnly = 0;
  let secondOnly = 0;
  for (let index = 0; index < first.length; index++) {
    both += (first[index] ?? 0) * (second[index] ?? 0);
    firstOnly += (first[index] ?? 0) ** 2;
    secondOnly += (second[index] ?? 0) ** 2;
  }
  return both / Math.sqrt(firstOnly * secondOnly);
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
  test('draws something golden: never bluer than red, and white-hot only in the ring round its core', async ({
    picture,
  }) => {
    // The Vision Quest footage runs from white-hot through pale gold and gold to deep amber — its
    // hottest pixels (255,229,174), its median (178,105,32) — and the only thing in him near white
    // is the thin ring round his core, at 0.35R. So, where the old film study allowed no white at
    // all, white is now allowed there and nowhere else in the picture; the shell of white-hot specks
    // round it is the body's, which this does not draw. Measured when the picture was redrawn, over
    // these three moments: 0 pixels bluer than red, red 2.9 times blue, and not one pixel with all
    // three channels over 230 anywhere — the ring's hottest is about (253,244,196).
    for (const frame of [
      speech(5, 0.7, spectrum(picture, 'low', 0.7)),
      speech(45.3, 0.6, evenBands(picture, 0.55), 0.05, 4),
      silence(picture, 19),
    ]) {
      const pixels = await picture.render(frame);
      const colour = colourCounts(picture, pixels);

      expect(brightness(pixels)).toBeGreaterThan(5);
      expect(colour.red).toBeGreaterThan(colour.blue * 1.5);
      expect(colour.blueOverRed).toBe(0);
      expect(colour.nearWhiteOutsideTheCore).toBe(0);
    }
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
    // Measured when the picture was redrawn: a burst adds 470–540 bright pixels beyond the left
    // limb, the talking sphere changes 2.4 times as much as the calm one and the agitated one 1.7.
    for (const time of [6, 13.4, 22.8]) {
      // the cage and the embers are round him in both, so count what the burst adds
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
    // Same moments, same overall level and agitation; only where the energy sits differs. The low
    // notes bring more embers off him, the high ones fray his shell's edge.
    //
    // **0.15, where it was 0.45, because the old picture answered with something far bigger.** Its
    // low notes split the crescent, a band of light round a third of the rim, and that measured
    // 0.63. The embers and the fray that answer them now are hairlines and flecks, and measured
    // 0.21–0.25 over these moments when the picture was redrawn. It keeps its teeth: the same
    // spectrum drawn twice differs by exactly 0, which is what ignoring the bands would score, and
    // it sits under the least of them rather than at it, because a threshold a test clears by
    // three percent is a threshold that fails on the next unrelated thing.
    for (const time of [7, 21]) {
      const low = await picture.render(speech(time, 0.7, spectrum(picture, 'low', 0.9)));
      const high = await picture.render(speech(time, 0.7, spectrum(picture, 'high', 0.9)));

      expect(difference(low, high)).toBeGreaterThan(0.15);
    }
  });

  test('rolls the brighter stretches of its core ring clockwise, at their own rate', async ({ picture }) => {
    // Twenty-eight renders.
    test.setTimeout(300_000);
    // What used to roll was the old film study's rim, at its 10–12°/s. There is no rim now; the
    // same ROLL_DEGREES_PER_SECOND rolls the brighter and dimmer stretches of the white-hot ring
    // round his core, which is the picture's one steady turn of its own.
    //
    // Those stretches are faint beside what does not roll — the hooked ring and bar inside it, the
    // tick it puts out, the way its thin white line falls on the pixel grid — and lining two
    // pictures up as they are finds that still part, at no turn at all. So the ring is taken
    // round one whole roll first, and its mean, which is everything that does not roll, is taken
    // away from each picture before they are lined up; six pairs, two seconds apart, are lined up
    // together. Measured when the picture was redrawn: 21–22° in the two seconds, against the 22°
    // the rate says, and 18–26° for single pairs.
    const { rollDegreesPerSecond } = picture.facts;
    expect(rollDegreesPerSecond).toBeGreaterThan(0);
    const rollSeconds = 360 / rollDegreesPerSecond;
    const start = 19;
    const stillFrames = 16;
    const still = new Array(360).fill(0);
    for (let frame = 0; frame < stillFrames; frame++) {
      const profile = coreRingProfile(
        picture,
        await picture.render(silence(picture, start + (frame * rollSeconds) / stillFrames)),
      );
      for (let degree = 0; degree < 360; degree++) still[degree] += (profile[degree] ?? 0) / stillFrames;
    }
    const rolling = async (time: number) =>
      movingPart(coreRingProfile(picture, await picture.render(silence(picture, time))), still, 5);
    const apart = 2;
    const reach = 60;
    const scores = new Array(2 * reach + 1).fill(0);
    for (const time of [start, start + 4.1, start + 9.7, start + 15.2, start + 21.3, start + 26.8]) {
      const pair = turnScores(await rolling(time), await rolling(time + apart), reach);
      for (let shift = 0; shift < scores.length; shift++) scores[shift] += pair[shift] ?? 0;
    }
    const turn = scores.indexOf(Math.max(...scores)) - reach;

    expect(turn).toBeGreaterThanOrEqual(rollDegreesPerSecond * apart - 3);
    expect(turn).toBeLessThanOrEqual(rollDegreesPerSecond * apart + 3);
  });

  test('turns its cage with his body, once round the vertical a body turn', async ({ picture }) => {
    // The cage of hairlines round him is in three dimensions and turns about the vertical with his
    // body, as the body's specks do. Seen flat, half a turn later it is its own mirror image —
    // what was on his left is on his right — and a whole turn later it is itself again; the
    // twinkling of its lines and the embers drifting through it keep either from being exact.
    // Measured where it is (0.95–1.31R, its tail to 1.4R), with the aura taken out: 0.41–0.52 alike
    // with its mirror half a turn later and 0.00–0.09 with itself, 0.54–0.62 alike with itself a
    // turn later and 0.00–0.11 with its mirror. A cage that stood still, or turned at any other
    // rate, would be like neither.
    const { bodyTurnSeconds } = picture.facts;
    const cage = (pixels: Uint8Array, mirrored: boolean) => bandAgainstItsRings(picture, pixels, 0.95, 1.45, mirrored);
    for (const time of [3, 19.5]) {
      const now = cage(await picture.render(silence(picture, time)), false);
      const halfATurn = await picture.render(silence(picture, time + bodyTurnSeconds / 2));
      const aTurn = await picture.render(silence(picture, time + bodyTurnSeconds));

      expect(likeness(now, cage(halfATurn, true))).toBeGreaterThan(likeness(now, cage(halfATurn, false)) + 0.25);
      expect(likeness(now, cage(aTurn, false))).toBeGreaterThan(likeness(now, cage(aTurn, true)) + 0.25);
    }
  });

  test('arrives as a vortex out of its core, and nothing else', async ({ picture }) => {
    // The whole of the arrival, at the user's asking: no point of light, no sparks, no spoked
    // dial — his particles leave the core, nearest first, and spiral out to where they sit.
    const at = (appearance: number) => picture.render({ ...silence(picture, 3), appearance });
    const formed = await at(1);

    expect(brightness(await at(0))).toBeLessThan(0.5);
    // Early on the light is still gathered at the core, and it spreads outward steadily. With the
    // white-hot ring at the core, most of the early light is the ring's: measured when the picture
    // was redrawn, the reach runs 0.31, 0.49, 0.62, 0.67 and 0.69R, so the first is 0.45 of the last.
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
    // The greeting plays during the vortex. Chips, fraying and the embers it brings out are what
    // speech does to a formed ball; early in the vortex there is no limb for them to leave, so a
    // frame spoken over must look like the same frame in silence.
    const bands = spectrum(picture, 'low', 0.8);
    for (const appearance of [0.2, 0.4]) {
      const silent = await picture.render({ ...silence(picture, 0.5), appearance });
      const spoken = await picture.render({ ...speech(0.5, 0.9, bands, 0.05, 3), appearance });
      expect(brightBeyondLeftLimb(picture, spoken)).toBeLessThanOrEqual(brightBeyondLeftLimb(picture, silent) + 1);
    }
  });

  test('pops nothing in or out at a boundary of its slow script', async ({ picture }) => {
    // Four renders at each of the script's epoch starts.
    test.setTimeout(300_000);
    // The script used to bring the rim's elements in and out — the crescent, the truss, the thin
    // ring — with lightning and a red flash, and this held that none of them popped. They went with
    // the old picture, and what the script still moves is how many of the body's specks show, which
    // this does not draw; so it now holds that nothing the picture draws is tied to a boundary.
    // Measured when the picture was redrawn: a jump of 4 at most, the churn of the embers and the
    // cage's twinkle, against the 30 a pop would make.
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
    // Measured as a share of the same moment fully formed, not of the formed ball at rest.
    // Comparing each frame with itself at appearance 1 divides out everything time drives — the
    // ring's roll, the cage's turn, the embers — and leaves exactly what this test is about: how
    // fast the ball itself arrives. It is the stricter measure of the two, since the denominator is
    // no longer a ball brighter than the one being walked past. The core is half the picture's
    // light, so it comes up over the first 0.4 of the vortex: measured when the picture was
    // redrawn, the steepest frame moves 0.05 of the light on, seven frames in.
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
    // A thought must not brighten him, or a thought and a word say the same thing to anyone
    // glancing at the screen. Speech hardly brightens the picture now — the sparks' glow follows the
    // voice by only a tenth, at the user's asking — so a thought dims it instead: everything but
    // the core ring recedes, so the plane sweeping through him is what is seen. Measured when the
    // picture was redrawn, inside 0.95R: 26 thinking, 42–43 calm, 43–44 speaking.
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
    // The round trip is worth recording. It began strict and held at SPHERE_FRACTION 0.27. The
    // user then asked for Jarvis as wide as the screen, and at 0.35 the chips thrown to about 1.6R
    // on a syllable were cut off in mid-air — so the rule was loosened to let a few pixels of the
    // band light up, telling a clipped chip from a clipped rim by how much of the band was lit.
    // Then the user saw the clipping and said so, and the answer turned out not to be a looser
    // rule but a wider square: the square is bigger than the *screen* now, so the only thing that
    // cuts a chip is the screen itself, where an edge cannot be seen.
    //
    // The band is the square's last 2%, from about 1.78R to its edge at 1.85R; the screen ends at
    // about 1.37R. Measured when the picture was redrawn, at full volume through every burst age
    // here: none of the band lit, and nothing lit past 1.68R — the cage, the aura and the embers
    // swell with his voice like everything drawn in his radius, and the embers are the farthest.
    // The ten-pixel allowance is kept for a chip or an ember that reaches the band, and it is the
    // thing to re-measure, rather than widen, the next time this trips. A rim — or the aura, or the
    // cage — running off the canvas is an arc, not a spray, and would light far more of it.
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
    // **100, where it was 120, because his picture under them changed.** A satellite is Screened
    // over him, and what it adds to a pixel is its own light times what the picture leaves of that
    // pixel; the glyphs are amber (245,154,60) now, crossing the cage and the aura round 0.9R. The
    // dimmest, up on the far side of its orbit and so drawn at less of its light, added a red of
    // 118 over the cage when the picture was redrawn, the others 150–202. Its light being the brightest
    // anything adds anywhere says where it is more surely than any level.
    const glyphs = glyphsOf(picture);
    for (const [index, glyph] of glyphs.entries()) {
      const drawn = orbit(picture, { glyph, turn: index / glyphs.length });
      const pixels = await satellitesAdded(picture, [drawn], 1.2);
      const [where] = await picture.whereOnCanvas([drawn], 1.2);
      if (where === undefined) throw new Error('The preview put the satellite nowhere.');
      const nearIt = brightestNear(pixels, where.x, where.y, picture.radius * picture.facts.screenGlyphRadii);

      expect(nearIt).toBeGreaterThan(100);
      expect(nearIt).toBe(brightestNear(pixels, SIZE / 2, SIZE / 2, SIZE));
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
