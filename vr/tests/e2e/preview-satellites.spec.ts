import type { Page } from '@playwright/test';
import { expect, keepPicture, test } from './fixtures';

/**
 * The preview's satellites panel (`src/preview/satellites-panel.ts`): every vertical's glyph, read
 * from the server's own files at build time, set to work round him on the stage and drawn beside it
 * as the phone draws them. Photographed, and checked through `window.__hologramPreview.satellites`.
 */

async function openPreview(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.setViewportSize({ width: 1100, height: 1500 });
  await page.goto('/hey-jarvis/vr/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  return problems;
}

async function satellites(page: Page) {
  return page.evaluate(() => window.__hologramPreview?.satellites ?? []);
}

test('every vertical’s glyph can be set to work round him, at most eight at once', async ({ page }, testInfo) => {
  const problems = await openPreview(page);

  const agents = await page
    .locator('#satellite-agents button.glyph')
    .evaluateAll((buttons) =>
      buttons.map((button) => (button instanceof HTMLElement ? button.dataset.agent : undefined)),
    );
  expect(agents).toContain('weather');
  expect(agents).toContain('vision');

  await page.locator('button[data-satellites="all"]').click();
  await expect.poll(async () => (await satellites(page)).length).toBe(8);
  expect(new Set((await satellites(page)).map((satellite) => satellite.status))).toEqual(new Set(['working']));
  await expect(page.locator('#satellite-agents button.glyph[aria-pressed="true"]')).toHaveCount(8);

  await page.locator('button[data-satellites="tool"]').click();
  await page.locator('#stage').screenshot({ path: testInfo.outputPath('satellites-stage.png') });
  await keepPicture(testInfo, 'satellites-stage.png');
  await page.locator('#satellites').screenshot({ path: testInfo.outputPath('satellites-panel.png') });
  await keepPicture(testInfo, 'satellites-panel.png');

  await page.locator('button[data-satellites="finish"]').click();
  await expect.poll(async () => (await satellites(page)).length, { timeout: 15_000 }).toBe(0);
  expect(problems).toEqual([]);
});

test('a path of your own is tried as the server’s would be, and one the devices refuse says so', async ({ page }) => {
  await openPreview(page);

  await page.locator('#satellite-try').click();
  await expect(page.locator('#satellite-status')).toContainText('circling him');
  await expect.poll(async () => (await satellites(page)).map((satellite) => satellite.agentId)).toEqual(['yourGlyph']);

  await page.locator('#satellite-path').fill('M 0 0 L 1 1 url(#x)');
  await page.locator('#satellite-try').click();
  await expect(page.locator('#satellite-status')).toContainText('not a path the devices draw');
});
