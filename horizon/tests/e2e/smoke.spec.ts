import type { Page } from '@playwright/test';
import type { JarvisDebugState } from '../../src/debug-hook';
import { DISTANCE_AHEAD_METRES } from '../../src/hologram3d/dimensions';
import { expect, test } from './fixtures';

/**
 * The headset app, end to end, in an emulated living room.
 *
 * Built and served from its real Pages sub-path, entered through the page's own button, and
 * watched through `window.__jarvis`. What this cannot say is whether he looks right — that is
 * what the screenshot it saves is for; what it can say is that the room opens, that he is put
 * where he should be, and that he is alive: drawn every frame, and moving.
 */

/** Enough frames that the arrival is over and the idle motion is well under way. */
const FRAMES_TO_WAIT_FOR = 30;

async function debugState(page: Page): Promise<JarvisDebugState> {
  const state = await page.evaluate(() => window.__jarvis);
  if (state === undefined) throw new Error('The app published no debug state.');
  return state;
}

test('Jarvis appears ahead of you in your room and keeps moving', async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });

  await page.goto('/hey-jarvis/horizon/');
  expect(await page.evaluate(() => window.__xrHarness !== undefined)).toBe(true);
  await page.evaluate(() => window.__xrHarness?.ready);

  const enter = page.getByRole('button', { name: 'Enter your room' });
  await expect(enter).toBeEnabled();
  await enter.click();

  await expect.poll(async () => (await debugState(page)).phase, { timeout: 60000 }).toBe('in-room');
  await expect
    .poll(async () => (await debugState(page)).frames, { timeout: 90000 })
    .toBeGreaterThan(FRAMES_TO_WAIT_FOR);

  const state = await debugState(page);
  testInfo.annotations.push({ type: 'hologram surface', description: String(state.surface) });
  const hologram = state.hologramPosition;
  const head = state.headPositionAtPlacement;
  if (hologram === null || head === null) throw new Error('He was drawn but never placed.');
  // Straight ahead along the floor, at eye height.
  expect(Math.hypot(hologram.x - head.x, hologram.z - head.z)).toBeCloseTo(DISTANCE_AHEAD_METRES, 6);
  expect(hologram.y).toBeCloseTo(head.y, 6);

  // The whole page, so the synthetic room drawn behind the app's canvas is in the picture too.
  const first = await page.screenshot({ fullPage: true });
  await page.waitForTimeout(750);
  const screenshotPath = testInfo.outputPath('milestone-0-room.png');
  const second = await page.screenshot({ fullPage: true, path: screenshotPath });
  await testInfo.attach('milestone-0-room', { path: screenshotPath, contentType: 'image/png' });
  expect(second.equals(first)).toBe(false);

  expect(problems).toEqual([]);
});

test('a room he cannot be drawn in is closed again, and the page says why', async ({ page }) => {
  // CanvasKit's wasm missing from the site, as it was from the phone's first published page.
  await page.route('**/vendor/canvaskit.wasm', (route) => route.fulfill({ status: 404, body: 'Not found' }));

  await page.goto('/hey-jarvis/horizon/');
  await page.evaluate(() => window.__xrHarness?.ready);
  const enter = page.getByRole('button', { name: 'Enter your room' });
  await enter.click();

  await expect.poll(async () => (await debugState(page)).phase, { timeout: 60000 }).toBe('failed');
  await expect(page.getByRole('status')).toContainText('Jarvis could not join you');
  // Back on the page, able to try again, with no session left open on an empty room.
  await expect(enter).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__xrHarness?.device.activeSession !== undefined)).toBe(false);
  expect((await debugState(page)).frames).toBe(0);
});
