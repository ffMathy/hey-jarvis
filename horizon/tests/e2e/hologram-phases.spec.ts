import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { gridDifference } from '../../src/preview/picture-stats';
import {
  PREVIEW_PHASES,
  type PreviewBackground,
  type PreviewMode,
  type PreviewPhase,
  type PreviewView,
  type StillRequest,
  type StillResult,
} from '../../src/preview/preview-hook';
import { expect, test } from './fixtures';

/**
 * Jarvis in 3D, through every phase, on the preview page — photographed, and measured against the
 * phone's own flat drawing.
 *
 * The pictures are the point: they are what a person looks at to judge whether he still looks like
 * himself. The measurements are the guard rail under them — a look that washed out into a flat
 * orange coin, or a phase that stopped showing, fails here rather than on a headset.
 *
 * Each still is stepped from a fresh arrival at 72 Hz to a fixed moment, so the same test draws the
 * same frame every time: the moments were picked with the voice tracker's chips in flight, the
 * lattice up and the thinking plane crossing his middle.
 */

/** How far into each phase each still is taken, in steps of 1/72 s. */
const MOMENTS: Record<PreviewPhase, number> = {
  // A third of the way through the vortex.
  arriving: 40,
  // "…how can I help", with a burst's chips in flight.
  greeting: 131,
  // Mid-sentence, a full-strength burst's chips in flight.
  speaking: 288,
  // Someone mid-phrase, the lattice fully up.
  listening: 86,
  // Fully in the thought, the plane across his middle.
  thinking: 137,
  idle: 216,
  // Half gone.
  leaving: 14,
};

/**
 * Where a copy of every picture goes as well as the test's own output folder, for a person to look
 * through: set HOLOGRAM_SCREENS_DIR to a folder.
 */
const SCREENS_DIRECTORY = process.env.HOLOGRAM_SCREENS_DIR;

async function openPreview(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto('/hey-jarvis/horizon/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  return problems;
}

async function still(page: Page, request: StillRequest): Promise<StillResult> {
  const result = await page.evaluate((asked) => window.__hologramPreview?.show(asked), request);
  if (result === undefined) throw new Error('The preview published no hook.');
  return result;
}

interface Shot {
  phase: PreviewPhase;
  mode: PreviewMode;
  view: PreviewView;
  background: PreviewBackground;
}

/** The picture's name: phase-speaking-front.png for the plain volumetric view on black, and so on. */
function shotName({ phase, mode, view, background }: Shot, suffix = '') {
  const parts = ['phase', phase, mode === 'flat' ? 'flat' : '', view, background === 'grey' ? 'grey' : '', suffix];
  return `${parts.filter((part) => part !== '').join('-')}.png`;
}

async function photograph(page: Page, testInfo: TestInfo, name: string) {
  const file = testInfo.outputPath(name);
  await page.locator('#stage').screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  if (SCREENS_DIRECTORY !== undefined) {
    mkdirSync(SCREENS_DIRECTORY, { recursive: true });
    copyFileSync(file, path.join(SCREENS_DIRECTORY, name));
  }
}

async function shoot(page: Page, testInfo: TestInfo, shot: Shot): Promise<StillResult> {
  const result = await still(page, { ...shot, seconds: MOMENTS[shot.phase] / 72 });
  await photograph(page, testInfo, shotName(shot));
  return result;
}

test('every phase, in 3D and flat, from the front and the side, on black and on grey', async ({ page }, testInfo) => {
  test.setTimeout(900000);
  const problems = await openPreview(page);
  const fronts = new Map<PreviewPhase, StillResult>();
  for (const phase of PREVIEW_PHASES) {
    fronts.set(phase, await shoot(page, testInfo, { phase, mode: 'volumetric', view: 'front', background: 'black' }));
    await shoot(page, testInfo, { phase, mode: 'volumetric', view: 'side', background: 'black' });
    await shoot(page, testInfo, { phase, mode: 'volumetric', view: 'front', background: 'grey' });
    await shoot(page, testInfo, { phase, mode: 'volumetric', view: 'side', background: 'grey' });
    await shoot(page, testInfo, { phase, mode: 'flat', view: 'front', background: 'black' });
    await shoot(page, testInfo, { phase, mode: 'flat', view: 'front', background: 'grey' });
  }
  testInfo.annotations.push({
    type: 'frame time',
    description: [...fronts].map(([phase, result]) => `${phase} ${result.updateMilliseconds.toFixed(1)} ms`).join(', '),
  });

  // Every phase looks like something of its own: no two are lit alike.
  for (const [first, firstResult] of fronts) {
    for (const [second, secondResult] of fronts) {
      if (first >= second) continue;
      const difference = gridDifference(firstResult.stats.grid, secondResult.stats.grid);
      expect(difference, `${first} against ${second}`).toBeGreaterThan(1);
    }
  }
  expect(problems).toEqual([]);
});
