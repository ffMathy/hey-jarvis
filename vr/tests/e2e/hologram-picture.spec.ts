import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { goldenPath, readPictureMoments } from './picture-moments';

/**
 * The GPU picture of everything but his body, held to its own frames.
 *
 * `hologram/gpu`'s `drawGpuPicture` drew fifteen moments when he was redrawn after the Vision Quest
 * footage, and they are kept as goldens (`fixtures/picture/<name>.png`, RGB over black, named in
 * `fixtures/picture/moments.json`): at rest at three times, so the cage has turned with his body,
 * the core ring's brighter stretches have rolled and the embers have drifted between them; speaking,
 * with his voice's energy spread evenly, in its low notes (the embers) and in its high ones (the
 * fray); a burst held and breaking; thinking, with the scan plane and with its pulse blooming out
 * of the core ring; the listening lattice; the vortex early and late; leaving; and satellites. The
 * preview draws each moment with the GPU picture into a target of its own three.js renderer, exactly
 * as the headset draws it (`picture-check.ts`), and measures how far it is from its golden.
 *
 * So this is a regression test: it says the picture has not moved from what it was when the goldens
 * were drawn, not that it is right. The limits are the ones that held the GPU port to Skia's picture
 * — a mean of 0.4 levels a channel, a 99th percentile of 10, at most 0.8% of pixels a channel more
 * than 16 apart, and the same brightness overall within 0.1 — and they now leave room only for what
 * may differ between one GPU and another; the same build on the same machine draws its goldens to
 * the byte. A change that needs more is a change to how he looks: draw the goldens again with
 * `.scripts/render-picture-goldens.ts`, deliberately, in the commit that makes it, and look at them
 * before committing (see "His picture alone" in `.claude/rules/vr-the-browser-tests.md`).
 */

test('the GPU picture draws every moment as it did when its goldens were drawn', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/hey-jarvis/vr/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  const { size, moments } = readPictureMoments();
  expect(moments.length).toBe(15);
  for (const { name, frame, satellites } of moments) {
    const golden = readFileSync(goldenPath(name)).toString('base64');
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
    expect.soft(check.goldenMeanLuma, `${name}: the golden has something in it`).toBeGreaterThan(1);
    expect.soft(check.meanDifference, `${name}: ${found}`).toBeLessThanOrEqual(0.4);
    expect.soft(check.percentile99, `${name}: ${found}`).toBeLessThanOrEqual(10);
    expect.soft(check.shareOver16, `${name}: ${found}`).toBeLessThanOrEqual(0.008);
    expect.soft(Math.abs(lumaDifference), `${name}: ${found}`).toBeLessThanOrEqual(0.1);
  }
  expect(problems).toEqual([]);
});
