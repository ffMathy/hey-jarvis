import {
  aim,
  answerTokens,
  collectProblems,
  countGreetings,
  debugState,
  effectsSince,
  enterRoom,
  frames,
  greetingPlays,
  HAND,
  hologramPosition,
  insideLivingRoom,
  lengthenTheGreeting,
  photographError,
  pressB,
  roomReport,
  scene,
  tap,
  trigger,
  untilListening,
  withSavedSettings,
} from './app-driver';
import { expect, photograph, test } from './fixtures';

/**
 * The whole app in the emulated Quest 3's living room: the real page, the wake engine listening to
 * Chromium's fake microphone, the room model placing him, the 3D hologram, and the ElevenLabs
 * session — with ElevenLabs answered from here and LiveKit's socket closed by the fixture, so no
 * summon ever connects. What a summon does up to that point, and how every way it ends is handled,
 * is what this checks; `app-wake-word.spec.ts` does it again summoned by a spoken "hey jarvis".
 *
 * The pictures are for looking at: the emulator draws the room with SwiftShader, a frame or two a
 * second, so they say how he looks in a room, not how fast.
 */

/** hologram's `describeFailure` for a 401, the phone's words for a key ElevenLabs refused. */
const REJECTED_KEY = 'ElevenLabs rejected the API key. Check it in the settings.';

test('a page opened to be filmed shows sample mode without its frame-rate readout', async ({ page }) => {
  const problems = collectProblems(page);
  // What the demo video's renderer opens (`.scripts/render-demo.ts`).
  await page.goto('/hey-jarvis/horizon/?film');
  await page.evaluate(() => window.__xrHarness?.ready);
  await page.getByRole('button', { name: 'Try him in your room' }).click();
  await expect.poll(() => scene(page), { timeout: 90000 }).toBe('sample:speaking');
  await frames(page, 2);
  const report = await roomReport(page);
  expect(report.view.panels.readout).toBeNull();
  expect(report.view.hologram).toBe('shown');
  expect(problems).toEqual([]);
});

test('sample mode walks every mood in the room on a select on him, and leaves on a select anywhere else', async ({
  page,
}, testInfo) => {
  const problems = collectProblems(page);
  await page.goto('/hey-jarvis/horizon/');
  await page.evaluate(() => window.__xrHarness?.ready);
  // No key and no microphone asked for.
  await page.getByRole('button', { name: 'Try him in your room' }).click();
  await expect.poll(() => scene(page), { timeout: 90000 }).toBe('sample:speaking');
  expect((await roomReport(page)).view.panels.readout).toEqual([]);
  const spot = await hologramPosition(page);
  expect(insideLivingRoom(spot)).toBe(true);

  await frames(page, 12);
  const pictures = [await photograph(page, testInfo, 'app-sample-speaking.png')];
  await aim(page, spot);
  for (const [mode, name] of [
    ['listening', 'Listening'],
    ['thinking', 'Thinking'],
    ['idle', 'Idle'],
    ['speaking', 'Speaking'],
  ] as const) {
    await tap(page);
    await expect.poll(() => scene(page)).toBe(`sample:${mode}`);
    // The name is only up for a moment, which can be over before the next frame here; its effect stays.
    expect((await roomReport(page)).recentEffects).toContain(`show-panel toast: ${name}`);
    if (mode !== 'speaking') {
      // Long enough for what eases towards the mood — the lattice, the thought — to be there.
      await frames(page, 12);
      pictures.push(await photograph(page, testInfo, `app-sample-${mode}.png`));
    }
  }
  // Every mood looks different from the others.
  for (const [index, picture] of pictures.entries()) {
    for (const other of pictures.slice(index + 1)) expect(picture.equals(other)).toBe(false);
  }

  await aim(page, 'up');
  await tap(page);
  // He leaves, and then the room closes and the page is back.
  await expect.poll(async () => (await debugState(page)).phase, { timeout: 60000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => window.__xrHarness?.device.activeSession !== undefined)).toBe(false);
  expect((await roomReport(page)).recentEffects).toContain('exit-xr');
  await expect(page.getByRole('button', { name: 'Try him in your room' })).toBeEnabled();
  expect(problems).toEqual([]);
});

test('a select summons him; a key ElevenLabs rejects is said on a panel, and the wake word is armed again', async ({
  page,
}, testInfo) => {
  const problems = collectProblems(page);
  const requests = await answerTokens(page, { status: 401, body: { detail: { status: 'invalid_api_key' } } });
  await countGreetings(page);
  await withSavedSettings(page);
  await enterRoom(page);
  await untilListening(page);
  const waiting = await roomReport(page);
  expect(waiting.view.panels.hint).toEqual(['Say “Hey Jarvis”', 'or pinch / pull the trigger']);
  expect(waiting.view.wakeArmed).toBe(true);
  expect(waiting.view.hologram).toBe('hidden');
  await photograph(page, testInfo, 'app-waiting.png');

  // Summoned along the controller's ray, straight ahead.
  await aim(page, { x: HAND.x, y: HAND.y, z: HAND.z - 2 });
  await tap(page);
  await expect.poll(() => scene(page), { timeout: 60000, intervals: [100] }).toBe('failed');
  const failed = await roomReport(page);
  const photographed = await photographError(page, testInfo, 'app-error-rejected-key.png', async () => {
    await expect.poll(() => scene(page), { timeout: 60000 }).toBe('waiting');
    await tap(page);
  });
  expect(photographed).toEqual([REJECTED_KEY]);
  expect(failed.view.panels.error).toEqual([REJECTED_KEY]);
  expect(failed.view.hologram).toBe('shown');
  expect(failed.view.wakeArmed).toBe(false);
  expect(failed.recentEffects).toEqual(expect.arrayContaining(['arrive', 'summon', 'remember-problem']));
  expect(new Set(requests.map((request) => request.url.searchParams.get('participant_name')))).toEqual(
    new Set(['jarvis-horizon']),
  );
  expect(new Set(requests.map((request) => request.apiKey))).toEqual(new Set(['sk_room_test']));
  // One greeting for every summon, however many it took to photograph the panel.
  expect(await greetingPlays(page)).toBe(requests.length);
  const spot = await hologramPosition(page);
  const head = (await debugState(page)).headPositionAtPlacement;
  if (head === null) throw new Error('No head was recorded at placement.');
  expect(insideLivingRoom(spot)).toBe(true);
  expect(spot.z).toBeLessThan(head.z - 0.8);

  // Up for as long as it takes to read, then he leaves and the room listens again.
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('waiting');
  const listening = await roomReport(page);
  expect(listening.view.wakeArmed).toBe(true);
  expect(listening.view.panels.error).toBeNull();
  expect(listening.recentEffects).toEqual(expect.arrayContaining(['hologram leaving', 'hologram hidden', 'arm-wake']));
  // The hint only teaches: once he has been summoned it is not shown again.
  expect(listening.view.panels.hint).toBeNull();
  expect(problems).toEqual([]);
});

test('holding the trigger while he greets you hangs up, and stops the greeting', async ({ page }, testInfo) => {
  const problems = collectProblems(page);
  // Never answered, so he is still greeting — not failing — when he is dismissed.
  await answerTokens(page, 'never');
  await lengthenTheGreeting(page);
  await countGreetings(page);
  await withSavedSettings(page);
  await enterRoom(page);
  await untilListening(page);

  await aim(page, { x: HAND.x, y: HAND.y, z: HAND.z - 2 });
  await tap(page);
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('present:greeting');
  // Most of the way through the arrival, well into the greeting — and within the twenty seconds
  // the session waits for a token, which here never comes: the emulator draws him about a frame
  // and a half a second, and his clock moves at most a tenth of a second a frame.
  await frames(page, 8);
  expect(await scene(page)).toBe('present:greeting');
  expect(await greetingPlays(page)).toBe(1);
  await photograph(page, testInfo, 'app-greeting.png');
  expect(await scene(page)).toBe('present:greeting');

  // Held until the hold is read — a tap first, since the emulator fires select on the press.
  await trigger(page, 1);
  await expect.poll(async () => (await roomReport(page)).recentEffects, { timeout: 30000 }).toContain('hang-up');
  await trigger(page, 0);
  expect(effectsSince((await roomReport(page)).recentEffects, 'summon')).not.toContain('remember-problem');
  expect(await page.evaluate(() => window.__greeting?.element?.paused)).toBe(true);
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('waiting');
  await expect.poll(async () => (await roomReport(page)).view.wakeArmed, { timeout: 30000 }).toBe(true);
  expect(problems).toEqual([]);
});

test('B sends him away; blurred ignores the buttons; hidden ends the call quietly', async ({ page }, testInfo) => {
  const problems = collectProblems(page);
  await answerTokens(page, 'never');
  await withSavedSettings(page);
  await enterRoom(page);
  await untilListening(page);

  await aim(page, { x: HAND.x, y: HAND.y, z: HAND.z - 2 });
  await tap(page);
  await expect.poll(() => scene(page), { timeout: 60000 }).toMatch(/^present:/);
  await photograph(page, testInfo, 'app-arriving.png');
  expect((await roomReport(page)).view.frameRate).toBe('highest');

  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('visible-blurred'));
  await pressB(page);
  expect(await scene(page)).toMatch(/^present:/);
  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('visible'));

  await pressB(page);
  await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
  const waiting = await roomReport(page);
  expect(waiting.view.hologram).toBe('hidden');
  expect(waiting.view.frameRate).toBe('lowest');
  expect(waiting.recentEffects).toEqual(expect.arrayContaining(['hang-up', 'hologram leaving', 'hologram hidden']));

  await tap(page);
  await expect.poll(() => scene(page), { timeout: 60000 }).toMatch(/^present:/);
  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('hidden'));
  await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
  const hidden = await roomReport(page);
  expect(hidden.view.hologram).toBe('hidden');
  expect(hidden.view.wakeArmed).toBe(false);
  expect(hidden.recentEffects).toContain('end-quietly');

  // Back in view, the wake engine is asked how it is before it is armed again.
  await page.evaluate(() => window.__xrHarness?.device.updateVisibilityState('visible'));
  await expect.poll(async () => (await roomReport(page)).view.wakeArmed, { timeout: 30000 }).toBe(true);
  expect(await scene(page)).toBe('waiting');
  expect(problems).toEqual([]);
});
