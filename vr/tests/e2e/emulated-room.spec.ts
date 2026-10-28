import type { Page } from '@playwright/test';
import { expect, photograph, ROOM_PICTURE_VIEWPORT, test } from './fixtures';
import type { Bounds } from './room/furnishings';

/**
 * The room the emulated headset stands in, furnished (`room/furnished-environment.ts`).
 *
 * The other specs photograph Jarvis in front of it; this one checks the room itself: that it is
 * furnished from exactly what the emulator reports — every wall, window and picture, and a piece of
 * furniture inside each furniture box, never out of it, where the app would think there was space —
 * and that what is drawn is a room in colour, not the capture's flat grey scan.
 */

/** How far a model may stand out of its capture box: a few centimetres of a model's rounding. */
const FITTING_TOLERANCE_METRES = 0.03;

function inside(fitted: Bounds, capture: Bounds) {
  return [0, 1, 2].every(
    (axis) =>
      (fitted.min[axis] ?? 0) >= (capture.min[axis] ?? 0) - FITTING_TOLERANCE_METRES &&
      (fitted.max[axis] ?? 0) <= (capture.max[axis] ?? 0) + FITTING_TOLERANCE_METRES,
  );
}

/** Opens an immersive session beside the page's own, so the emulator draws its room, and waits a few frames. */
async function lookAtTheRoom(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const context = canvas.getContext('webgl2', { xrCompatible: true });
    if (context === null || navigator.xr === undefined) throw new Error('No WebGL 2 or WebXR here.');
    const session = await navigator.xr.requestSession('immersive-ar');
    await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, context) });
    await new Promise<void>((settled) => {
      let frames = 0;
      const frame = () => {
        frames += 1;
        if (frames >= 3) settled();
        else session.requestAnimationFrame(frame);
      };
      session.requestAnimationFrame(frame);
    });
  });
}

/** How colourful and how varied a picture is: its mean chroma and the spread of its luma, both in levels. */
async function pictureStatistics(page: Page, picture: Buffer) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No 2D context to read the picture with.');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let chroma = 0;
    let luma = 0;
    let lumaSquared = 0;
    const pixels = data.length / 4;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      chroma += Math.max(red, green, blue) - Math.min(red, green, blue);
      const level = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      luma += level;
      lumaSquared += level * level;
    }
    const meanLuma = luma / pixels;
    return { chroma: chroma / pixels, lumaSpread: Math.sqrt(lumaSquared / pixels - meanLuma * meanLuma) };
  }, picture.toString('base64'));
}

test('furnishes the emulated living room from what the emulator reports', async ({ page }, testInfo) => {
  await page.setViewportSize(ROOM_PICTURE_VIEWPORT);
  await page.goto('/hey-jarvis/vr/');
  await page.evaluate(() => window.__xrHarness?.ready);
  const report = await page.evaluate(() => window.__xrHarness?.environment.furnishings);
  if (report === undefined) throw new Error('The room was never furnished.');

  // Every wall, the floor and the ceiling; both windows; both pieces of wall art.
  expect(report.surfaces).toEqual({ wall: 6, floor: 1, ceiling: 1 });
  expect(report.windows).toBe(2);
  expect(report.prints).toBe(2);

  // A piece in every furniture box, chosen by its label and size, and none standing out of its box.
  expect(report.furniture.map(({ label, piece }) => `${label}: ${piece}`).sort()).toEqual([
    'couch: Sofa_01',
    'lamp: lamp',
    'lamp: lamp',
    'shelf: wooden_display_shelves_01',
    'table: gallinera_table',
    'table: modern_coffee_table_01',
    'table: wooden_table_02',
    'table: wooden_table_02',
  ]);
  for (const { label, piece, fitted, capture } of report.furniture) {
    expect(inside(fitted, capture), `${piece} stands inside its ${label} box`).toBe(true);
  }

  await lookAtTheRoom(page);
  const picture = await photograph(page, testInfo, 'emulated-room.png');
  const { chroma, lumaSpread } = await pictureStatistics(page, picture);
  testInfo.annotations.push({
    type: 'the room in the picture',
    description: `mean chroma ${chroma.toFixed(1)}, luma spread ${lumaSpread.toFixed(1)} levels`,
  });
  // The capture's scan, drawn as it is, is grey: a chroma of nothing. Wood, paint and a park are not.
  expect(chroma).toBeGreaterThan(20);
  expect(lumaSpread).toBeGreaterThan(20);
});
