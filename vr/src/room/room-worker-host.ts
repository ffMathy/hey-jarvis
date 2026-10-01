import { placeInRoom } from './placement';
import { buildRoomScene, emptyRoomScene, type RoomScene } from './room-scene';
import type { RoomWorkerQuestion, RoomWorkerRequest, RoomWorkerResponse } from './room-worker-protocol';
import type { RoomSnapshot } from './types';

/**
 * The placement worker's side of the conversation, apart from the worker itself so the specs
 * can drive it with a clock of their own.
 *
 * A new snapshot is built in slices of a few milliseconds, with the event loop let through in
 * between, so a placement asked for meanwhile is answered straight away from the grid built
 * last — the room rarely changes enough between two snapshots to matter. The exceptions are
 * the first snapshot, before which there is no grid to answer from, and a recentre, after which
 * the previous grid is in a reference space that no longer exists: questions then wait for the
 * new one.
 *
 * Snapshots that arrive while a build is under way are not allowed to start it over, or a room
 * that kept changing would never be built at all: the newest one waits its turn and is built
 * next, and the ones before it are dropped. Only a recentre cuts a build short, since what it
 * was building is already out of date.
 */

/** Work done between two turns of the worker's event loop, milliseconds. */
const SLICE_MILLISECONDS = 8;

export interface RoomWorkerHost {
  receive(message: RoomWorkerRequest): void;
}

interface Build {
  steps: Generator<void, RoomScene, void>;
  epoch: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRoomWorkerHost(
  post: (response: RoomWorkerResponse) => void,
  schedule: (callback: () => void) => void,
  now: () => number = () => performance.now(),
): RoomWorkerHost {
  const unknownRoom = emptyRoomScene(0);
  /** The last scene built, or null before the first. */
  let scene: RoomScene | null = null;
  let build: Build | null = null;
  let next: RoomSnapshot | null = null;
  let sliceScheduled = false;
  const waiting: RoomWorkerQuestion[] = [];

  function answer(question: RoomWorkerQuestion) {
    const current = scene ?? unknownRoom;
    try {
      if (question.kind === 'place') {
        post({ kind: 'placed', id: question.id, placement: placeInRoom(current, question.request) });
      } else {
        post({ kind: 'described', id: question.id, description: current.description });
      }
    } catch (error) {
      post({ kind: 'failed', id: question.id, message: describeError(error) });
    }
  }

  function start(snapshot: RoomSnapshot) {
    build = { steps: buildRoomScene(snapshot), epoch: snapshot.epoch };
    scheduleSlice();
  }

  function finish(built: RoomScene) {
    scene = built;
    build = null;
    for (const question of waiting.splice(0)) answer(question);
    if (next !== null) {
      start(next);
      next = null;
    }
  }

  /** Runs the build until it is done or its slice is used up, and books the next slice if not. */
  function slice() {
    sliceScheduled = false;
    if (build === null) return;
    const deadline = now() + SLICE_MILLISECONDS;
    try {
      // At least one step a slice, however slow the step before was, so a build always ends.
      do {
        const step = build.steps.next();
        if (step.done === true) return finish(step.value);
      } while (now() < deadline);
    } catch (error) {
      // A room that cannot be built is treated as a room nothing is known about, which still
      // places him — small, ahead — rather than leaving every question unanswered.
      const failed = emptyRoomScene(build.epoch);
      failed.description.problem = `The room could not be read: ${describeError(error)}`;
      return finish(failed);
    }
    scheduleSlice();
  }

  function scheduleSlice() {
    if (sliceScheduled) return;
    sliceScheduled = true;
    schedule(slice);
  }

  return {
    receive(message) {
      if (message.kind === 'update') {
        const { snapshot } = message;
        if (build === null || build.epoch !== snapshot.epoch) {
          next = null;
          start(snapshot);
        } else {
          next = snapshot;
        }
        return;
      }
      if (build !== null && (scene === null || build.epoch !== scene.epoch)) waiting.push(message);
      else answer(message);
    },
  };
}
