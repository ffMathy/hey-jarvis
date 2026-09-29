import type { Placement, PlacementRequest, RoomDescription, RoomSnapshot } from './types';

/**
 * What the page and the placement worker say to each other.
 *
 * The page sends snapshots as they change and asks for placements and descriptions; each
 * question carries an id, and the worker answers it by that id, in whatever order its answers
 * become ready.
 */

export type RoomWorkerRequest =
  | { kind: 'update'; snapshot: RoomSnapshot }
  | { kind: 'place'; id: number; request: PlacementRequest }
  | { kind: 'describe'; id: number };

export type RoomWorkerQuestion = Extract<RoomWorkerRequest, { id: number }>;

export type RoomWorkerResponse =
  | { kind: 'placed'; id: number; placement: Placement }
  | { kind: 'described'; id: number; description: RoomDescription }
  | { kind: 'failed'; id: number; message: string };

function hasKind(value: unknown): value is { kind: unknown; id?: unknown } {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

/**
 * Whether a message the worker received is one of the page's. Only the page posts to it, so
 * this checks the shape's tag rather than every field; what it keeps out is anything else a
 * browser or extension might deliver to a worker.
 */
export function isRoomWorkerRequest(value: unknown): value is RoomWorkerRequest {
  if (!hasKind(value)) return false;
  if (value.kind === 'update') return 'snapshot' in value;
  return (value.kind === 'place' || value.kind === 'describe') && typeof value.id === 'number';
}

/** Whether a message the page received is one of the worker's answers. */
export function isRoomWorkerResponse(value: unknown): value is RoomWorkerResponse {
  return (
    hasKind(value) &&
    (value.kind === 'placed' || value.kind === 'described' || value.kind === 'failed') &&
    typeof value.id === 'number'
  );
}
