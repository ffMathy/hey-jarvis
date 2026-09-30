import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
    await shoot(page, testInfo, { phase, mode: 'flat', view: 'side', background: 'black' });
    await shoot(page, testInfo, { phase, mode: 'flat', view: 'front', background: 'grey' });
    await shoot(page, testInfo, { phase, mode: 'flat', view: 'side', background: 'grey' });
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

/** How far the volumetric look may stray from the phone's, as a share of the phone's own figure. */
const PARITY_TOLERANCE = 0.25;
/** Below this much mean luma an annulus is next to dark, and is compared by how far apart, not by share. */
const DARK_LUMA = 8;

function expectNear(actual: number, expected: number, label: string) {
  if (expected < DARK_LUMA) {
    expect.soft(Math.abs(actual - expected), label).toBeLessThan(DARK_LUMA * PARITY_TOLERANCE);
  } else {
    expect.soft(Math.abs(actual - expected) / expected, label).toBeLessThan(PARITY_TOLERANCE);
  }
}

test('seen from in front, far off, he is lit as the phone draws him', async ({ page }, testInfo) => {
  test.setTimeout(600000);
  const problems = await openPreview(page);
  const lines: string[] = [];
  for (const phase of PREVIEW_PHASES) {
    const shot = { phase, view: 'parity', background: 'black', seconds: MOMENTS[phase] / 72 } as const;
    const flat = await still(page, { ...shot, mode: 'flat' });
    await photograph(page, testInfo, shotName({ ...shot, mode: 'flat' }));
    const volumetric = await still(page, { ...shot, mode: 'volumetric' });
    await photograph(page, testInfo, shotName({ ...shot, mode: 'volumetric' }));
    const describe = (result: StillResult) =>
      `${result.stats.annuli.map((value) => value.toFixed(1)).join(' / ')}, p95 ${result.stats.percentile95.toFixed(1)}`;
    lines.push(`${phase}: phone ${describe(flat)}; 3D ${describe(volumetric)}`);
    // The core, the body and the rim each as bright as the phone's, and the brightest of him too:
    // a halo layer stacked rather than unioned lifts the body annulus and the percentile far past this.
    volumetric.stats.annuli.forEach((value, annulus) => {
      expectNear(value, flat.stats.annuli[annulus], `${phase}, annulus ${annulus}`);
    });
    expectNear(volumetric.stats.percentile95, flat.stats.percentile95, `${phase}, 95th percentile`);
  }
  testInfo.annotations.push({
    type: 'luma per annulus (0–0.5R / 0.5–0.94R / 0.94–1.25R)',
    description: lines.join('\n'),
  });
  console.log(lines.join('\n'));
  expect(problems).toEqual([]);
});

/** A headset's eyes are about this far apart. */
const EYE_SEPARATION_METRES = 0.063;

test('in stereo, for looking at with parallel eyes', async ({ page }, testInfo) => {
  test.setTimeout(300000);
  const problems = await openPreview(page);
  for (const phase of ['speaking', 'listening', 'thinking', 'idle'] as const) {
    const request: StillRequest = {
      phase,
      mode: 'volumetric',
      view: 'front',
      background: 'black',
      seconds: MOMENTS[phase] / 72,
    };
    const pair = await page.evaluate(([asked, separation]) => window.__hologramPreview?.stereo(asked, separation), [
      request,
      EYE_SEPARATION_METRES,
    ] as const);
    if (pair === undefined) throw new Error('The preview published no hook.');
    const name = `phase-${phase}-stereo.png`;
    const file = testInfo.outputPath(name);
    writeFileSync(file, Buffer.from(pair, 'base64'));
    await testInfo.attach(name, { path: file, contentType: 'image/png' });
    if (SCREENS_DIRECTORY !== undefined) copyFileSync(file, path.join(SCREENS_DIRECTORY, name));
  }
  expect(problems).toEqual([]);
});
