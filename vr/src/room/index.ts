/**
 * Where Jarvis stands in the room.
 *
 * `createRoomTracker` (or `snapshotRoom` with `watchResets`) reads the headset's planes and
 * meshes inside an XR frame; `createRoomModelWorker` turns each new snapshot into an occupancy
 * grid off the main thread and answers `place` from it. `createRoomModel` is the same on the
 * calling thread, for tests and for anything with no frame to lose.
 */

export { RESTING_RADIUS, SQUEEZED_RADIUS } from './placement';
export { createRoomModel } from './room-model';
export {
  createRoomModelWorker,
  type RoomModelWorker,
  type RoomModelWorkerOptions,
  type RoomWorkerPort,
} from './room-model-worker';
export {
  createRoomTracker,
  type LiveRoomSnapshot,
  type MeshSource,
  type PlaneSource,
  type ResettableSpace,
  type ResetWatch,
  type RoomTracker,
  type SceneFrame,
  snapshotRoom,
  watchResets,
} from './room-snapshot';
export type {
  DepthProbe,
  Placement,
  PlacementLevel,
  PlacementRequest,
  RoomDescription,
  RoomModel,
  RoomSnapshot,
  SceneMesh,
  ScenePlane,
  Vector3Like,
} from './types';
