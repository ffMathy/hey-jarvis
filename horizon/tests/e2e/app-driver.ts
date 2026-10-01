import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route, TestInfo } from '@playwright/test';
import type { JarvisDebugState, RoomPoint, RoomReport } from '../../src/debug-hook';
import { expect, photograph } from './fixtures';

/**
 * Driving the real app in the emulated Quest 3's living room: its page, the room's state through
 * `window.__jarvis`, the emulated controllers, and ElevenLabs answered from the test.
 *
 * The emulator differs from a Quest in one way that matters here: it fires `select` the moment the
 * trigger goes down (before `selectstart`), where a Quest fires it on release. The room reads a
 * `select` with no start as a tap, so a quick press is a tap on both; a held trigger is a tap and
 * then, 0.8 s in, a hold.
 */

declare global {
  interface Window {
    /** The greeting as the page played it, counted by {@link countGreetings}. */
    __greeting?: { plays: number; element: HTMLMediaElement | undefined };
  }
}

/** The app's page, where the site serves it. */
export const APP_PAGE = '/hey-jarvis/horizon/';

/**
 * A budget of the app's own that a spec can hold (`src/test-seams.ts`), since the emulator draws
 * too slowly to race it: `deadline=never` keeps a summoning waiting for a conversation that never
 * opens, and `errors=held` keeps an error panel up until a select or B.
 */
export type TestSeam = 'deadline=never' | 'errors=held';

/** The app's page, opened holding `seams`. */
export function appPage(...seams: TestSeam[]): string {
  return seams.length === 0 ? APP_PAGE : `${APP_PAGE}?${seams.join('&')}`;
}

/** hologram's `ELEVENLABS_SETTINGS_STORAGE_KEY`, spelled out: Playwright cannot import hologram's TypeScript. */
export const SETTINGS_KEY = 'jarvis.elevenlabs-settings';

/** The settings every room here is entered with, as the page itself would have stored them. */
export const SAVED_SETTINGS = { apiKey: 'sk_room_test', agentId: 'agent_room_test' };

/** ElevenLabs' token endpoint, which `requestConversationToken` asks with the key in a header. */
const TOKEN_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/token**';

/** Where the right controller is held: in front of the chest, below and right of the eyes. */
export const HAND = { x: 0.25, y: 1.3, z: 0.95 };

/** The living room's walls, roughly, from the capture: x from -2.9 to 3.0, z from -2.5 to 2.1. */
export const LIVING_ROOM = { minimumX: -2.9, maximumX: 3.0, minimumZ: -2.5, maximumZ: 2.1 };

export async function debugState(page: Page): Promise<JarvisDebugState> {
  const state = await page.evaluate(() => window.__jarvis);
  if (state === undefined) throw new Error('The app published no debug state.');
  return state;
}

export async function roomReport(page: Page): Promise<RoomReport> {
  const room = (await debugState(page)).room;
  if (room === null) throw new Error('No room has been opened.');
  return room;
}

export async function scene(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__jarvis?.room?.scene);
}

/**
 * Chromium's own report of a response that was not a success, or a request that never got one:
 * the tests' doing — ElevenLabs answered with a refusal, LiveKit's socket closed — not the app's.
 */
const NETWORK_REPORT = /^(Failed to load resource|WebSocket connection to 'wss:\/\/[^']+' failed)/;

/** Every page error and console error but Chromium's network reports, for a test to expect none of. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !NETWORK_REPORT.test(message.text())) problems.push(message.text());
  });
  return problems;
}

/** Lets `count` more frames be drawn, so the emulator applies a change and the room reads it. */
export async function frames(page: Page, count: number) {
  const start = (await debugState(page)).frames;
  await expect
    .poll(async () => (await debugState(page)).frames, { timeout: 60000 })
    .toBeGreaterThanOrEqual(start + count);
}

/** Holds the right controller at {@link HAND}, pointing at `target` (or straight up, at nothing). */
export async function aim(page: Page, target: RoomPoint | 'up') {
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
export async function tap(page: Page) {
  await page.evaluate(() => {
    const device = window.__xrHarness?.device;
    const trigger = device?.controllers.right;
    device?.activeSession?.addEventListener('select', () => trigger?.updateButtonValue('trigger', 0), { once: true });
    trigger?.updateButtonValue('trigger', 1);
  });
  await frames(page, 1);
}

/** Presses the right trigger, or lets it go. */
export async function trigger(page: Page, value: 0 | 1) {
  await page.evaluate(
    (pressed) => window.__xrHarness?.device.controllers.right?.updateButtonValue('trigger', pressed),
    value,
  );
}

/** Presses B and lets it go again: an edge the room reads from the gamepad, whatever the frame rate. */
export async function pressB(page: Page) {
  await page.evaluate(() => window.__xrHarness?.device.controllers.right?.updateButtonValue('b-button', 1));
  await frames(page, 2);
  await page.evaluate(() => window.__xrHarness?.device.controllers.right?.updateButtonValue('b-button', 0));
  await frames(page, 1);
}

/** Stores the ElevenLabs settings before the page loads, as the page's own form would have. */
export async function withSavedSettings(page: Page) {
  await page.addInitScript(({ key, settings }) => window.localStorage.setItem(key, JSON.stringify(settings)), {
    key: SETTINGS_KEY,
    settings: SAVED_SETTINGS,
  });
}

/**
 * Counts every time the page starts the greeting's recording, audibly: the priming inside the
 * Enter tap plays it muted, and is not a greeting anyone hears.
 */
export async function countGreetings(page: Page) {
  await page.addInitScript(() => {
    const greeting: { plays: number; element: HTMLMediaElement | undefined } = { plays: 0, element: undefined };
    window.__greeting = greeting;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.src.includes('greeting') && !this.muted) {
        greeting.plays += 1;
        greeting.element = this;
      }
      return play.call(this);
    };
  });
}

export async function greetingPlays(page: Page): Promise<number> {
  return page.evaluate(() => window.__greeting?.plays ?? 0);
}

/** The build the specs run against, as `serve-dist.ts` serves it. */
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/horizon');

/**
 * How many times over the greeting is played by the tests that need him to still be greeting: its
 * two seconds ninety times, about three minutes, which is longer than a test may run (`timeout` in
 * `playwright.config.ts`). The recording plays on the wall clock whatever the frame rate, so a
 * shorter one ended under a spec that was still drawing its frames on a slow machine.
 */
const GREETING_REPEATS = 90;

/** An MP3's ID3v2 tag, if it starts with one: ten bytes of header, then a syncsafe length. */
function withoutId3Tag(recording: Buffer): Buffer {
  if (recording.subarray(0, 3).toString('latin1') !== 'ID3') return recording;
  const length = recording.subarray(6, 10).reduce((total, byte) => total * 128 + (byte & 0x7f), 0);
  return recording.subarray(10 + length);
}

/**
 * The built greeting, played {@link GREETING_REPEATS} times in a row, served in its place: him
 * greeting for longer than any test lasts, however slowly the emulator draws him doing it.
 */
export async function lengthenTheGreeting(page: Page) {
  const assets = path.join(SITE, 'assets');
  const name = readdirSync(assets).find((file) => file.startsWith('greeting') && file.endsWith('.mp3'));
  if (name === undefined) throw new Error('The build has no greeting.');
  const recording = readFileSync(path.join(assets, name));
  const frames = withoutId3Tag(recording);
  const long = Buffer.concat([recording, ...Array.from({ length: GREETING_REPEATS - 1 }, () => frames)]);
  await page.route(`**/assets/${name}`, (route) => route.fulfill({ body: long, contentType: 'audio/mpeg' }));
}

/** One request to the token endpoint, as ElevenLabs would have seen it. */
export interface TokenRequest {
  url: URL;
  apiKey: string | undefined;
}

/** How the test answers the token endpoint: a status and a body, or never at all. */
export type TokenAnswer = { status: number; body: unknown } | 'never';

/**
 * Answers ElevenLabs' token endpoint with `answer`, and records each request. Everything else that
 * leaves the machine is still aborted by the fixture, LiveKit's socket included, so a session that
 * gets a token still fails to connect.
 */
export async function answerTokens(page: Page, answer: TokenAnswer): Promise<TokenRequest[]> {
  const requests: TokenRequest[] = [];
  await page.route(TOKEN_ENDPOINT, async (route: Route) => {
    const request = route.request();
    requests.push({ url: new URL(request.url()), apiKey: request.headers()['xi-api-key'] });
    // Left unanswered, the request stays pending for as long as the page is open.
    if (answer === 'never') return;
    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  return requests;
}

/** Opens the page (at `path`), waits for the emulated room, and enters it once getting ready is done. */
export async function enterRoom(page: Page, path = APP_PAGE) {
  await page.goto(path);
  await page.evaluate(() => window.__xrHarness?.ready);
  const enter = page.getByRole('button', { name: 'Enter your room' });
  // The wake-word models and CanvasKit load first, with a progress bar.
  await expect(enter).toBeEnabled({ timeout: 90000 });
  await enter.click();
  await expect.poll(() => scene(page), { timeout: 90000 }).toBe('waiting');
}

/** Waits until the wake engine is really listening, which is when the hint is shown. */
export async function untilListening(page: Page) {
  await expect.poll(async () => (await roomReport(page)).view.panels.hint, { timeout: 90000 }).not.toBeNull();
}

/**
 * Photographs the error panel as `name`, and returns what it said.
 *
 * On a page opened with `errors=held` ({@link appPage}): the panel is otherwise up for six seconds,
 * and the emulator can take longer than that over a picture while he is drawn. Held, it is up until
 * the spec dismisses it, so the picture is always of the panel — which is checked once it is back.
 */
export async function photographError(page: Page, testInfo: TestInfo, name: string): Promise<readonly string[]> {
  await expect.poll(async () => (await roomReport(page)).view.panels.error, { timeout: 120000 }).not.toBeNull();
  await photograph(page, testInfo, name);
  const lines = (await roomReport(page)).view.panels.error;
  if (lines === null) throw new Error('The error panel went while its picture was taken: is the page holding errors?');
  return lines;
}

/** The effects carried out since the last `marker` among the recent ones, or all of them without it. */
export function effectsSince(effects: readonly string[], marker: string): string[] {
  return effects.slice(effects.lastIndexOf(marker) + 1);
}

export async function hologramPosition(page: Page): Promise<RoomPoint> {
  const position = (await debugState(page)).hologramPosition;
  if (position === null) throw new Error('He was never placed.');
  return position;
}

/** Whether `point` is inside the living room's walls. */
export function insideLivingRoom(point: RoomPoint): boolean {
  return (
    point.x > LIVING_ROOM.minimumX &&
    point.x < LIVING_ROOM.maximumX &&
    point.z > LIVING_ROOM.minimumZ &&
    point.z < LIVING_ROOM.maximumZ
  );
}
