import { placeInRoom } from './placement';
import { buildRoomSceneNow, emptyRoomScene, type RoomScene } from './room-scene';
import type { RoomModel, RoomSnapshot } from './types';

/**
 * Placement on the calling thread: `update` builds the grid there and then, `place` reads it.
 *
 * What the tests use, and what the worker runs inside itself. The app uses
 * `createRoomModelWorker`, because building the grid for a scanned room takes long enough to
 * drop frames.
 */
export function createRoomModel(): RoomModel {
  let scene: RoomScene = emptyRoomScene(0);
  let built: RoomSnapshot | undefined;
  return {
    update(snapshot) {
      // The snapshot code hands back the same object when nothing has changed.
      if (snapshot === built) return;
      built = snapshot;
      scene = buildRoomSceneNow(snapshot);
    },
    place: (request) => placeInRoom(scene, request),
    describe: () => scene.description,
  };
}
