import type { Page } from '@playwright/test';
import type { JarvisRoomDebugState } from '../../src/app/room-debug-hook';
import type { JarvisDebugState, RoomPoint } from '../../src/debug-hook';
import { expect, test } from './fixtures';

/**
 * The room's input and its state machine, end to end, with the emulated Quest 3's controllers.
 *
 * The emulator differs from a Quest in one way that matters here: it fires `select` the moment the
 * trigger goes down (before `selectstart`), where a Quest fires it on release. The room reads a
 * `select` with no start as a tap, so a quick press is a tap on both; a held trigger is a tap and
 * then, 0.8 s in, a hold — which during a call is still a hang-up, since a tap does nothing then.
 */

/** hologram's `ELEVENLABS_SETTINGS_STORAGE_KEY`, spelled out: Playwright cannot import hologram's TypeScript. */
const SETTINGS_KEY = 'jarvis.elevenlabs-settings';

/** Where the right controller is held: in front of the chest, below and right of the eyes. */
const HAND = { x: 0.25, y: 1.3, z: 0.95 };

async function room(page: Page): Promise<JarvisRoomDebugState> {
  const state = await page.evaluate(() => window.__jarvisRoom);
  if (state === undefined) throw new Error('The room published no state.');
  return state;
}

async function debugState(page: Page): Promise<JarvisDebugState> {
  const state = await page.evaluate(() => window.__jarvis);
  if (state === undefined) throw new Error('The app published no debug state.');
  return state;
}

async function scene(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__jarvisRoom?.scene);
}

/** Lets `count` more frames be drawn, so the emulator applies a button change and the room reads it. */
async function frames(page: Page, count: number) {
  const start = (await debugState(page)).frames;
  await expect
    .poll(async () => (await debugState(page)).frames, { timeout: 30000 })
    .toBeGreaterThanOrEqual(start + count);
}

/** Holds the right controller at {@link HAND}, pointing at `target` (or straight up, at nothing). */
async function aim(page: Page, target: RoomPoint | 'up') {
  await page.evaluate(
    ({ hand, target }) => {
      const controller = window.__xrHarness?.device.controllers.right;
      if (controller === undefined) throw new Error('The emulated headset has no right controller.');
      const toward =
        target === 'up' ? { x: 0, y: 1, z: 0 } : { x: target.x - hand.x, y: target.y - hand.y, z: target.z - hand.z };
      const length = Math.hypot(toward.x, toward.y, toward.z);
      const direction = { x: toward.x / length, y: toward.y / length, z: toward.z / length };
      // The rotation that turns the controller's −Z onto `direction`: about −Z × direction, by the angle between them.
      const axis = { x: direction.y, y: -direction.x, z: 0 };
      const axisLength = Math.hypot(axis.x, axis.y);
      const angle = Math.acos(Math.max(-1, Math.min(1, -direction.z)));
      const sine = axisLength < 1e-9 ? 0 : Math.sin(angle / 2) / axisLength;
      controller.position.set(hand.x, hand.y, hand.z);
      controller.quaternion.set(axis.x * sine, axis.y * sine, 0, Math.cos(angle / 2));
    },
    { hand: HAND, target },
  );
}

/**
 * Pulls the right trigger and lets it go at once: a tap.
 *
 * Let go from inside the `select` the press causes, so the release lands on the very next frame
 * however slowly frames come. In a headless browser they come slower than one per 0.8 s at times,
 * and a trigger held for even two of them would be a hold.
 */
async function tap(page: Page) {
  await page.evaluate(() => {
    const device = window.__xrHarness?.device;
    const trigger = device?.controllers.right;
    device?.activeSession?.addEventListener('select', () => trigger?.updateButtonValue('trigger', 0), { once: true });
    trigger?.updateButtonValue('trigger', 1);
  });
  await frames(page, 3);
}

/** Presses B and lets it go again: an edge the room reads from the gamepad, whatever the frame rate. */
async function pressB(page: Page) {
  await page.evaluate(() => window.__xrHarness?.device.controllers.right?.updateButtonValue('b-button', 1));
  await frames(page, 2);
  await page.evaluate(() => window.__xrHarness?.device.controllers.right?.updateButtonValue('b-button', 0));
  await frames(page, 2);
}

async function hologramPosition(page: Page): Promise<RoomPoint> {
  const position = (await debugState(page)).hologramPosition;
  if (position === null) throw new Error('He was never placed.');
  return position;
}

async function enterTheRoom(page: Page) {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, JSON.stringify({ apiKey: 'sk_room_test', agentId: 'agent_room_test' }));
  }, SETTINGS_KEY);
  await page.goto('/hey-jarvis/horizon/');
  await page.evaluate(() => window.__xrHarness?.ready);
  await page.getByRole('button', { name: 'Enter your room' }).click();
  // No wake engine yet, so entering the room summons him straight away.
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('present:idle');
}

test('sample mode walks every mood on a select on him, and leaves on a select anywhere else', async ({ page }) => {
  await page.goto('/hey-jarvis/horizon/');
  await page.evaluate(() => window.__xrHarness?.ready);
  // No key and no microphone asked for.
  await page.getByRole('button', { name: 'Try him in your room' }).click();
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('sample:speaking');
  expect((await room(page)).view.panels.readout).toEqual([]);

  await aim(page, await hologramPosition(page));
  for (const [mode, name] of [
    ['listening', 'Listening'],
    ['thinking', 'Thinking'],
    ['idle', 'Idle'],
    ['speaking', 'Speaking'],
  ] as const) {
    await tap(page);
    await expect.poll(() => scene(page)).toBe(`sample:${mode}`);
    // The name is only up for a moment, which can be over before the next frame here; its effect stays.
    expect((await room(page)).recentEffects).toContain(`show-panel toast: ${name}`);
  }

  await aim(page, 'up');
  await tap(page);
  // He leaves, and then the room closes and the page is back.
  await expect.poll(async () => (await debugState(page)).phase, { timeout: 30000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => window.__xrHarness?.device.activeSession !== undefined)).toBe(false);
  expect((await room(page)).recentEffects).toContain('exit-xr');
  await expect(page.getByRole('button', { name: 'Try him in your room' })).toBeEnabled();
});

test('B sends him away, a select summons him again, and holding the trigger hangs up', async ({ page }) => {
  await enterTheRoom(page);
  expect((await room(page)).view.hologram).toBe('shown');

  await pressB(page);
  await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
  const waiting = await room(page);
  expect(waiting.view.hologram).toBe('hidden');
  expect(waiting.view.frameRate).toBe('lowest');
  expect(waiting.recentEffects).toEqual(expect.arrayContaining(['hang-up', 'hologram leaving', 'hologram hidden']));
  // No wake engine, so there is neither a hint nor a status line to show.
  expect(waiting.view.panels.hint).toBeNull();
  expect(waiting.view.panels.status).toBeNull();

  // Summoned along the controller's ray: pointing straight ahead puts him straight ahead.
  await aim(page, { x: HAND.x, y: HAND.y, z: HAND.z - 2 });
  await tap(page);
  await expect.poll(() => scene(page), { timeout: 30000 }).toBe('present:idle');
  const summoned = await room(page);
  expect(summoned.view.frameRate).toBe('highest');
  expect(summoned.recentEffects.slice(-6)).toEqual(expect.arrayContaining(['arrive', 'summon', 'hologram shown']));
  const head = (await debugState(page)).headPositionAtPlacement;
  const position = await hologramPosition(page);
  if (head === null) throw new Error('No head was recorded at placement.');
  expect(position.x).toBeCloseTo(head.x, 3);
  expect(head.z - position.z).toBeCloseTo(1.6, 3);

  // A tap during a call does nothing; a hold hangs up.
  await tap(page);
  expect(await scene(page)).toBe('present:idle');
  await page.evaluate(() => window.__xrHarness?.device.controllers.right?.updateButtonValue('trigger', 1));
  await expect.poll(() => scene(page), { timeout: 30000 }).not.toBe('present:idle');
  await page.evaluate(() => window.__xrHarness?.device.controllers.right?.updateButtonValue('trigger', 0));
  await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
});

test('blurred ignores the buttons; hidden sends him away quietly', async ({ page }) => {
  await enterTheRoom(page);

  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('visible-blurred'));
  await expect.poll(async () => (await room(page)).recentEffects.length).toBeGreaterThan(0);
  await pressB(page);
  expect(await scene(page)).toBe('present:idle');

  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('hidden'));
  await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
  const hidden = await room(page);
  expect(hidden.view.hologram).toBe('hidden');
  expect(hidden.recentEffects).toContain('end-quietly');

  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('visible'));
  await frames(page, 3);
  expect(await scene(page)).toBe('waiting');
});
