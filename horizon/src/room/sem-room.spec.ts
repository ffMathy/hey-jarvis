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
    // change of room is a warm one. The quickest of three warm builds, and the median of the warm
    // placements, are held to the budget: machines running the suite are often busy with other
    // work, and a single run can land on a garbage collection or a stolen time slice. Printed, so
    // a slowdown shows in the log before it trips the limit.
    const firstBuild = milliseconds(() => model.update(room));
    const warmBuilds = Array.from({ length: 3 }, () => milliseconds(() => model.update({ ...room })));
    const steadyBuild = Math.min(...warmBuilds);
    const placeTimes = Array.from({ length: 25 }, () => milliseconds(() => model.place(HEAD_IN_THE_E2E)));
    const warm = placeTimes.slice(5).sort((a, b) => a - b);
    const typicalPlace = warm[Math.floor(warm.length / 2)];
    console.log(
      `living room: first build ${firstBuild.toFixed(1)} ms, warm builds ` +
        `${warmBuilds.map((time) => time.toFixed(1)).join(' / ')} ms, place ${placeTimes[0].toFixed(2)} ms ` +
        `cold, ${typicalPlace.toFixed(2)} ms warm (slowest ${warm[warm.length - 1].toFixed(2)} ms)`,
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
    expect(typicalPlace).toBeLessThan(5);
  });
});
