import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PictureMoment } from '../../src/preview/preview-hook';
import { expect, test } from './fixtures';

/**
 * The GPU picture of everything but his body, held to Skia's.
 *
 * Skia drew him on every device before `hologram/gpu`'s `drawGpuPicture` replaced it, and its picture
 * of fourteen moments is kept as goldens (`fixtures/picture/<name>.png`, drawn with `fadeOutside`, RGB
 * over black): at rest under each element the rim can lead with, bursts held and breaking, speech
 * thrown into spokes and a swoosh, the thinking pulse, the listening lattice, the arrival, the red
 * flash, lightning and satellites. The preview draws each moment with the GPU picture into a target
 * of its own three.js renderer, exactly as the headset draws it (`picture-check.ts`), and measures
 * how far it is from Skia's.
 *
 * They cannot agree to the byte — Skia antialiases its paths by analytic coverage on the CPU, the
 * GPU by the distance to each shape in its fragment shader — so what is held is how near they are,
 * as measured when the port was finished: a mean of 0.07–0.29 levels a channel, a 99th percentile
 * of 8 levels at most, under half a percent of pixels with a channel more than 16 apart, and the
 * same brightness overall. The limits are those numbers with a little headroom; a change that needs
 * more is a change to how he looks, and the goldens say what he looked like.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'picture');

interface Moments {
  size: number;
  moments: (PictureMoment & { name: string })[];
}

function isMoments(value: unknown): value is Moments {
  return (
    typeof value === 'object' &&
    value !== null &&
    'size' in value &&
    typeof value.size === 'number' &&
    'moments' in value &&
    Array.isArray(value.moments)
  );
}

function readMoments(): Moments {
  const parsed: unknown = JSON.parse(readFileSync(path.join(FIXTURES, 'moments.json'), 'utf8'));
  if (!isMoments(parsed)) throw new Error('moments.json is not a size and a list of moments.');
  return parsed;
}

test('the GPU picture draws every moment as Skia drew it', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/hey-jarvis/vr/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  const { size, moments } = readMoments();
  expect(moments.length).toBe(14);
  for (const { name, frame, satellites } of moments) {
    const golden = readFileSync(path.join(FIXTURES, `${name}.png`)).toString('base64');
    const check = await page.evaluate((asked) => window.__hologramPreview?.checkPicture(asked), {
      size,
      frame,
      satellites,
      golden,
    });
    if (check === undefined) throw new Error('The preview published no hook.');
    const lumaDifference = check.meanLuma - check.goldenMeanLuma;
    const found = [
      `mean ${check.meanDifference.toFixed(3)}`,
      `p99 ${check.percentile99}`,
      `max ${check.largestDifference}`,
      `>16 ${(check.shareOver16 * 100).toFixed(3)}%`,
      `luma ${check.meanLuma.toFixed(3)} against ${check.goldenMeanLuma.toFixed(3)}`,
    ].join(', ');
    console.log(`${name}: ${found}`);
    // Soft, so a failing run says how every moment came out rather than only the first.
    expect.soft(check.goldenMeanLuma, `${name}: Skia drew something`).toBeGreaterThan(1);
    expect.soft(check.meanDifference, `${name}: ${found}`).toBeLessThanOrEqual(0.4);
    expect.soft(check.percentile99, `${name}: ${found}`).toBeLessThanOrEqual(10);
    expect.soft(check.shareOver16, `${name}: ${found}`).toBeLessThanOrEqual(0.008);
    expect.soft(Math.abs(lumaDifference), `${name}: ${found}`).toBeLessThanOrEqual(0.1);
  }
  expect(problems).toEqual([]);
});
