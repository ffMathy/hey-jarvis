/**
 * Draws the goldens `tests/e2e/hologram-picture.spec.ts` holds his picture to.
 *
 * Every moment of `tests/e2e/fixtures/picture/moments.json` is drawn with the GPU picture through
 * the preview page's hook — into a target of the stage's own renderer, as the headset draws him —
 * exactly as the spec compares it (`pictureGolden` in `src/preview/picture-check.ts`): the size the
 * file names, its rows the right way up, its premultiplied light written as RGB over black with
 * every pixel opaque. Each is written as `<name>.png` beside `moments.json`, checked by drawing the
 * moment again and comparing it with what was written, which must not differ in any channel of any
 * pixel, and a golden no moment names any more is deleted.
 *
 * **A golden is how he looked when it was drawn.** The spec holds the picture to its own past, so
 * drawing them again is a change to how he looks: made on purpose, in the commit that changes the
 * look, with the new pictures looked at before they are committed. Never draw them again to make a
 * failing spec pass without knowing what moved.
 *
 * Usage (from the repository root; `bunx turbo build --filter=vr` first, since it draws the build):
 *
 *   timeout 300 bun vr/.scripts/render-picture-goldens.ts
 *
 * CHROMIUM_EXECUTABLE_PATH picks the browser, as it does for the browser tests.
 */
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import config from '../playwright.config';
import { keepOffline } from '../tests/e2e/fixtures';
import { goldenPath, type NamedMoment, PICTURE_FIXTURES, readPictureMoments } from '../tests/e2e/picture-moments';
import { isBuilt, SITE_PREFIX, serveBuild } from './serve-dist';

async function openPreview(browser: Browser, port: number): Promise<{ page: Page; problems: string[] }> {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await keepOffline(page);
  await page.goto(`http://localhost:${port}${SITE_PREFIX}preview.html`);
  await page.evaluate(() => window.__hologramPreview?.ready);
  return { page, problems };
}

/** Draws `moment` as its golden, writes it, and checks that what was written is what the spec will compare. */
async function drawGolden(page: Page, size: number, { name, frame, satellites }: NamedMoment) {
  const golden = await page.evaluate((asked) => window.__hologramPreview?.pictureGolden(asked), {
    size,
    frame,
    satellites,
  });
  if (golden === undefined) throw new Error('The preview published no hook.');
  writeFileSync(goldenPath(name), Buffer.from(golden, 'base64'));
  const check = await page.evaluate((asked) => window.__hologramPreview?.checkPicture(asked), {
    size,
    frame,
    satellites,
    golden,
  });
  if (check === undefined) throw new Error('The preview published no hook.');
  if (check.largestDifference !== 0) {
    throw new Error(
      `${name}: the picture drawn again differs from its golden by up to ${check.largestDifference} levels, so the spec could never hold it to it.`,
    );
  }
  console.log(`${name}: mean luma ${check.meanLuma.toFixed(3)}`);
}

/** Deletes every golden no moment names, so the folder holds exactly what the spec compares. */
function deleteUnnamedGoldens(moments: NamedMoment[]) {
  const named = new Set(moments.map(({ name }) => `${name}.png`));
  for (const file of readdirSync(PICTURE_FIXTURES)) {
    if (!file.endsWith('.png') || named.has(file)) continue;
    rmSync(path.join(PICTURE_FIXTURES, file));
    console.log(`${file}: deleted, since no moment names it`);
  }
}

async function main() {
  if (!isBuilt()) throw new Error('There is no build to draw from. Run: timeout 300 bunx turbo build --filter=vr');
  const { size, moments } = readPictureMoments();
  const server = serveBuild(0);
  let browser: Browser | undefined;
  try {
    const { port } = server;
    if (port === undefined) throw new Error('The build server is listening on no port.');
    browser = await chromium.launch({ ...config.use?.launchOptions });
    const { page, problems } = await openPreview(browser, port);
    for (const moment of moments) await drawGolden(page, size, moment);
    if (problems.length > 0) throw new Error(`The preview page failed while drawing: ${problems.join('; ')}`);
  } finally {
    await browser?.close();
    server.stop(true);
  }
  deleteUnnamedGoldens(moments);
  console.log(
    `Drew ${moments.length} goldens at ${size} pixels into ${PICTURE_FIXTURES}. Look at them before committing.`,
  );
}

await main();
