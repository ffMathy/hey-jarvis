import { describe, expect, it } from 'bun:test';
import type { Placement, PlacementRequest, RoomDescription, RoomSnapshot, SceneFrame } from '../room';
import {
  createRoomPlacement,
  PLACEMENT_TIMEOUT_MS,
  type RoomModelLike,
  type RoomTrackerLike,
  SNAPSHOT_INTERVAL_MS,
} from './room-placement';

const FRAME: SceneFrame = { session: {}, getPose: () => null };

const REQUEST = {
  head: { x: 0, y: 1.6, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  depthProbes: [],
};

const DESCRIPTION: RoomDescription = { planes: 17, meshes: 9, labels: {}, triangles: 62102, voxels: 900, epoch: 0 };

function placementAt(z: number, epoch: number): Placement {
  return {
    position: { x: 0, y: 1.45, z },
    radius: 0.22,
    level: 'full',
    clearance: 0.8,
    needsPointer: false,
    epoch,
  };
}

/** A model that records what it was sent, and answers placements as the test decides. */
class FakeModel implements RoomModelLike {
  snapshots: RoomSnapshot[] = [];
  requests: PlacementRequest[] = [];
  answer: (request: PlacementRequest) => Promise<Placement> = async () => placementAt(-1.6, 0);
  describing: Array<(description: RoomDescription) => void> = [];
  disposed = false;

  update(snapshot: RoomSnapshot) {
    this.snapshots.push(snapshot);
  }

  place(request: PlacementRequest) {
    this.requests.push(request);
    return this.answer(request);
  }

  describe() {
    return new Promise<RoomDescription>((resolve) => this.describing.push(resolve));
  }

  dispose() {
    this.disposed = true;
  }
}

/** A room placement over a fake model, a tracker per space that counts its readings, and a clock the test moves. */
function roomPlacement() {
  const model = new FakeModel();
  const trackers: { space: string; takes: number; disposed: boolean }[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const clock = { now: 0 };
  const placement = createRoomPlacement<string>({
    model,
    track(space): RoomTrackerLike {
      const tracker = { space, takes: 0, disposed: false };
      trackers.push(tracker);
      return {
        take: () => {
          tracker.takes += 1;
          return { planes: [], meshes: [], epoch: 0 };
        },
        dispose: () => {
          tracker.disposed = true;
        },
      };
    },
    now: () => clock.now,
    setTimeout: (callback) => {
      const handle = nextTimer++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle) => timers.delete(handle),
  });
  const fireTimers = () => {
    for (const [handle, callback] of timers) {
      timers.delete(handle);
      callback();
    }
  };
  return { model, trackers, clock, placement, fireTimers };
}

describe('the room placement', () => {
  it('reads the room on the first frame, then a few times a second rather than every frame', () => {
    const { model, trackers, clock, placement } = roomPlacement();
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: false });
    clock.now = SNAPSHOT_INTERVAL_MS - 1;
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: false });
    expect(trackers[0]?.takes).toBe(1);
    clock.now = SNAPSHOT_INTERVAL_MS;
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: false });
    expect(trackers[0]?.takes).toBe(2);
    expect(model.snapshots).toHaveLength(2);
  });

  it('reads the room at once when a summon is waiting on the frame', () => {
    const { trackers, clock, placement } = roomPlacement();
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: false });
    clock.now = 10;
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: true });
    expect(trackers[0]?.takes).toBe(2);
  });

  it('starts a tracker of its own for a new reference space, and lets go of the old one', () => {
    const { trackers, clock, placement } = roomPlacement();
    placement.observe({ frame: FRAME, referenceSpace: 'first', summoning: false });
    clock.now = SNAPSHOT_INTERVAL_MS;
    placement.observe({ frame: FRAME, referenceSpace: 'second', summoning: false });
    expect(trackers.map((tracker) => [tracker.space, tracker.disposed])).toEqual([
      ['first', true],
      ['second', false],
    ]);
  });

  it('hands the last spot back with the epoch it was placed in, so one from before a recentre is ignored', async () => {
    const { model, placement } = roomPlacement();
    model.answer = async () => placementAt(-1.6, 3);
    const first = await placement.place(REQUEST);
    expect(model.requests[0]?.previousEpoch).toBeUndefined();
    await placement.place({ ...REQUEST, previous: first.position });
    expect(model.requests[1]).toMatchObject({ previous: first.position, previousEpoch: 3 });
  });

  it('gives up on a model that has stopped answering, so the room can use its fallback spot', async () => {
    const { model, placement, fireTimers } = roomPlacement();
    model.answer = () => new Promise<Placement>(() => undefined);
    const placing = placement.place(REQUEST);
    fireTimers();
    await expect(placing).rejects.toThrow('The room model did not answer in time.');
    expect(PLACEMENT_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });

  it('describes the room as last described, asking again in the background one question at a time', async () => {
    const { model, placement } = roomPlacement();
    expect(placement.describe()).toBeUndefined();
    expect(placement.describe()).toBeUndefined();
    expect(model.describing).toHaveLength(1);
    model.describing[0]?.(DESCRIPTION);
    await Promise.resolve();
    expect(placement.describe()).toEqual(DESCRIPTION);
    expect(model.describing).toHaveLength(2);
  });

  it('lets go of the tracker and the model, and reads nothing more', () => {
    const { model, trackers, clock, placement } = roomPlacement();
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: false });
    placement.dispose();
    clock.now = SNAPSHOT_INTERVAL_MS;
    placement.observe({ frame: FRAME, referenceSpace: 'floor', summoning: true });
    expect(model.disposed).toBe(true);
    expect(trackers[0]?.disposed).toBe(true);
    expect(trackers).toHaveLength(1);
  });
});
