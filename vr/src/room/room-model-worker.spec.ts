import { afterEach, describe, expect, it } from 'bun:test';
import { createRoomModel } from './room-model';
import { createRoomModelWorker, type RoomModelWorker, type RoomWorkerPort } from './room-model-worker';
import type { RoomWorkerRequest } from './room-worker-protocol';
import { boxMesh, roomPlanes } from './synthetic-rooms';
import type { PlacementRequest, RoomSnapshot } from './types';

const STANDING: PlacementRequest = {
  head: { x: 0, y: 1.65, z: 1.8 },
  forward: { x: 0, y: 0, z: -1 },
  depthProbes: [],
};

function livingRoom(): RoomSnapshot {
  return {
    planes: roomPlanes({ minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5 }, 2.6),
    meshes: [boxMesh('shelf', { minX: -0.5, maxX: 0.5, minZ: -0.05, maxZ: 0.45 }, 2)],
    epoch: 0,
  };
}

function expectedPlacement(room: RoomSnapshot, request: PlacementRequest) {
  const model = createRoomModel();
  model.update(room);
  return model.place(request);
}

/** A worker that takes messages and never answers, and can be made to fail. */
class SilentWorker extends EventTarget implements RoomWorkerPort {
  readonly received: RoomWorkerRequest[] = [];
  terminated = false;
  postMessage(message: RoomWorkerRequest) {
    this.received.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

let model: RoomModelWorker | undefined;
afterEach(() => model?.dispose());

describe('placement in a worker', () => {
  it('gives the same answers as placement on the page', async () => {
    model = createRoomModelWorker();
    const room = livingRoom();
    model.update(room);
    expect(await model.place(STANDING)).toEqual(expectedPlacement(room, STANDING));
    const description = await model.describe();
    expect(description.planes).toBe(6);
    expect(description.meshes).toBe(1);
  });

  it('does not post the XR objects a live snapshot remembers', async () => {
    const worker = new SilentWorker();
    model = createRoomModelWorker({ createWorker: () => worker });
    const live = Object.assign(livingRoom(), { sources: new Map([[{}, 'not cloneable']]) });
    model.update(live);
    model.update(live);
    expect(worker.received).toHaveLength(1);
    const [message] = worker.received;
    expect(message.kind === 'update' && Object.keys(message.snapshot).sort()).toEqual(['epoch', 'meshes', 'planes']);
  });

  it('carries on in the page when the worker fails, answering what was already asked', async () => {
    const worker = new SilentWorker();
    model = createRoomModelWorker({ createWorker: () => worker });
    const room = livingRoom();
    model.update(room);
    const answer = model.place(STANDING);
    worker.dispatchEvent(new Event('error'));
    expect(worker.terminated).toBe(true);
    expect(await answer).toEqual(expectedPlacement(room, STANDING));
    expect(await model.place(STANDING)).toEqual(expectedPlacement(room, STANDING));
  });

  it('carries on in the page when the worker cannot start at all', async () => {
    model = createRoomModelWorker({
      createWorker: () => {
        throw new Error('Workers are not allowed here.');
      },
    });
    const room = livingRoom();
    model.update(room);
    expect(await model.place(STANDING)).toEqual(expectedPlacement(room, STANDING));
  });

  it('rejects what is still unanswered when disposed', async () => {
    const worker = new SilentWorker();
    model = createRoomModelWorker({ createWorker: () => worker });
    const answer = model.place(STANDING);
    model.dispose();
    await expect(answer).rejects.toThrow('disposed');
    await expect(model.describe()).rejects.toThrow('disposed');
  });
});
