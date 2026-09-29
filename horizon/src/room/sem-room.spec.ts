import { describe, expect, it } from 'bun:test';
import { containsPoint } from './floor-polygon';
import { toReference } from './pose-matrix';
import { createRoomModel } from './room-model';
import { loadSemRoom } from './sem-room';
import type { PlacementRequest } from './types';

/**
 * Placement in a real captured room — the living room the browser tests stand the emulated
 * Quest in, with its 17 planes, 8 furniture boxes and a room scan of 62,102 triangles — from the
 * same spot the e2e harness puts the head: the south end, eyes at 1.6 m, looking north.
 */
const HEAD_IN_THE_E2E: PlacementRequest = {
  head: { x: 0, y: 1.6, z: 1.2 },
  forward: { x: 0, y: 0, z: -1 },
  depthProbes: [],
};

function milliseconds(work: () => void): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe('placement in the captured living room', () => {
  it('reads the capture the way the emulator does', async () => {
    const room = await loadSemRoom('living_room');
    expect(room.planes).toHaveLength(17);
    expect(room.meshes).toHaveLength(9);
    const scan = room.meshes.find((mesh) => mesh.label === 'global mesh');
    expect(scan?.indices.length).toBe(62102 * 3);
  });

  it('puts him full size inside the floor, clear of the furniture, in good time', async () => {
    const room = await loadSemRoom('living_room');
    const model = createRoomModel();
    // The first build pays for compiling the code as well; the one the app waits on after a
    // change of room is the steady one, so both are measured and the steady one is held to the
    // budget. Printed so a slowdown shows in the log before it trips the limit.
    const firstBuild = milliseconds(() => model.update(room));
    const steadyBuild = milliseconds(() => model.update({ ...room }));
    const placeTimes = Array.from({ length: 20 }, () => milliseconds(() => model.place(HEAD_IN_THE_E2E)));
    const slowestPlace = Math.max(...placeTimes.slice(5));
    console.log(
      `living room: first build ${firstBuild.toFixed(1)} ms, steady build ${steadyBuild.toFixed(1)} ms, ` +
        `place ${placeTimes[0].toFixed(2)} ms cold, ≤ ${slowestPlace.toFixed(2)} ms warm`,
    );

    const placement = model.place(HEAD_IN_THE_E2E);
    expect(placement.level).toBe('full');
    expect(placement.clearance).toBeGreaterThanOrEqual(0.5);
    const floor = room.planes.find((plane) => plane.label === 'floor');
    if (floor === undefined) throw new Error('The living room has no floor.');
    const outline = floor.polygon.map((point) => toReference(floor.pose, point.x, 0, point.z));
    expect(containsPoint(outline, placement.position)).toBe(true);
    const ahead = Math.hypot(
      placement.position.x - HEAD_IN_THE_E2E.head.x,
      placement.position.z - HEAD_IN_THE_E2E.head.z,
    );
    expect(ahead).toBeGreaterThanOrEqual(0.9);
    expect(ahead).toBeLessThanOrEqual(2.6);

    expect(steadyBuild).toBeLessThan(150);
    expect(slowestPlace).toBeLessThan(5);
  });
});
