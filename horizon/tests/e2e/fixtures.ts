import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type Page } from '@playwright/test';
import { build } from 'esbuild';

/**
 * The page every headset test starts from: offline, with an emulated Quest 3 in a living room.
 *
 * Offline because the app must never need anything but its own site — every request that does
 * not go to the local server is aborted, so a CDN fetch or a stray telemetry call fails the test
 * rather than quietly working on a developer's network.
 */

const HARNESS_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'xr-harness.ts');

let harnessScript: Promise<string> | undefined;

/**
 * The emulated headset and room as one classic script, built once per run.
 *
 * An init script cannot import anything, so the harness and everything it needs — the emulator,
 * the synthetic environment, its own copy of three and the room captures — are bundled into a
 * single file. The rooms make it several megabytes, which is why it is built here, at test time,
 * rather than kept anywhere a production build could pick it up.
 */
function bundledHarness(): Promise<string> {
  harnessScript ??= build({
    entryPoints: [HARNESS_ENTRY],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  }).then((result) => {
    const [output] = result.outputFiles;
    if (output === undefined) throw new Error('esbuild produced no harness.');
    return output.text;
  });
  return harnessScript;
}

function isLocal(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

async function keepOffline(page: Page) {
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
    await page.addInitScript({ content: await bundledHarness() });
    await use(page);
  },
});

export { expect } from '@playwright/test';
