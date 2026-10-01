import { HOLOGRAM_RADIUS_METRES } from '../../src/hologram3d/dimensions';
import type { PortCheckRequest, PreviewPhase } from '../../src/preview/preview-hook';
import { expect, test } from './fixtures';

/**
 * The GPU's fragment arithmetic, held to the CPU reference that the unit tests hold to the phone.
 *
 * `fragment-glsl.ts` is a transliteration of `fragment-3d.ts`, and nothing but running it can say
 * the two agree: the preview page runs the GLSL for every one of the body's and the stream's rows,
 * reads back where it put each one, and compares that with the reference, row by row. float32 can
 * put a fragment on the other side of a blink's or a tier's edge now and then, so a handful may
 * disagree; the places must not.
 */

/** The eye 1.6 m from his centre, in radii. */
const EYE_DISTANCE = 1.6 / HOLOGRAM_RADIUS_METRES;

const CASES: { phase: PreviewPhase; seconds: number; angle: number; elevation: number }[] = [
  { phase: 'idle', seconds: 3, angle: 0, elevation: 0 },
  { phase: 'arriving', seconds: 0.55, angle: 0.4, elevation: 0.1 },
  { phase: 'speaking', seconds: 4, angle: Math.PI / 4, elevation: 0 },
  { phase: 'listening', seconds: 1.2, angle: -0.9, elevation: 0.35 },
  { phase: 'thinking', seconds: 1.9, angle: 2.5, elevation: -0.3 },
  { phase: 'leaving', seconds: 0.2, angle: 1.2, elevation: 0.6 },
];

test('the GPU places every fragment where the CPU reference does', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/hey-jarvis/vr/preview.html');
  await page.evaluate(() => window.__hologramPreview?.ready);
  for (const moment of CASES) {
    const request: PortCheckRequest = { ...moment, eyeDistance: EYE_DISTANCE };
    const check = await page.evaluate((asked) => window.__hologramPreview?.checkPort(asked), request);
    if (check === undefined) throw new Error('The preview published no hook.');
    const label = `${moment.phase} from ${moment.angle.toFixed(2)} rad`;
    expect(check.rows, label).toBe(10168);
    expect(check.drawnOnCpu, label).toBeGreaterThan(300);
    expect(check.drawnOnOne, label).toBeLessThanOrEqual(Math.ceil(check.drawnOnCpu * 0.002));
    expect(check.tierDiffers, label).toBeLessThanOrEqual(Math.ceil(check.drawnOnCpu * 0.002));
    expect(check.largestCentreError, label).toBeLessThan(1e-3);
    expect(check.largestAxisError, label).toBeLessThan(1e-3);
  }
  expect(problems).toEqual([]);
});
