import { describe, expect, it } from 'bun:test';
import { createRoomModel } from './room-model';
import { createRoomWorkerHost } from './room-worker-host';
import type { RoomWorkerResponse } from './room-worker-protocol';
import { boxMesh, roomPlanes } from './synthetic-rooms';
import type { PlacementRequest, RoomSnapshot } from './types';

const STANDING: PlacementRequest = {
  head: { x: 0, y: 1.65, z: 1.8 },
  forward: { x: 0, y: 0, z: -1 },
  depthProbes: [],
};

/** A 6 × 5 m room, optionally with a wardrobe straight ahead of `STANDING` that pushes him aside. */
function room(epoch: number, wardrobe: boolean): RoomSnapshot {
  const meshes = wardrobe ? [boxMesh('shelf', { minX: -0.5, maxX: 0.5, minZ: -0.05, maxZ: 0.45 }, 2)] : [];
  return { planes: roomPlanes({ minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5 }, 2.6), meshes, epoch };
}

/** A host driven by hand: slices run only when the spec says, and a slice does one step of work. */
function hostWithManualClock() {
  const responses: RoomWorkerResponse[] = [];
  const scheduled: (() => void)[] = [];
  let time = 0;
  const host = createRoomWorkerHost(
    (response) => responses.push(response),
    (callback) => scheduled.push(callback),
    // Every reading of the clock is a whole slice later, so each slice runs one step.
    () => {
      time += 1000;
      return time;
    },
  );
  const runOneSlice = () => scheduled.shift()?.();
  const runAll = () => {
    while (scheduled.length > 0) runOneSlice();
  };
  return { host, responses, runOneSlice, runAll };
}

function placementIn(responses: RoomWorkerResponse[], id: number) {
  const response = responses.find((candidate) => candidate.id === id);
  if (response?.kind !== 'placed') throw new Error(`No placement for question ${id}.`);
  return response.placement;
}

describe('the placement worker', () => {
  it('builds in slices and answers from the finished grid', () => {
    const { host, responses, runOneSlice, runAll } = hostWithManualClock();
    host.receive({ kind: 'update', snapshot: room(0, true) });
    runOneSlice();
    runAll();
    host.receive({ kind: 'place', id: 1, request: STANDING });
    const expected = createRoomModel();
    expected.update(room(0, true));
    expect(placementIn(responses, 1)).toEqual(expected.place(STANDING));
  });

  it('answers from the last grid while it builds the next one of the same room', () => {
    const { host, responses, runOneSlice, runAll } = hostWithManualClock();
    host.receive({ kind: 'update', snapshot: room(0, false) });
    runAll();
    host.receive({ kind: 'update', snapshot: room(0, true) });
    runOneSlice();
    host.receive({ kind: 'place', id: 1, request: STANDING });
    // Straight ahead, as in the room without the wardrobe, answered at once.
    expect(placementIn(responses, 1).position.x).toBeCloseTo(0, 6);
    runAll();
    host.receive({ kind: 'place', id: 2, request: STANDING });
    expect(Math.abs(placementIn(responses, 2).position.x)).toBeGreaterThan(0.5);
  });

  it('makes questions wait for the new grid after a recentre', () => {
    const { host, responses, runOneSlice, runAll } = hostWithManualClock();
    host.receive({ kind: 'update', snapshot: room(0, false) });
    runAll();
    host.receive({ kind: 'update', snapshot: room(1, true) });
    runOneSlice();
    host.receive({ kind: 'place', id: 1, request: STANDING });
    host.receive({ kind: 'describe', id: 2 });
    expect(responses).toEqual([]);
    runAll();
    expect(placementIn(responses, 1).epoch).toBe(1);
    expect(Math.abs(placementIn(responses, 1).position.x)).toBeGreaterThan(0.5);
    const description = responses.find((response) => response.id === 2);
    expect(description?.kind === 'described' && description.description.epoch).toBe(1);
  });

  it('finishes the build under way before starting on a newer snapshot of the same room', () => {
    const { host, responses, runOneSlice, runAll } = hostWithManualClock();
    host.receive({ kind: 'update', snapshot: room(0, true) });
    runOneSlice();
    // A room that keeps changing: without queueing, each of these would start the build over.
    for (let change = 0; change < 5; change++) {
      host.receive({ kind: 'update', snapshot: room(0, change % 2 === 0) });
      runOneSlice();
    }
    runAll();
    host.receive({ kind: 'describe', id: 1 });
    const answer = responses.find((response) => response.id === 1);
    // The last one sent (change 4, with the wardrobe) is the one built in the end.
    expect(answer?.kind === 'described' && answer.description.meshes).toBe(1);
  });

  it('makes questions wait for the first grid once a snapshot has arrived', () => {
    const { host, responses, runOneSlice, runAll } = hostWithManualClock();
    host.receive({ kind: 'update', snapshot: room(0, true) });
    runOneSlice();
    host.receive({ kind: 'place', id: 1, request: STANDING });
    expect(responses).toEqual([]);
    runAll();
    expect(placementIn(responses, 1).level).toBe('full');
  });

  it('answers before any snapshot as a room nothing is known about', () => {
    const { host, responses } = hostWithManualClock();
    host.receive({ kind: 'place', id: 1, request: STANDING });
    expect(placementIn(responses, 1).level).toBe('fallback');
  });
});
