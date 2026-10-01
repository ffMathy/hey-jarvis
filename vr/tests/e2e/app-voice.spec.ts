import type { Page } from '@playwright/test';
import type { RoomPoint, VoiceReport } from '../../src/debug-hook';
import {
  aim,
  answerTokens,
  appPage,
  collectProblems,
  countGreetings,
  debugState,
  enterRoom,
  frames,
  greetingPlays,
  HAND,
  hologramPosition,
  lengthenTheGreeting,
  pressB,
  scene,
  tap,
  untilListening,
  withSavedSettings,
} from './app-driver';
import type { ElementVolumeProbeResult } from './element-volume-probe';
import { bundle, expect, test } from './fixtures';

/**
 * His voice from where he stands, in the emulated Quest 3's living room.
 *
 * What can be heard offline is the greeting: ElevenLabs and LiveKit are out of reach here, so no
 * summon ever connects and his live track is never played — its fan-out into the panner, the SDK's
 * element at volume 0 during a call and the echo signs are the unit tests' (`spatial-voice.spec.ts`
 * and its neighbours), and the element rule is checked on real elements by
 * `element-volume-probe.ts`. What is checked here is the rest of the way, in a real browser: the
 * wake word's microphone probed, the route chosen, the greeting taken into Web Audio and played
 * through an HRTF panner at his anchor, the listener following the emulated head, the page's
 * setting, and a stopped AudioContext moving him back to the headset.
 *
 * Chromium's fake microphone on Linux offers no platform echo canceller, which is the truth about a
 * desktop; the specs that want one say so by adding `'all'` to what the track offers, which is what
 * Quest Browser reports when the headset has one.
 *
 * Every spec that summons him keeps him greeting the same way: the token is never answered, the
 * page holds the session's deadline open (`deadline=never`, see `appPage`), and the greeting is
 * served longer than the test (`lengthenTheGreeting`). Both budgets run on the wall clock, which
 * the emulator's frames, a second or more apart, used to lose the race against.
 */

declare global {
  interface Window {
    /** What the page built in Web Audio, recorded by {@link recordAudio}. */
    __voiceProbe?: { panners: PannerNode[]; contexts: AudioContext[]; taken: HTMLMediaElement[] };
  }
}

/** The page's own key for "His voice from where he stands", spelled out as the spec cannot import the page. */
const VOICE_SETTING_KEY = 'jarvis.horizon.voice-from-where-he-stands';

/** How near the panner and the listener have to come to where they were sent, in metres. */
const NEAR_METRES = 0.05;

/**
 * Records every panner the page makes, with its context, and every element it takes into Web
 * Audio; and, with `platformEchoCanceller`, makes the microphone offer the mode only a headset's
 * own echo canceller offers.
 */
async function recordAudio(page: Page, { platformEchoCanceller }: { platformEchoCanceller: boolean }) {
  await page.addInitScript((offerAll: boolean) => {
    const probe: NonNullable<Window['__voiceProbe']> = { panners: [], contexts: [], taken: [] };
    window.__voiceProbe = probe;
    const createPanner = BaseAudioContext.prototype.createPanner;
    BaseAudioContext.prototype.createPanner = function (this: BaseAudioContext) {
      const panner = createPanner.call(this);
      probe.panners.push(panner);
      if (this instanceof AudioContext) probe.contexts.push(this);
      return panner;
    };
    const createMediaElementSource = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (this: AudioContext, element: HTMLMediaElement) {
      probe.taken.push(element);
      return createMediaElementSource.call(this, element);
    };
    if (!offerAll) return;
    const getCapabilities = MediaStreamTrack.prototype.getCapabilities;
    MediaStreamTrack.prototype.getCapabilities = function (this: MediaStreamTrack) {
      const capabilities = getCapabilities.call(this);
      return this.kind === 'audio' ? { ...capabilities, echoCancellation: [true, false, 'all'] } : capabilities;
    };
  }, platformEchoCanceller);
}

async function voiceReport(page: Page): Promise<VoiceReport> {
  const voice = (await debugState(page)).voice;
  if (voice === null) throw new Error('No conversation room has been opened.');
  return voice;
}

/** The first panner the page made — his — as its settings and where it is now. */
async function panner(page: Page) {
  return page.evaluate(() => {
    const made = window.__voiceProbe?.panners[0];
    if (made === undefined) return undefined;
    return {
      panningModel: made.panningModel,
      distanceModel: made.distanceModel,
      position: { x: made.positionX.value, y: made.positionY.value, z: made.positionZ.value },
    };
  });
}

/** Where the listener of the panner's context is, and which way it faces. */
async function listener(page: Page) {
  return page.evaluate(() => {
    const context = window.__voiceProbe?.contexts[0];
    if (context === undefined) return undefined;
    const { listener: heard } = context;
    return {
      position: { x: heard.positionX.value, y: heard.positionY.value, z: heard.positionZ.value },
      forward: { x: heard.forwardX.value, y: heard.forwardY.value, z: heard.forwardZ.value },
      state: context.state,
    };
  });
}

function distance(one: RoomPoint, other: RoomPoint): number {
  return Math.hypot(one.x - other.x, one.y - other.y, one.z - other.z);
}

/** Where the emulated head is. */
async function head(page: Page): Promise<RoomPoint> {
  return page.evaluate(() => {
    const position = window.__xrHarness?.device.position;
    if (position === undefined) throw new Error('The emulated headset is not there.');
    return { x: position.x, y: position.y, z: position.z };
  });
}

/** Summons him straight ahead, and waits until he greets: on a page holding the deadline, with the greeting lengthened. */
async function summonAhead(page: Page) {
  await aim(page, { x: HAND.x, y: HAND.y, z: HAND.z - 2 });
  await tap(page);
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('present:greeting');
}

test('he greets from where he stands: through an HRTF panner at his anchor, heard from the head', async ({ page }) => {
  const problems = collectProblems(page);
  // Never answered, so he is still greeting — not failing — while he is listened to.
  await answerTokens(page, 'never');
  await lengthenTheGreeting(page);
  await countGreetings(page);
  await recordAudio(page, { platformEchoCanceller: true });
  await withSavedSettings(page);
  await enterRoom(page, appPage('deadline=never'));
  await untilListening(page);

  expect(await voiceReport(page)).toMatchObject({
    route: 'spatial',
    tier: 'spatial',
    reason: 'platform-echo-canceller',
    echoCanceller: 'platform',
    setting: true,
    forced: false,
    greeting: 'element',
  });
  // Nothing is built until he first speaks.
  expect(await page.evaluate(() => window.__voiceProbe?.panners.length)).toBe(0);

  await summonAhead(page);
  await expect.poll(async () => (await panner(page))?.panningModel, { timeout: 30000 }).toBe('HRTF');
  expect(await greetingPlays(page)).toBe(1);
  // The greeting's own element, taken into Web Audio, and only once.
  expect(
    await page.evaluate(() => window.__voiceProbe?.taken.map((element) => element === window.__greeting?.element)),
  ).toEqual([true]);
  expect((await panner(page))?.distanceModel).toBe('inverse');
  expect((await voiceReport(page)).greeting).toBe('spatial');

  // At his anchor, and at the head.
  const him = await hologramPosition(page);
  await expect
    .poll(async () => distance((await panner(page))?.position ?? { x: 99, y: 99, z: 99 }, him), { timeout: 30000 })
    .toBeLessThan(NEAR_METRES);
  const standing = await head(page);
  await expect
    .poll(async () => distance((await listener(page))?.position ?? { x: 99, y: 99, z: 99 }, standing), {
      timeout: 30000,
    })
    .toBeLessThan(NEAR_METRES);
  expect((await listener(page))?.forward.z).toBeCloseTo(-1, 1);

  // A step to the right and a quarter turn to the left: the listener goes with the head.
  const stepped = { x: standing.x + 0.5, y: standing.y, z: standing.z };
  await page.evaluate((to) => {
    const device = window.__xrHarness?.device;
    device?.position.set(to.x, to.y, to.z);
    device?.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
  }, stepped);
  await frames(page, 3);
  await expect
    .poll(async () => distance((await listener(page))?.position ?? { x: 99, y: 99, z: 99 }, stepped), {
      timeout: 30000,
    })
    .toBeLessThan(NEAR_METRES);
  await expect.poll(async () => (await listener(page))?.forward.x, { timeout: 30000 }).toBeLessThan(-0.95);
  expect(await scene(page)).toBe('present:greeting');
  const reported = await voiceReport(page);
  expect(distance(reported.listener ?? { x: 99, y: 99, z: 99 }, stepped)).toBeLessThan(NEAR_METRES);
  expect(distance(reported.speaker ?? { x: 99, y: 99, z: 99 }, him)).toBeLessThan(NEAR_METRES);
  expect(problems).toEqual([]);
});

test('a stopped AudioContext moves him back to the headset, and a greeting it would silence is not played', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await answerTokens(page, 'never');
  await lengthenTheGreeting(page);
  await countGreetings(page);
  await recordAudio(page, { platformEchoCanceller: true });
  await withSavedSettings(page);
  await enterRoom(page, appPage('deadline=never'));
  await untilListening(page);

  await summonAhead(page);
  await expect.poll(async () => (await voiceReport(page)).greeting, { timeout: 30000 }).toBe('spatial');
  await pressB(page);
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('waiting');

  await page.evaluate(() => window.__voiceProbe?.contexts[0]?.suspend());
  await expect.poll(async () => (await voiceReport(page)).reason, { timeout: 30000 }).toBe('context-not-running');
  expect(await voiceReport(page)).toMatchObject({ route: 'element', tier: 'element', greeting: 'dry' });

  // Summoned again: the greeting was taken into a context that has stopped, so it would be played
  // into silence. It is refused instead, and he is still summoned — the agent says its own first line.
  await expect.poll(async () => (await debugState(page)).room?.view.wakeArmed, { timeout: 60000 }).toBe(true);
  await tap(page);
  await expect.poll(() => scene(page), { timeout: 60000 }).toMatch(/^present:/);
  await frames(page, 3);
  expect(await greetingPlays(page)).toBe(1);
  expect(problems).toEqual([]);
});

test('with "His voice from where he stands" off, he greets from the headset and nothing is placed', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await answerTokens(page, 'never');
  await lengthenTheGreeting(page);
  await countGreetings(page);
  await recordAudio(page, { platformEchoCanceller: true });
  await withSavedSettings(page);
  await page.goto(appPage());
  await page.evaluate(() => window.__xrHarness?.ready);

  const setting = page.getByLabel('His voice from where he stands');
  await expect(setting).toBeChecked();
  await setting.uncheck();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), VOICE_SETTING_KEY)).toBe('off');
  // Kept across a reload, as the page's other settings are.
  await page.reload();
  await page.evaluate(() => window.__xrHarness?.ready);
  await expect(page.getByLabel('His voice from where he stands')).not.toBeChecked();

  await enterRoom(page, appPage('deadline=never'));
  await untilListening(page);
  expect(await voiceReport(page)).toMatchObject({ route: 'element', reason: 'setting-off', echoCanceller: 'platform' });

  await summonAhead(page);
  await frames(page, 4);
  expect(await greetingPlays(page)).toBe(1);
  expect(await page.evaluate(() => window.__voiceProbe?.panners.length)).toBe(0);
  expect(await page.evaluate(() => window.__voiceProbe?.taken.length)).toBe(0);
  expect(await voiceReport(page)).toMatchObject({ greeting: 'element', listener: null, speaker: null });
  expect(problems).toEqual([]);
});

test('a desktop microphone, with no echo canceller of the headset’s own, keeps his voice on the element', async ({
  page,
}) => {
  await answerTokens(page, 'never');
  await recordAudio(page, { platformEchoCanceller: false });
  await withSavedSettings(page);
  await enterRoom(page);
  await untilListening(page);
  const voice = await voiceReport(page);
  expect(voice.route).toBe('element');
  // Chromium on a desktop lists its modes without "all"; an older one lists none.
  expect(['browser-echo-canceller', 'echo-canceller-unknown']).toContain(voice.reason);
});

test('the SDK’s elements are made inaudible by their volume, and only while they play a live stream', async ({
  page,
}) => {
  await page.addInitScript({ content: await bundle('element-volume-probe.ts') });
  await page.goto('/hey-jarvis/vr/');
  const result: ElementVolumeProbeResult | undefined = await page.evaluate(() => window.__elementVolumeProbe?.());
  if (result === undefined) throw new Error('The probe did not run.');

  const { silenced, restored, counted } = result;
  for (const element of [silenced.already, silenced.appended]) {
    expect(element).toMatchObject({ volume: 0, muted: false, connected: true });
  }
  // Left playing: whatever the browser allowed before, the rule never paused it.
  expect(silenced.already.paused).toBe(restored.already.paused);
  expect(silenced.appended.paused).toBe(restored.appended.paused);
  expect(silenced.greeting.volume).toBe(1);
  expect(silenced.ended.volume).toBe(1);
  expect(counted).toBe(2);
  for (const element of Object.values(restored)) expect(element.volume).toBe(1);
});
