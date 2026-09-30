import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';

/**
 * The page every headset test starts from: offline, with an emulated Quest 3 in a living room.
 *
 * Offline because the app must never need anything but its own site — every request that does
 * not go to the local server is aborted, so a CDN fetch or a stray telemetry call fails the test
 * rather than quietly working on a developer's network.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

const bundles = new Map<string, Promise<string>>();

/**
 * `entry` (a file beside this one) and everything it imports, as one classic script for
 * `page.addInitScript`, built once per run.
 *
 * An init script cannot import anything, so what runs in the page — the emulated headset and
 * room, with its own copy of three and the room captures, or the room probe with the placement
 * code — is bundled into a single file. The rooms make the harness several megabytes, which is why
 * it is built here, at test time, rather than kept anywhere a production build could pick it up.
 */
export function bundle(entry: string): Promise<string> {
  let built = bundles.get(entry);
  if (built === undefined) {
    built = build({
      entryPoints: [path.join(HERE, entry)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    }).then((result) => {
      const [output] = result.outputFiles;
      if (output === undefined) throw new Error(`esbuild produced nothing for ${entry}.`);
      return output.text;
    });
    bundles.set(entry, built);
  }
  return built;
}

/**
 * The window a spec that photographs the room opens: twice the default 1280 by 720 each way.
 *
 * The emulator's XR framebuffer is the window's size in CSS pixels — IWER sets its canvas to
 * `innerWidth` by `innerHeight` when the layer is set, whatever the device pixel ratio, and three
 * takes the layer's size as it is — and the synthetic room is drawn at that size too (at any
 * device pixel ratio but 1 it would size its canvas again on every frame). So a larger window is
 * the only way to more pixels per degree. IWER's view is 90° high: 720 pixels high is about 6
 * pixels per degree at its middle, a quarter of a Quest 3's 25, and every edge looked four times as
 * jagged as a headset would show it; 1440 is about 12.6, half. Four times the pixels slows every
 * frame SwiftShader draws, so only the specs whose pictures are for looking at use it.
 */
export const ROOM_PICTURE_VIEWPORT = { width: 2560, height: 1440 } as const;

/**
 * Where a copy of every picture the specs take goes as well as the test's own output folder, for a
 * person to look through: set HOLOGRAM_SCREENS_DIR to a folder.
 */
const SCREENS_DIRECTORY = process.env.HOLOGRAM_SCREENS_DIR;

/**
 * Keeps the picture a test wrote to its output folder as `name`: attached to the report, and
 * copied to HOLOGRAM_SCREENS_DIR when that is set.
 */
export async function keepPicture(testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(name);
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  if (SCREENS_DIRECTORY !== undefined) {
    mkdirSync(SCREENS_DIRECTORY, { recursive: true });
    copyFileSync(file, path.join(SCREENS_DIRECTORY, name));
  }
}

/**
 * Photographs the view as `name` — or only `clip` of it — and keeps the picture. The synthetic room
 * the emulator draws behind the app's canvas is in it too. Never the whole page: photographing a
 * page taller than the view resizes it for a moment, which clears the room's canvas until the next
 * frame, and the emulator's frames are a second apart.
 */
export async function photograph(
  page: Page,
  testInfo: TestInfo,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  const picture = await page.screenshot({ path: testInfo.outputPath(name), clip });
  await keepPicture(testInfo, name);
  return picture;
}

function isLocal(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

/** Aborts every request and socket that leaves the machine; `.scripts/render-demo.ts` keeps its page offline with it too. */
export async function keepOffline(page: Page) {
  await page.route(
    (url) => !isLocal(url) && url.protocol !== 'data:' && url.protocol !== 'blob:',
    (route) => route.abort(),
  );
  await page.routeWebSocket(
    (url) => !isLocal(url),
    (webSocket) => webSocket.close(),
  );
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await keepOffline(page);
    await page.addInitScript({ content: await bundle('xr-harness.ts') });
    await use(page);
  },
});

export { expect } from '@playwright/test';
