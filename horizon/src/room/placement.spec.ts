import { describe, expect, it } from 'bun:test';
import { containsPoint, type FloorPoint } from './floor-polygon';
import { createRoomModel } from './room-model';
import { boxMesh, type FloorRectangle, horizontalPlane, roomPlanes, roomScan, verticalPlane } from './synthetic-rooms';
import type { Placement, PlacementRequest, RoomSnapshot, SceneMesh, ScenePlane, Vector3Like } from './types';

/** A living room 6 m by 5 m and 2.6 m high, with a couch on the east wall and a coffee table beside the middle. */
const LIVING_ROOM: FloorRectangle = { minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5 };
const LIVING_ROOM_HEIGHT = 2.6;
const COUCH = boxMesh('couch', { minX: 2.1, maxX: 3, minZ: -1, maxZ: 1 }, 0.9);
const COFFEE_TABLE = boxMesh('table', { minX: 0.8, maxX: 1.8, minZ: -0.4, maxZ: 0.4 }, 0.45);
const COFFEE_TABLE_TOP = horizontalPlane('table', { minX: 0.8, maxX: 1.8, minZ: -0.4, maxZ: 0.4 }, 0.45);

/** Standing at the south end of the living room, looking north. */
const STANDING: PlacementRequest = {
  head: { x: 0, y: 1.65, z: 1.8 },
  forward: { x: 0, y: 0, z: -1 },
  depthProbes: [],
};

function snapshot(planes: ScenePlane[], meshes: SceneMesh[], epoch = 0): RoomSnapshot {
  return { planes, meshes, epoch };
}

function livingRoom(): RoomSnapshot {
  return snapshot([...roomPlanes(LIVING_ROOM, LIVING_ROOM_HEIGHT), COFFEE_TABLE_TOP], [COUCH, COFFEE_TABLE]);
}

function place(room: RoomSnapshot, request: PlacementRequest): Placement {
  const model = createRoomModel();
  model.update(room);
  return model.place(request);
}

function distanceAlongFloor(first: Vector3Like, second: Vector3Like): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

/** Whether the segment from `from` to `to` passes through the axis-aligned box (slab test). */
function segmentHitsBox(from: Vector3Like, to: Vector3Like, min: Vector3Like, max: Vector3Like): boolean {
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-12) {
      if (from[axis] < min[axis] || from[axis] > max[axis]) return false;
      continue;
    }
    const first = (min[axis] - from[axis]) / delta;
    const second = (max[axis] - from[axis]) / delta;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return enter <= exit;
}

function outlineOf(area: FloorRectangle): FloorPoint[] {
  return [
    { x: area.minX, z: area.minZ },
    { x: area.maxX, z: area.minZ },
    { x: area.maxX, z: area.maxZ },
    { x: area.minX, z: area.maxZ },
  ];
}

describe('placement in an open living room', () => {
  it('puts him full size about 1.6 m ahead, with room around him', () => {
    const placement = place(livingRoom(), STANDING);
    expect(placement.level).toBe('full');
    expect(placement.radius).toBe(0.22);
    expect(placement.needsPointer).toBe(false);
    expect(placement.clearance).toBeGreaterThanOrEqual(0.5);
    expect(distanceAlongFloor(placement.position, STANDING.head)).toBeCloseTo(1.6, 0);
    expect(Math.abs(placement.position.x)).toBeLessThan(0.4);
    // A little below the eyes, where a standing person looks without tipping their head.
    expect(placement.position.y).toBeCloseTo(1.5, 1);
    expect(containsPoint(outlineOf(LIVING_ROOM), placement.position)).toBe(true);
  });

  it('works from the planes alone, as a Quest 2 sees the room', () => {
    const placement = place(snapshot([...roomPlanes(LIVING_ROOM, LIVING_ROOM_HEIGHT), COFFEE_TABLE_TOP], []), STANDING);
    expect(placement.level).toBe('full');
    expect(placement.clearance).toBeGreaterThanOrEqual(0.5);
    expect(distanceAlongFloor(placement.position, STANDING.head)).toBeCloseTo(1.6, 0);
  });

  it('works from the furniture boxes alone', () => {
    const placement = place(snapshot([], [COUCH, COFFEE_TABLE]), STANDING);
    expect(placement.level).toBe('full');
    expect(placement.clearance).toBeGreaterThanOrEqual(0.5);
    expect(distanceAlongFloor(placement.position, STANDING.head)).toBeCloseTo(1.6, 0);
  });

  it('works from the room scan alone', () => {
    const scan = roomScan(roomPlanes(LIVING_ROOM, LIVING_ROOM_HEIGHT), [COUCH, COFFEE_TABLE]);
    const placement = place(snapshot([], [scan]), STANDING);
    expect(placement.level).toBe('full');
    expect(placement.clearance).toBeGreaterThanOrEqual(0.5);
    expect(distanceAlongFloor(placement.position, STANDING.head)).toBeCloseTo(1.6, 0);
    expect(containsPoint(outlineOf(LIVING_ROOM), placement.position)).toBe(true);
  });

  it('steps aside from a wardrobe straight ahead, to a spot the user can see', () => {
    const wardrobeArea = { minX: -0.5, maxX: 0.5, minZ: -0.05, maxZ: 0.45 };
    const wardrobe = boxMesh('shelf', wardrobeArea, 2);
    const room = snapshot(roomPlanes(LIVING_ROOM, LIVING_ROOM_HEIGHT), [wardrobe]);
    const placement = place(room, STANDING);
    expect(placement.level).toBe('full');
    expect(placement.clearance).toBeGreaterThanOrEqual(0.5);
    const min = { x: wardrobeArea.minX, y: 0, z: wardrobeArea.minZ };
    const max = { x: wardrobeArea.maxX, y: 2, z: wardrobeArea.maxZ };
    expect(segmentHitsBox(STANDING.head, placement.position, min, max)).toBe(false);
    expect(Math.abs(placement.position.x)).toBeGreaterThan(0.5);
  });

  it('goes further round, with a pointer to him, when nothing in the comfortable cone is in sight', () => {
    // Half a metre from a tall room divider a metre wide: everything within 35° is behind it.
    const divider = boxMesh('shelf', { minX: -0.5, maxX: 0.5, minZ: -0.1, maxZ: 0 }, 2.4);
    const request = { ...STANDING, head: { x: 0, y: 1.65, z: 0.5 } };
    const placement = place(snapshot(roomPlanes(LIVING_ROOM, LIVING_ROOM_HEIGHT), [divider]), request);
    expect(placement.level).toBe('wide');
    expect(placement.needsPointer).toBe(true);
    expect(placement.radius).toBe(0.22);
    const angle = Math.atan2(Math.abs(placement.position.x), request.head.z - placement.position.z);
    expect(angle).toBeGreaterThan((35 * Math.PI) / 180);
    expect(angle).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-9);
    const min = { x: -0.5, y: 0, z: -0.1 };
    const max = { x: 0.5, y: 2.4, z: 0 };
    expect(segmentHitsBox(request.head, placement.position, min, max)).toBe(false);
  });

  it('keeps out of the way of something the depth sensor sees but the room data does not', () => {
    // Someone standing 1.2 m ahead, level with the eyes.
    const request = { ...STANDING, depthProbes: [{ direction: { x: 0, y: 0, z: -1 }, distance: 1.2 }] };
    const placement = place(livingRoom(), request);
    expect(placement.level).toBe('full');
    const offset = {
      x: placement.position.x - request.head.x,
      y: placement.position.y - request.head.y,
      z: placement.position.z - request.head.z,
    };
    // Off the probe's ray by at least his clearance, or else well short of what it hit.
    const across = Math.hypot(offset.x, offset.y);
    const along = -offset.z;
    expect(across >= 0.5 || along + 0.5 <= 1.2).toBe(true);
  });

  it('stays where he was when the head has only turned a little', () => {
    const model = createRoomModel();
    model.update(livingRoom());
    const first = model.place(STANDING);
    const turn = (8 * Math.PI) / 180;
    const turned = { ...STANDING, forward: { x: Math.sin(turn), y: 0, z: -Math.cos(turn) } };
    const again = model.place({ ...turned, previous: first.position, previousEpoch: first.epoch });
    expect(distanceAlongFloor(again.position, first.position)).toBeLessThan(0.01);
    // Without the previous spot, the best one follows the gaze.
    expect(distanceAlongFloor(model.place(turned).position, first.position)).toBeGreaterThan(0.1);
  });
});

describe('placement at a desk facing a wall', () => {
  // A 3 m square study; the user sits 1.1 m from the north wall, a desk against it.
  const study: FloorRectangle = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };
  const deskArea = { minX: -0.6, maxX: 0.6, minZ: -1.5, maxZ: -0.9 };
  const seated: PlacementRequest = { head: { x: 0, y: 1.2, z: -0.4 }, forward: { x: 0, y: 0, z: -1 }, depthProbes: [] };
  const room = snapshot(
    [...roomPlanes(study, 2.5), horizontalPlane('desk', deskArea, 0.75)],
    [boxMesh('desk', deskArea, 0.75)],
  );

  it('squeezes him in above the desk rather than into the wall', () => {
    const placement = place(room, seated);
    expect(placement.level).toBe('small');
    expect(placement.radius).toBe(0.13);
    expect(placement.clearance).toBeGreaterThanOrEqual(0.3);
    // In front of the wall with room to spare, and above the desk.
    expect(placement.position.z).toBeGreaterThan(study.minZ + 0.3);
    expect(placement.position.z).toBeLessThan(seated.head.z - 0.5);
    expect(placement.position.y).toBeGreaterThan(0.75 + 0.3);
  });
});

describe('placement in a flat of two rooms', () => {
  // Room A to the south, room B to the north, one wall between them with a doorway in it.
  const roomA: FloorRectangle = { minX: -2, maxX: 2, minZ: 0, maxZ: 3 };
  const roomB: FloorRectangle = { minX: -2, maxX: 2, minZ: -4, maxZ: 0 };
  const height = 2.5;
  const shared = [
    verticalPlane('wall', { x: -2, z: 0 }, { x: -0.6, z: 0 }, 0, height),
    verticalPlane('wall', { x: 0.6, z: 0 }, { x: 2, z: 0 }, 0, height),
    verticalPlane('wall', { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 2.1, height),
  ];
  const outer = (area: FloorRectangle, openSide: 'north' | 'south') => {
    const { minX, maxX, minZ, maxZ } = area;
    const walls = [
      verticalPlane('wall', { x: maxX, z: minZ }, { x: maxX, z: maxZ }, 0, height),
      verticalPlane('wall', { x: minX, z: maxZ }, { x: minX, z: minZ }, 0, height),
    ];
    const far =
      openSide === 'north'
        ? verticalPlane('wall', { x: maxX, z: maxZ }, { x: minX, z: maxZ }, 0, height)
        : verticalPlane('wall', { x: minX, z: minZ }, { x: maxX, z: minZ }, 0, height);
    return [horizontalPlane('floor', area, 0), horizontalPlane('ceiling', area, height, true), ...walls, far];
  };
  const flat = snapshot([...outer(roomA, 'north'), ...outer(roomB, 'south'), ...shared], []);

  it('never puts him through the doorway into the next room', () => {
    // 1.4 m from the doorway, looking through it: the most open spot is in room B.
    const request: PlacementRequest = {
      head: { x: 0, y: 1.65, z: 1.4 },
      forward: { x: 0, y: 0, z: -1 },
      depthProbes: [],
    };
    const placement = place(flat, request);
    expect(containsPoint(outlineOf(roomA), placement.position)).toBe(true);
    expect(containsPoint(outlineOf(roomB), placement.position)).toBe(false);
    expect(placement.clearance).toBeGreaterThanOrEqual(0.35);
  });
});

describe('placement with nothing known about the room', () => {
  it('falls back to a small hologram 1.2 m ahead', () => {
    const placement = place(snapshot([], []), STANDING);
    expect(placement.level).toBe('fallback');
    expect(placement.radius).toBe(0.13);
    expect(placement.clearance).toBe(Number.POSITIVE_INFINITY);
    expect(placement.position.x).toBeCloseTo(0, 6);
    expect(placement.position.z).toBeCloseTo(STANDING.head.z - 1.2, 6);
  });

  it('pulls the fallback in front of whatever the depth sensor sees ahead', () => {
    const request = { ...STANDING, depthProbes: [{ direction: { x: 0, y: 0, z: -1 }, distance: 0.9 }] };
    const placement = place(snapshot([], []), request);
    expect(placement.level).toBe('fallback');
    expect(placement.position.z).toBeCloseTo(STANDING.head.z - 0.6, 6);
  });

  it('ignores depth hits so close that they are the user’s own hands', () => {
    const request = { ...STANDING, depthProbes: [{ direction: { x: 0, y: 0, z: -1 }, distance: 0.3 }] };
    expect(place(snapshot([], []), request).position.z).toBeCloseTo(STANDING.head.z - 1.2, 6);
  });
});

describe('placement after the headset recentres', () => {
  it('forgets the previous spot once the reference space has moved under it', () => {
    const model = createRoomModel();
    model.update(livingRoom());
    const before = model.place(STANDING);
    expect(before.epoch).toBe(0);

    // Recentred: the same room, now half a metre further north in the new reference space.
    const moved = (plane: ScenePlane): ScenePlane => {
      const pose = new Float32Array(plane.pose);
      pose[14] -= 0.5;
      return { ...plane, pose };
    };
    const movedMesh = (mesh: SceneMesh): SceneMesh => {
      const pose = new Float32Array(mesh.pose);
      pose[14] -= 0.5;
      return { ...mesh, pose };
    };
    const room = livingRoom();
    const recentred = snapshot(room.planes.map(moved), room.meshes.map(movedMesh), 1);
    model.update(recentred);
    const after = model.place({ ...STANDING, previous: before.position, previousEpoch: before.epoch });
    expect(after.epoch).toBe(1);
    // Exactly what a model that never saw the old spot chooses.
    expect(after).toEqual(place(recentred, STANDING));
  });

  it('reports the epoch of the room it was built from', () => {
    const model = createRoomModel();
    model.update({ ...livingRoom(), epoch: 3 });
    expect(model.describe().epoch).toBe(3);
    expect(model.place(STANDING).epoch).toBe(3);
  });
});

describe('describe', () => {
  it('counts what the room is made of', () => {
    const model = createRoomModel();
    model.update(livingRoom());
    const description = model.describe();
    expect(description.planes).toBe(7);
    expect(description.meshes).toBe(2);
    expect(description.labels).toEqual({ floor: 1, ceiling: 1, wall: 4, table: 2, couch: 1 });
    expect(description.triangles).toBe(24);
    expect(description.voxels).toBeGreaterThan(0);
  });
});
