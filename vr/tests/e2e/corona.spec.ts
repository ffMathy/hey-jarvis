import { test as base, type Page, type TestInfo } from '@playwright/test';
import type {
  CoronaBackground,
  CoronaDrawRequest,
  CoronaPixel,
  CoronaProbeDrawn,
  CoronaProbePoint,
} from './corona-probe';
import { bundle, expect, keepOffline, keepPicture } from './fixtures';

/**
 * The corona Jarvis lights around an entity he is working on, drawn by the real shaders in the
 * browser, photographed and measured.
 *
 * The pictures are for a person to judge whether it reads as his light — warm, a ring and one soft
 * band — over black and over a room. The measurements hold the parts of that a regression would
 * break: the colour is his gold and not white or red, the middle is left clear, the band glides up
 * through it and back down on his thinking band's time, turning back inside the disc, nothing
 * blooms out of it as a pass ends, it fades with its level, and a far one is drawn no smaller than
 * its least apparent size.
 *
 * No headset is needed, so the page is a blank one with the probe (`corona-probe.ts`) added to it
 * rather than the app with the emulated Quest.
 */

const test = base.extend({
  page: async ({ page }, use) => {
    await keepOffline(page);
    await use(page);
  },
});

const EYE: CoronaProbePoint = { x: 0, y: 1.5, z: 0 };
const AHEAD: CoronaProbePoint = { x: 0, y: 1.5, z: -1 };
/** A lamp 0.9 m ahead, at eye height. */
const CLOSE: CoronaProbePoint = { x: 0, y: 1.5, z: -0.9 };
const FIELD_OF_VIEW = 30;
/**
 * One pass of his thinking band, up or down: hologram's SCAN_SECONDS. Written out, as every time here
 * is; the probe says where the band is at each, so a pass of another length fails these rather than
 * passing them by accident.
 */
const PASS_SECONDS = 2.6;

async function openProbe(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.setViewportSize({ width: 640, height: 640 });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: await bundle('corona-probe.ts') });
  return problems;
}

async function draw(page: Page, request: Partial<CoronaDrawRequest>): Promise<CoronaProbeDrawn> {
  const full: CoronaDrawRequest = {
    time: 0.15,
    background: 'black',
    spots: [{ position: CLOSE, level: 1 }],
    eye: EYE,
    target: AHEAD,
    fieldOfView: FIELD_OF_VIEW,
    ...request,
  };
  const drawn = await page.evaluate((asked) => window.__corona?.draw(asked), full);
  if (drawn === undefined) throw new Error('The probe published no hook.');
  return drawn;
}

async function row(page: Page, y: number): Promise<CoronaPixel[]> {
  return (await page.evaluate((at) => window.__corona?.row(at), y)) ?? [];
}

async function photograph(page: Page, testInfo: TestInfo, name: string) {
  await page.locator('#stage').screenshot({ path: testInfo.outputPath(name) });
  await keepPicture(testInfo, name);
}

function luma([red, green, blue]: CoronaPixel): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The brightest pixel of `line` between `from` and `to`, and where it is. */
function brightest(line: CoronaPixel[], from: number, to: number): { at: number; pixel: CoronaPixel } {
  let best = { at: Math.round(from), pixel: line[Math.round(from)] ?? [0, 0, 0] };
  for (let index = Math.round(from); index <= Math.round(to); index++) {
    const pixel = line[index];
    if (pixel !== undefined && luma(pixel) > luma(best.pixel)) best = { at: index, pixel };
  }
  return best;
}

/**
 * The brightest point of the rim near its leftmost point: how far that is from where the rim should
 * be, and what colour. Looked for from just inside the chips, which start at 1.05 of its radius and
 * can be as bright, to well inside the rim.
 */
async function leftRim(page: Page, drawn: CoronaProbeDrawn, spot = 0) {
  const where = drawn.spots[spot];
  if (where === undefined) throw new Error(`No spot ${spot} was drawn.`);
  const line = await row(page, where.leftRim.y);
  const found = brightest(
    line,
    where.leftRim.x - 0.04 * where.radiusPixels,
    where.leftRim.x + 0.15 * where.radiusPixels,
  );
  const middle = (await row(page, where.y))[Math.round(where.x)] ?? [0, 0, 0];
  return { offset: found.at - where.leftRim.x, pixel: found.pixel, middle, where };
}

test('is his warm light, with its middle left clear, over black and over a room', async ({ page }, testInfo) => {
  const problems = await openProbe(page);
  const backgrounds: CoronaBackground[] = ['black', 'grey'];
  for (const background of backgrounds) {
    const drawn = await draw(page, { background });
    await photograph(page, testInfo, `corona-${background}.png`);
    const rim = await leftRim(page, drawn);
    const [red, green, blue] = rim.pixel;
    const { middle } = rim;
    expect(Math.abs(rim.offset), `where the rim is over ${background}`).toBeLessThan(3);
    if (background === 'black') {
      // His red-orange: red well up, green a little over half of it and little blue, as Age of
      // Ultron's close-ups have him — median (160,98,54), R:G:B 1:0.69:0.43 — neither white, nor
      // red, nor the gold the user found too yellow. The corona is lit in his strokes' and halos'
      // paints and follows them: in Vision Quest's gold it measured (150,121,70), green 0.81 and
      // blue 0.47 of red, and back in Age of Ultron's colour (148,83,37), green 0.56 and blue 0.25,
      // so it is held again under the 0.7 and 0.35 the orange was held to before the gold.
      expect(red).toBeGreaterThan(110);
      expect(green / red).toBeGreaterThan(0.45);
      expect(green / red).toBeLessThan(0.7);
      expect(blue / red).toBeLessThan(0.35);
      expect(luma(middle)).toBeLessThan(25);
    } else {
      // Over the grey, the rim is warmer and brighter than the room, and the middle is the room.
      expect(red).toBeGreaterThan(0x8c + 40);
      expect(red - blue).toBeGreaterThan(60);
      expect(green).toBeGreaterThan(blue);
      for (const channel of middle) expect(Math.abs(channel - 0x8c)).toBeLessThan(8);
    }
  }
  expect(problems).toEqual([]);
});

/**
 * The row the band's dashes are drawn along, in pixels from the top, looked for between `from` and
 * `to` rim radii below the middle (up is negative): the row whose bluest pixel across the middle of
 * the disc is the bluest of all. The dashes are his hot strokes' near-white; the halo, the rim and
 * the ticks are orange, with little blue in them, and the band's glow is the halo's colour.
 */
async function bandRow(page: Page, drawn: CoronaProbeDrawn, from: number, to: number): Promise<number> {
  const where = drawn.spots[0];
  if (where === undefined) throw new Error('Nothing was drawn.');
  const top = Math.round(where.y + from * where.radiusPixels);
  const bottom = Math.round(where.y + to * where.radiusPixels);
  const left = Math.round(where.x - 0.5 * where.radiusPixels);
  const right = Math.round(where.x + 0.5 * where.radiusPixels);
  const bluest = await page.evaluate(
    ({ top, bottom, left, right }) => {
      const found: number[] = [];
      for (let y = top; y <= bottom; y++) {
        const line = window.__corona?.row(y) ?? [];
        let most = 0;
        for (let x = left; x <= right; x++) most = Math.max(most, line[x]?.[2] ?? 0);
        found.push(most);
      }
      return found;
    },
    { top, bottom, left, right },
  );
  let best = 0;
  for (let index = 1; index < bluest.length; index++) {
    if ((bluest[index] ?? 0) > (bluest[best] ?? 0)) best = index;
  }
  return top + best;
}

test('glides its band up through the disc and back down, turning inside it', async ({ page }, testInfo) => {
  const problems = await openProbe(page);
  // Halfway below the middle, the middle, and halfway above it on the way up — scanAt is -0.5, 0 and
  // 0.5 a third, a half and two thirds of the way through the first pass — and halfway above, the
  // middle and halfway below on the way back down, at the same points of the second.
  const pass = PASS_SECONDS;
  const rising = [pass / 3, pass / 2, (2 * pass) / 3];
  const falling = rising.map((time) => pass + time);
  const found = new Map<number, number>();
  for (const time of [...rising, ...falling]) {
    const drawn = await draw(page, { time });
    const where = drawn.spots[0];
    if (where === undefined) throw new Error('Nothing was drawn.');
    const at = await bandRow(page, drawn, -0.9, 0.9);
    const expected = where.y - drawn.scanHeight * where.radiusPixels;
    expect(Math.abs(at - expected), `the band at ${time.toFixed(3)} s`).toBeLessThan(0.04 * where.radiusPixels);
    found.set(time, at);
  }
  const heightAt = (time: number) => found.get(time) ?? Number.NaN;
  // Up the picture on the way up, so fewer pixels from the top; down it on the way back.
  expect(heightAt(rising[1])).toBeLessThan(heightAt(rising[0]));
  expect(heightAt(rising[2])).toBeLessThan(heightAt(rising[1]));
  expect(heightAt(falling[1])).toBeGreaterThan(heightAt(falling[0]));
  expect(heightAt(falling[2])).toBeGreaterThan(heightAt(falling[1]));
  // And through the same heights both ways: down through the first pass's points in reverse.
  for (let index = 0; index < rising.length; index++) {
    const back = falling[rising.length - 1 - index];
    expect(Math.abs(heightAt(rising[index]) - heightAt(back)), `at ${index} up and back`).toBeLessThanOrEqual(2);
  }

  // At the top and the bottom of its travel it turns back well inside the rim, where its dashes are
  // still drawn across the disc, rather than leaving it.
  for (const [time, name] of [
    [pass, 'top'],
    [2 * pass, 'bottom'],
  ] as const) {
    const drawn = await draw(page, { time });
    const where = drawn.spots[0];
    if (where === undefined) throw new Error('Nothing was drawn.');
    const at = await bandRow(page, drawn, -0.95, 0.95);
    const expected = where.y - drawn.scanHeight * where.radiusPixels;
    expect(Math.abs(at - expected), `the band at the ${name}`).toBeLessThan(0.04 * where.radiusPixels);
    expect(Math.abs(at - where.y), `the band at the ${name}`).toBeLessThan(0.8 * where.radiusPixels);
    expect(Math.abs(at - where.y), `the band at the ${name}`).toBeGreaterThan(0.7 * where.radiusPixels);
  }
  await draw(page, { time: pass });
  await photograph(page, testInfo, 'corona-turning-black.png');
  await draw(page, { time: pass, background: 'grey' });
  await photograph(page, testInfo, 'corona-turning-grey.png');
  expect(problems).toEqual([]);
});

test('blooms nothing out of its middle as a pass ends: the band is the whole of a thought', async ({ page }) => {
  const problems = await openProbe(page);
  // A ring once bloomed out of the middle over the last 0.55 s of every pass; at 2.325 s it was half
  // way to the rim, 40 levels over what was there before. Now the middle row as a pass ends, with
  // the band near one end of its travel, is lit just as it is as the pass began, with the band as far
  // the other way: the band's light is all there is.
  const pass = PASS_SECONDS;
  for (const [ending, starting] of [
    [pass - 0.275, 0.275],
    [2 * pass - 0.275, pass + 0.275],
  ]) {
    const before = await draw(page, { time: starting });
    const where = before.spots[0];
    if (where === undefined) throw new Error('Nothing was drawn.');
    const from = where.x - 0.9 * where.radiusPixels;
    const to = where.x - 0.1 * where.radiusPixels;
    const startingPeak = brightest(await row(page, where.y), from, to);
    const after = await draw(page, { time: ending });
    expect(Math.abs(after.scanHeight + before.scanHeight)).toBeLessThan(1e-6);
    const endingPeak = brightest(await row(page, where.y), from, to);
    expect(luma(endingPeak.pixel), `the middle as the pass ending at ${ending} s ends`).toBeLessThan(
      luma(startingPeak.pixel) + 3,
    );
  }
  expect(problems).toEqual([]);
});

test('fades with its level, and is never drawn smaller than its least apparent size', async ({ page }) => {
  const problems = await openProbe(page);
  await draw(page, { spots: [{ position: CLOSE, level: 0 }] });
  expect(await page.evaluate(() => window.__corona?.changed(1))).toBe(0);

  const full = await leftRim(page, await draw(page, { spots: [{ position: CLOSE, level: 1 }] }));
  const half = await leftRim(page, await draw(page, { spots: [{ position: CLOSE, level: 0.5 }] }));
  const share = luma(half.pixel) / luma(full.pixel);
  expect(share).toBeGreaterThan(0.4);
  expect(share).toBeLessThan(0.62);

  // Nine metres off, a hand's width would be under a degree across; it is drawn at its least size.
  const far = await draw(page, { spots: [{ position: { x: 0, y: 1.5, z: -9 }, level: 1 }], time: 0.15 });
  const ownSize = (0.13 / (9 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360))) * (far.size / 2);
  const farRim = await leftRim(page, far);
  expect(farRim.where.radiusPixels).toBeGreaterThan(ownSize * 1.3);
  expect(Math.abs(farRim.offset)).toBeLessThan(2.5);
  expect(luma(farRim.pixel)).toBeGreaterThan(40);
  expect(problems).toEqual([]);
});

test('lights several entities about a room at once', async ({ page }, testInfo) => {
  const problems = await openProbe(page);
  const spots = [
    { position: { x: -0.6, y: 1.3, z: -1.6 }, level: 1 },
    { position: { x: 0.8, y: 2.3, z: -3.5 }, level: 1 },
    { position: { x: 0.1, y: 0.9, z: -6 }, level: 1 },
    { position: { x: -1.3, y: 0.8, z: -2.6 }, level: 0.5 },
  ];
  const backgrounds: CoronaBackground[] = ['black', 'grey'];
  for (const background of backgrounds) {
    const drawn = await draw(page, { spots, background, fieldOfView: 60, time: 1.6 });
    await photograph(page, testInfo, `corona-room-${background}.png`);
    for (let index = 0; index < spots.length; index++) {
      const rim = await leftRim(page, drawn, index);
      const [red, , blue] = rim.pixel;
      // Turned to the eye, not to the picture: off to the side, the rim is where the shader puts it.
      expect(Math.abs(rim.offset), `where corona ${index} is over ${background}`).toBeLessThan(4);
      if (background === 'black') {
        // His gold, as above, even the far and the half-lit one. Red less blue was held over 40
        // while he was orange; gold has more blue in it, and the half-lit one measured
        // (67,53,30) when he turned gold — blue 0.45 of red, the others 0.39–0.47.
        expect(red, `corona ${index} over black`).toBeGreaterThan(50);
        expect(blue / red, `corona ${index} over black`).toBeLessThan(0.65);
      } else {
        expect(red - blue, `corona ${index} over grey`).toBeGreaterThan(25);
      }
    }
  }
  expect(problems).toEqual([]);
});
