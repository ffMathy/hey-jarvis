import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserType, expect, type Page, type TestInfo, test } from '@playwright/test';
import { build } from 'vite';
import type { WakeCheck } from '../../src/wake/harness/wake-harness';

/**
 * The real wake pipeline in Chromium, hearing a spoken "hey jarvis" through a microphone.
 *
 * `bun test` already runs the real models through the real pipeline (`real-models.spec.ts`);
 * what only a browser can show is everything around them: the worker as Vite builds it with the
 * app's config, onnxruntime-web importing its glue from `vendor/` and running the wasm the worker
 * downloaded, the AudioWorklet packing frames in a 16 kHz context, the port between them, and a
 * microphone. Chromium's fake capture device plays a fixture clip on a loop in place of a
 * microphone (`--use-file-for-fake-audio-capture`), so the page hears "hey jarvis" every five
 * seconds — or, in the second group, speech with no wake word in it.
 *
 * The page is `src/wake/harness/`, built here into this run's output with the app's own Vite
 * config — never into the site — and served with the built site's `vendor/` and `models/`
 * beside it, at the same relative paths the app uses.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HORIZON = path.resolve(HERE, '../..');
const HARNESS = path.join(HORIZON, 'src/wake/harness');
const FIXTURES = path.join(HORIZON, 'src/wake/fixtures');
const SITE = path.resolve(HORIZON, '../dist/horizon');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

/** Serves the harness build, with the site's `vendor/` and `models/` inside it; only on localhost. */
async function serve(harnessBuild: string): Promise<{ server: Server; url: string }> {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const fromSite = relative.startsWith('vendor/') || relative.startsWith('models/');
    const root = fromSite ? SITE : harnessBuild;
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !existsSync(file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The harness server has no port.');
  return { server, url: `http://localhost:${address.port}/` };
}

/**
 * Builds the harness page with the app's Vite config into `outDir` — the config's own pages
 * replaced by the harness's, since they are named relative to the app, not to the harness.
 */
async function buildHarness(outDir: string) {
  await build({
    configFile: path.join(HORIZON, 'vite.config.ts'),
    root: HARNESS,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, rolldownOptions: { input: path.join(HARNESS, 'index.html') } },
  });
}

/**
 * A Chromium of its own whose fake microphone plays `clip` on a loop, and a page in it that may
 * use the microphone.
 *
 * Launched here rather than configured: the clip is a launch flag, and Playwright only takes
 * launch options per file or per project, while each test here needs a different clip.
 */
async function browserHearing(chromium: BrowserType, clip: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(FIXTURES, clip)}`,
    ],
    // As in playwright.config.ts: normally undefined, meaning Playwright's own Chromium.
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  });
  const context = await browser.newContext({ permissions: ['microphone'] });
  return { browser, page: await context.newPage() };
}

async function wakeCheck(page: Page): Promise<WakeCheck> {
  const check = await page.evaluate(() => window.__wakeCheck);
  if (check === undefined) throw new Error('The harness published no wake check.');
  return check;
}

/** Opens the harness offline, waits for the models, and starts listening. */
async function listen(page: Page, url: string, problems: string[]) {
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.route(
    (target) => target.hostname !== 'localhost',
    (route) => route.abort(),
  );
  await page.goto(url);
  await expect.poll(async () => (await wakeCheck(page)).prepared, { timeout: 60000 }).toBe(true);
  await page.getByRole('button', { name: 'Listen' }).click();
  await expect.poll(async () => (await wakeCheck(page)).health.state, { timeout: 30000 }).toBe('listening');
}

interface Harness {
  server: Server;
  url: string;
  /** Where the harness was built. */
  build: string;
}

let harness: Promise<Harness> | undefined;

/** The harness, built and served once, into the output folder of the first test that asks for it. */
function harnessFor(testInfo: TestInfo): Promise<Harness> {
  harness ??= (async () => {
    const outDir = testInfo.outputPath('wake-harness');
    await buildHarness(outDir);
    return { ...(await serve(outDir)), build: outDir };
  })();
  return harness;
}

test.afterAll(async () => {
  const running = await harness;
  harness = undefined;
  await new Promise((resolve) => running?.server.close(resolve));
});

test('the real pipeline loads with progress, listens, and wakes on a spoken "hey jarvis"', async ({
  playwright,
}, testInfo) => {
  const built = await harnessFor(testInfo);
  // The worker and the worklet are modules of their own, and the extern-wasm condition reached
  // the worker's bundle: onnxruntime-web's 14 MB wasm is fetched from vendor/, never bundled.
  const assets = readdirSync(path.join(built.build, 'assets'));
  expect(assets.filter((file) => file.endsWith('.wasm'))).toEqual([]);
  expect(assets.some((file) => file.startsWith('wake.worker'))).toBe(true);
  expect(assets.some((file) => file.startsWith('pcm-frames.worklet'))).toBe(true);

  const { browser, page } = await browserHearing(playwright.chromium, 'hey-jarvis-american.wav');
  try {
    const problems: string[] = [];
    await listen(page, built.url, problems);

    const loading = (await wakeCheck(page)).progress;
    expect(loading.at(-1)).toBe(1);
    expect(loading.every((fraction, index) => index === 0 || fraction >= loading[index - 1])).toBe(true);

    // The clip loops every 5.3 s and the wake word is armed with a 2 s pause, so within a few
    // loops he must have heard it.
    await expect.poll(async () => (await wakeCheck(page)).wakes.length, { timeout: 30000 }).toBeGreaterThan(0);
    const check = await wakeCheck(page);
    testInfo.annotations.push(
      { type: 'wake scores', description: check.wakes.map((score) => score.toFixed(3)).join(', ') },
      { type: 'milliseconds per chunk', description: check.health.millisecondsPerChunk.toFixed(1) },
      { type: 'chunks per second', description: check.health.chunksPerSecond.toFixed(1) },
    );
    expect(check.wakes[0]).toBeGreaterThanOrEqual(0.5);
    expect(check.health).toMatchObject({ state: 'listening', armed: true });
    expect(check.health.chunksPerSecond).toBeGreaterThan(10);
    expect(check.health.level).toBeGreaterThan(0);
    expect(check.problem).toBeNull();
    expect(problems).toEqual([]);
  } finally {
    await browser.close();
  }
});

test('the real pipeline listens to other speech without waking', async ({ playwright }, testInfo) => {
  const built = await harnessFor(testInfo);
  const { browser, page } = await browserHearing(playwright.chromium, 'other-speech.wav');
  try {
    const problems: string[] = [];
    await listen(page, built.url, problems);
    // Two loops of the 7.7 s clip, well past the 2 s pause after arming.
    await page.waitForTimeout(16000);
    const check = await wakeCheck(page);
    expect(check.health.state).toBe('listening');
    expect(check.wakes).toEqual([]);
    expect(check.highestScore).toBeLessThan(0.5);
    expect(problems).toEqual([]);
  } finally {
    await browser.close();
  }
});
