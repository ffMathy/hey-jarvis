import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from './fixtures';
import type { RoomProbeResult } from './room-probe';

/**
 * Placement against the emulated Quest's real XR objects, in the living room the other specs
 * stand in.
 *
 * `room-probe.ts` runs in the page: it opens a session beside the app, snapshots the room over a
 * dozen frames the way the app will, and places Jarvis from the emulated head. What this checks
 * is the part no unit test can reach — that the planes and meshes arrive as expected, that the
 * emulator marking everything changed on every frame does not make each frame a new snapshot,
 * and that he ends up in the room with space around him.
 */

const PROBE_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'room-probe.ts');

let probeScript: Promise<string> | undefined;

/** The probe and the placement code it runs, as one classic script, built once per run. */
function bundledProbe(): Promise<string> {
  probeScript ??= build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  }).then((result) => {
    const [output] = result.outputFiles;
    if (output === undefined) throw new Error('esbuild produced no probe.');
    return output.text;
  });
  return probeScript;
}

test('reads the emulated living room frame by frame and places Jarvis inside it', async ({ page }, testInfo) => {
  await page.addInitScript({ content: await bundledProbe() });
  await page.goto('/hey-jarvis/horizon/');
  await page.evaluate(() => window.__xrHarness?.ready);

  const result: RoomProbeResult | undefined = await page.evaluate(() => window.__roomProbe?.());
  if (result === undefined) throw new Error('The room probe did not load.');
  testInfo.annotations.push({
    type: 'room timings',
    description:
      `first snapshot ${result.firstSnapshotMilliseconds.toFixed(1)} ms, later ones ` +
      `${result.laterSnapshotMilliseconds.toFixed(2)} ms, grid ${result.buildMilliseconds.toFixed(1)} ms cold ` +
      `and ${result.warmBuildMilliseconds.toFixed(1)} ms warm, ` +
      `place ${result.placeMilliseconds.toFixed(2)} ms`,
  });

  // The room as the emulator reports it: its planes, its furniture boxes and its room scan.
  expect(result.description.planes).toBe(17);
  expect(result.description.meshes).toBe(9);
  expect(result.description.labels['global mesh']).toBe(1);
  expect(result.description.labels.floor).toBe(1);
  expect(result.description.triangles).toBeGreaterThan(62000);
  // The emulator marks every plane and mesh changed on every frame; nothing actually changes.
  expect(result.distinctSnapshots).toBe(1);

  // The harness stands the head at the south end, looking north.
  expect(result.head.z).toBeCloseTo(1.2, 3);
  expect(result.placement.level).toBe('full');
  expect(result.placement.clearance).toBeGreaterThanOrEqual(0.5);
  expect(result.insideFloor).toBe(true);
  // Ahead of the head, not behind it.
  expect(result.placement.position.z).toBeLessThan(result.head.z - 0.8);
});
