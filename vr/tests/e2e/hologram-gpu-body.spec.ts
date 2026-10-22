import type { GpuBodyCheckRequest } from '../../src/preview/preview-hook';
import { expect, test } from './fixtures';

/**
 * The phone's and the watch's GPU body, held to the headset's to the byte.
 *
 * `hologram/gpu`'s `drawGpuBody` draws his body with no three.js — the halo union, the strokes and
 * the halos' light, from the same shader sources the headset wraps in three.js materials — so a
 * phone and a watch can draw it over Skia's picture of the rest of him. Nothing but drawing both can
 * say they agree: the preview page draws one moment with the headset's three.js passes, CanvasKit's
 * picture blacked out, then with the raw renderer from the matrices and uniforms three used, on a
 * context made the way three made its own, and compares the two drawing buffers byte for byte.
 *
 * The moments are every phase — the arrival's vortex and fade, bursts in flight, the listening
 * lattice, the thinking plane, the leaving fade — near and far, from in front, from the side, from
 * behind, and from above and below.
 */

/** 1.6 m with the preview's lens, as he stands in a room; 0.6 m with a wide one, the perspective strong. */
const FAR = { distance: 1.6, fieldOfView: 32 };
const NEAR = { distance: 0.6, fieldOfView: 90 };

const CASES: GpuBodyCheckRequest[] = [
  { phase: 'arriving', seconds: 0.55, angle: 0, elevation: 0, ...FAR },
  { phase: 'greeting', seconds: 1.8, angle: 2.5, elevation: 0.2, ...FAR },
  { phase: 'speaking', seconds: 4, angle: -Math.PI / 4, elevation: 0, ...NEAR },
  { phase: 'listening', seconds: 1.2, angle: Math.PI / 4, elevation: 0, ...FAR },
  { phase: 'thinking', seconds: 1.9, angle: 0, elevation: 0.35, ...NEAR },
  { phase: 'idle', seconds: 3, angle: 0, elevation: 0, ...NEAR },
  { phase: 'leaving', seconds: 0.2, angle: 0.9, elevation: -0.25, ...FAR },
];

test('the raw renderer draws the body exactly as three.js does', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/hey-jarvis/vr/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  for (const moment of CASES) {
    const check = await page.evaluate((asked) => window.__hologramPreview?.checkGpuBody(asked), moment);
    if (check === undefined) throw new Error('The preview published no hook.');
    const label = `${moment.phase} at ${moment.distance} m from ${moment.angle.toFixed(2)} rad, ${moment.elevation.toFixed(2)} up`;
    const found = `${check.differingBytes} bytes in ${check.differingPixels} of ${check.width}×${check.height} pixels differ, by up to ${check.largestDifference}; three lit ${check.litPixels}`;
    console.log(`${label}: ${found}`);
    // Soft, so a failing run says how every moment came out rather than only the first.
    expect.soft(check.litPixels, label).toBeGreaterThan((check.width * check.height) / 50);
    expect.soft(check.differingBytes, `${label}: ${found}`).toBe(0);
  }
  expect(problems).toEqual([]);
});
