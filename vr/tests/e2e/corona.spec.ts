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
 * The pictures are for a person to judge whether it reads as his light — warm, a ring and a scan —
 * over black and over a room. The measurements hold the parts of that a regression would break: the
 * colour is his amber and not white or red, the middle is left clear, the band travels up through
 * it on his thinking scan's time, the bloom comes at the end of each pass, it fades with its level,
 * and a far one is drawn no smaller than its least apparent size.
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

async function column(page: Page, x: number): Promise<CoronaPixel[]> {
  return (await page.evaluate((at) => window.__corona?.column(at), x)) ?? [];
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
      // Amber: red well up, green about half of it, little blue — neither white nor red.
      expect(red).toBeGreaterThan(110);
      expect(green / red).toBeGreaterThan(0.3);
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

test('sweeps its scan up through the disc, and blooms as each pass ends', async ({ page }, testInfo) => {
  const problems = await openProbe(page);
  // A third of the way below the middle, the middle, and a third above it, on his scan's time.
  const heights: number[] = [];
  for (const time of [0.848, 1.3, 1.752]) {
    const drawn = await draw(page, { time });
    const where = drawn.spots[0];
    if (where === undefined) throw new Error('Nothing was drawn.');
    const line = await column(page, where.x);
    const found = brightest(line, where.y - 0.6 * where.radiusPixels, where.y + 0.6 * where.radiusPixels);
    const expected = where.y - drawn.scanHeight * where.radiusPixels;
    expect(Math.abs(found.at - expected), `the band at ${time} s`).toBeLessThan(0.08 * where.radiusPixels);
    heights.push(found.at);
  }
  expect(heights[1]).toBeLessThan(heights[0] ?? 0);
  expect(heights[2]).toBeLessThan(heights[1] ?? 0);

  const quiet = await draw(page, { time: 1.3 });
  const bloomTime = 2.325;
  const blooming = await draw(page, { time: bloomTime });
  if (blooming.bloomRadius === null) throw new Error(`No bloom at ${bloomTime} s.`);
  expect(quiet.bloomRadius).toBeNull();
  const where = blooming.spots[0];
  if (where === undefined) throw new Error('Nothing was drawn.');
  const at = where.x - blooming.bloomRadius * where.radiusPixels;
  const bloomLine = await row(page, where.y);
  const bloomPeak = brightest(bloomLine, at - 3, at + 3);
  await photograph(page, testInfo, 'corona-bloom-black.png');
  await draw(page, { time: 1.3 });
  const quietLine = await row(page, where.y);
  const quietPeak = brightest(quietLine, at - 3, at + 3);
  expect(luma(bloomPeak.pixel)).toBeGreaterThan(luma(quietPeak.pixel) + 40);
  await draw(page, { time: bloomTime, background: 'grey' });
  await photograph(page, testInfo, 'corona-bloom-grey.png');
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
      expect(red - blue, `corona ${index} over ${background}`).toBeGreaterThan(background === 'black' ? 40 : 25);
    }
  }
  expect(problems).toEqual([]);
});
