import { createRoomModel } from './room-model';
import {
  isRoomWorkerResponse,
  type RoomWorkerQuestion,
  type RoomWorkerRequest,
  type RoomWorkerResponse,
} from './room-worker-protocol';
import type { Placement, PlacementRequest, RoomDescription, RoomModel, RoomSnapshot } from './types';

/**
 * Placement in a worker, so building the grid for a scanned room never costs the headset a frame.
 *
 * The same questions as `createRoomModel`, answered asynchronously. `place` is answered from the
 * last grid the worker finished building, even while it builds the next — except after a
 * recentre, when it waits for the grid of the new reference space.
 *
 * If the worker cannot start, or fails, placement carries on in the page instead: slower to
 * rebuild, but a hologram that appears is worth more than a thread kept free.
 */

export interface RoomModelWorker {
  /** Hands the worker a new snapshot; the same object as last time is not sent again. */
  update(snapshot: RoomSnapshot): void;
  place(request: PlacementRequest): Promise<Placement>;
  describe(): Promise<RoomDescription>;
  /** Stops the worker; questions still unanswered reject. */
  dispose(): void;
}

/** The part of a `Worker` this uses, so the specs can hand in one of their own. */
export interface RoomWorkerPort extends EventTarget {
  postMessage(message: RoomWorkerRequest): void;
  terminate(): void;
}

export interface RoomModelWorkerOptions {
  /** Starts the worker. Defaults to the bundled `room-worker.ts` as a module worker. */
  createWorker?: () => RoomWorkerPort;
}

/** An answer to a question, as opposed to a report that it could not be answered. */
type Answer = Exclude<RoomWorkerResponse, { kind: 'failed' }>;

interface Pending {
  question: RoomWorkerQuestion;
  settle: (answer: Answer) => void;
  reject: (error: Error) => void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function startRoomWorker(): RoomWorkerPort {
  // Written out in full so Vite sees the pattern, bundles the worker and rewrites the URL.
  return new Worker(new URL('./room-worker.ts', import.meta.url), { type: 'module' });
}

/**
 * A snapshot with nothing but its data in it. What `snapshotRoom` returns also remembers the
 * XR objects it was copied from, which cannot be posted to a worker.
 */
function postable(snapshot: RoomSnapshot): RoomSnapshot {
  return {
    epoch: snapshot.epoch,
    planes: snapshot.planes.map(({ label, pose, polygon }) => ({ label, pose, polygon })),
    meshes: snapshot.meshes.map(({ label, pose, vertices, indices }) => ({ label, pose, vertices, indices })),
  };
}

export function createRoomModelWorker(options: RoomModelWorkerOptions = {}): RoomModelWorker {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let latest: RoomSnapshot | undefined;
  let worker: RoomWorkerPort | null = null;
  let inPage: RoomModel | null = null;
  let disposed = false;

  function answerInPage(model: RoomModel, entry: Pending) {
    const { question } = entry;
    try {
      entry.settle(
        question.kind === 'place'
          ? { kind: 'placed', id: question.id, placement: model.place(question.request) }
          : { kind: 'described', id: question.id, description: model.describe() },
      );
    } catch (error) {
      entry.reject(asError(error));
    }
  }

  /** Gives up on the worker and answers everything, from now on, in the page. */
  function carryOnInPage() {
    worker?.terminate();
    worker = null;
    const model = createRoomModel();
    if (latest !== undefined) model.update(latest);
    inPage = model;
    for (const entry of pending.values()) answerInPage(model, entry);
    pending.clear();
  }

  function receive(event: Event) {
    if (!(event instanceof MessageEvent) || !isRoomWorkerResponse(event.data)) return;
    const response = event.data;
    const entry = pending.get(response.id);
    if (entry === undefined) return;
    pending.delete(response.id);
    if (response.kind === 'failed') entry.reject(new Error(response.message));
    else entry.settle(response);
  }

  try {
    worker = (options.createWorker ?? startRoomWorker)();
    worker.addEventListener('message', receive);
    worker.addEventListener('error', carryOnInPage);
    worker.addEventListener('messageerror', carryOnInPage);
  } catch {
    carryOnInPage();
  }

  /** Asks the worker, or the page once the worker is gone, and reads the answer with `read`. */
  function ask<Result>(question: RoomWorkerQuestion, read: (answer: Answer) => Result): Promise<Result> {
    return new Promise((resolve, reject) => {
      const settle = (answer: Answer) => {
        try {
          resolve(read(answer));
        } catch (error) {
          reject(asError(error));
        }
      };
      const entry = { question, settle, reject };
      if (disposed) reject(new Error('The room model has been disposed.'));
      else if (inPage !== null) answerInPage(inPage, entry);
      else {
        pending.set(question.id, entry);
        worker?.postMessage(question);
      }
    });
  }

  return {
    update(snapshot) {
      if (disposed || snapshot === latest) return;
      latest = snapshot;
      if (inPage !== null) inPage.update(snapshot);
      else worker?.postMessage({ kind: 'update', snapshot: postable(snapshot) });
    },
    place(request) {
      return ask({ kind: 'place', id: nextId++, request }, (answer) => {
        if (answer.kind !== 'placed') throw new Error('The placement worker answered a placement with a description.');
        return answer.placement;
      });
    },
    describe() {
      return ask({ kind: 'describe', id: nextId++ }, (answer) => {
        if (answer.kind !== 'described')
          throw new Error('The placement worker answered a description with a placement.');
        return answer.description;
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      for (const entry of pending.values()) entry.reject(new Error('The room model has been disposed.'));
      pending.clear();
    },
  };
}
