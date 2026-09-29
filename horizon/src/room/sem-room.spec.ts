import { describe, expect, it } from 'bun:test';
import { containsPoint } from './floor-polygon';
import { firstBlockedFraction } from './occupancy-grid';
import { toReference } from './pose-matrix';
import { createRoomModel } from './room-model';
import { buildRoomSceneNow } from './room-scene';
import { loadSemRoom, type SemRoomName } from './sem-room';
import type { PlacementLevel, PlacementRequest, RoomSnapshot } from './types';

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

/**
 * How long a warm build of the captured living room and a warm placement in it may take before
 * the suite fails. The budget is about 150 ms for a build — it runs in the worker, so it costs no
 * frames, but a changed room should be in use soon after — and a few milliseconds for a
 * placement, which runs the moment he is summoned. The build's limit leaves room for a busy
 * machine above that budget.
 */
const WARM_BUILD_LIMIT_MILLISECONDS = 250;
const PLACE_LIMIT_MILLISECONDS = 5;

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
    // placements, are what is held to a limit: a single run can land on a garbage collection or a
    // stolen time slice. The limits are guards against a real slowdown, not the budget itself —
    // on an idle machine the build takes about 40 ms and a placement about 1 ms, but the suite
    // shares its machine with every other package's tests, which can more than double both.
    // Printed, so a slowdown shows in the log before it trips a limit.
    const firstBuild = milliseconds(() => model.update(room));
    const warmBuilds = Array.from({ length: 3 }, () => milliseconds(() => model.update({ ...room })));
    const steadyBuild = Math.min(...warmBuilds);
    const placeTimes = Array.from({ length: 25 }, () => milliseconds(() => model.place(HEAD_IN_THE_E2E)));
    const warm = placeTimes.slice(5).sort((quicker, slower) => quicker - slower);
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

    expect(steadyBuild).toBeLessThan(WARM_BUILD_LIMIT_MILLISECONDS);
    expect(typicalPlace).toBeLessThan(PLACE_LIMIT_MILLISECONDS);
  });
});

/** The free space each level promises around his centre. */
const PROMISED_CLEARANCE: Record<PlacementLevel, number> = {
  full: 0.5,
  tight: 0.35,
  small: 0.3,
  wide: 0.3,
  fallback: 0,
};

function floorOutline(room: RoomSnapshot) {
  const floor = room.planes.find((plane) => plane.label === 'floor');
  if (floor === undefined) throw new Error('The room has no floor.');
  return floor.polygon.map((point) => toReference(floor.pose, point.x, 0, point.z));
}

describe('placement in every captured room', () => {
  const rooms: SemRoomName[] = ['living_room', 'meeting_room', 'music_room', 'office_large', 'office_small'];

  for (const name of rooms) {
    it(`keeps its promises in the ${name.replace('_', ' ')}, whichever way the user faces`, async () => {
      const room = await loadSemRoom(name);
      const model = createRoomModel();
      model.update(room);
      const scene = buildRoomSceneNow(room);
      const outline = floorOutline(room);
      // Standing in the middle of the floor, turning round in eight steps.
      const corners = outline.slice(0, 4);
      const head = {
        x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
        y: corners[0].y + 1.6,
        z: corners.reduce((sum, point) => sum + point.z, 0) / corners.length,
      };
      for (let step = 0; step < 8; step++) {
        const angle = (step * Math.PI) / 4;
        const placement = model.place({
          head,
          forward: { x: Math.sin(angle), y: 0, z: -Math.cos(angle) },
          depthProbes: [],
        });
        expect(placement.level).not.toBe('fallback');
        expect(placement.clearance).toBeGreaterThanOrEqual(PROMISED_CLEARANCE[placement.level]);
        expect(containsPoint(outline, placement.position)).toBe(true);
        // Nothing the grid holds between the eyes (past the first 20 cm) and his centre.
        const { position } = placement;
        const length = Math.hypot(position.x - head.x, position.y - head.y, position.z - head.z);
        const start = 0.2 / length;
        const from = {
          x: head.x + (position.x - head.x) * start,
          y: head.y + (position.y - head.y) * start,
          z: head.z + (position.z - head.z) * start,
        };
        if (scene.grid === null) throw new Error('The room has no grid.');
        expect(firstBlockedFraction(scene.grid, from, position)).toBe(Number.POSITIVE_INFINITY);
      }
    });
  }
});
