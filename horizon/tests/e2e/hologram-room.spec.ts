import type { Page } from '@playwright/test';
import { DISTANCE_AHEAD_METRES } from '../../src/hologram3d/dimensions';
import type { PreviewPhase, RoomStatus } from '../../src/preview/preview-hook';
import { expect, photograph, ROOM_PICTURE_VIEWPORT, test } from './fixtures';

/**
 * The volumetric hologram in the emulated Quest 3's living room, from the preview page's room mode.
 *
 * The same session the app opens — immersive-ar, local-floor — with the hologram 1.6 m ahead of
 * the head, going through a few phases while the synthetic room is drawn behind him. The pictures
 * are for looking at; the frame times are the emulator's, drawn by SwiftShader on a CPU, and say
 * nothing about a Quest's.
 */

/**
 * The phases shown, and the moment of each whose voices he is held at for the picture: the
 * emulator's frames come most of a second apart, too far apart to catch a moment in passing.
 */
const PHASES: [PreviewPhase, number][] = [
  ['greeting', 1.8],
  ['listening', 1.4],
  ['thinking', 1.9],
];

async function roomStatus(page: Page): Promise<RoomStatus> {
  const status = await page.evaluate(() => window.__hologramPreview?.room);
  if (status === undefined) throw new Error('The preview published no hook.');
  return status;
}

function median(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

test('in the emulated living room, 1.6 m ahead, through three phases', async ({ page }, testInfo) => {
  test.setTimeout(600000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  // Larger than the default, since the emulator draws the room at the window's size and he is a
  // head's width across at 1.6 m.
  await page.setViewportSize(ROOM_PICTURE_VIEWPORT);
  await page.goto('/hey-jarvis/horizon/preview.html');
  await page.evaluate(() => window.__xrHarness?.ready);
  await page.evaluate(() => window.__hologramPreview?.ready);

  const enter = page.getByRole('button', { name: 'Enter your room' });
  await expect(enter).toBeEnabled();
  await enter.click();
  await expect.poll(async () => (await roomStatus(page)).entered, { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await roomStatus(page)).frames, { timeout: 90000 }).toBeGreaterThan(5);

  const { placedAt, headAtPlacement } = await roomStatus(page);
  if (placedAt === null || headAtPlacement === null) throw new Error('He was drawn but never placed.');
  // Straight ahead along the floor, at eye height.
  expect(Math.hypot(placedAt.x - headAtPlacement.x, placedAt.z - headAtPlacement.z)).toBeCloseTo(
    DISTANCE_AHEAD_METRES,
    6,
  );
  expect(placedAt.y).toBeCloseTo(headAtPlacement.y, 6);

  for (const [phase, seconds] of PHASES) {
    await page.evaluate(([next, holdAt]) => window.__hologramPreview?.setRoomPhase(next, holdAt), [
      phase,
      seconds,
    ] as const);
    await expect
      .poll(async () => (await roomStatus(page)).secondsIntoPhase, { timeout: 120000 })
      .toBeGreaterThanOrEqual(seconds);
    // A few frames more at that moment, so what eases toward it — the lattice, the thought — is there.
    const settledAt = (await roomStatus(page)).frames + 3;
    await expect
      .poll(async () => (await roomStatus(page)).frames, { timeout: 60000 })
      .toBeGreaterThanOrEqual(settledAt);
    await photograph(page, testInfo, `room-${phase}.png`);
    // Closer in on him: the middle of the view, where he stands, half the view high.
    const side = ROOM_PICTURE_VIEWPORT.height / 2;
    await photograph(page, testInfo, `room-${phase}-close.png`, {
      x: (ROOM_PICTURE_VIEWPORT.width - side) / 2,
      y: (ROOM_PICTURE_VIEWPORT.height - side) / 2,
      width: side,
      height: side,
    });
  }

  const { intervals, updates, canvasKit, frames } = await roomStatus(page);
  const timings = [
    `${frames} frames`,
    `median interval ${median(intervals).toFixed(1)} ms`,
    `median update ${median(updates).toFixed(1)} ms (CanvasKit ${median(canvasKit).toFixed(1)} ms)`,
  ].join(', ');
  testInfo.annotations.push({ type: 'emulator frame times (SwiftShader, not a Quest)', description: timings });
  console.log(`Emulator frame times (SwiftShader on a CPU, not a Quest): ${timings}`);
  expect(problems).toEqual([]);
});
