import type { Placement, PlacementRequest, RoomDescription, RoomSnapshot, SceneFrame } from '../room';
import type { PlacementLike, PlacementRequestLike, RoomDescriptionLike } from './ports';

/**
 * Placement for the room, from `src/room/`'s model: the room read out of XR frames, a spot chosen
 * from it in a worker.
 *
 * The one port with an adapter between it and its module, for two reasons. The planes and meshes
 * can only be read inside an XR frame, so the room hands this every frame and it decides when to
 * read them: a few times a second, which keeps the grid current without paying for a snapshot every
 * frame, and at once when a summon is waiting, so he is placed against what the headset knows at
 * that moment. And the model answers from a worker, asynchronously, while the HUD reads its
 * description every half second; so the description is kept here and asked for again in the
 * background.
 */

/** How often the room is read while nothing is being placed, in milliseconds. */
export const SNAPSHOT_INTERVAL_MS = 300;

/**
 * How long a placement may take before the room gives up on the model and uses its fallback spot.
 *
 * The first placement of a session waits for the first grid, which on a Quest should take about
 * half a second; five seconds is a model that has stopped answering, and a summon that never
 * arrives is worse than one that arrives small and straight ahead.
 */
export const PLACEMENT_TIMEOUT_MS = 5000;

/** What this needs of `createRoomModelWorker`. */
export interface RoomModelLike {
  update(snapshot: RoomSnapshot): void;
  place(request: PlacementRequest): Promise<Placement>;
  describe(): Promise<RoomDescription>;
  dispose(): void;
}

/** What this needs of `createRoomTracker`. */
export interface RoomTrackerLike {
  take(frame: SceneFrame): RoomSnapshot;
  dispose(): void;
}

/**
 * One frame, as the room hands it over (`ObservedFrame` in `ports.ts`); `Space` is the session's
 * `XRReferenceSpace`, or whatever a spec stands in for it.
 */
export interface RoomFrame<Space> {
  frame: SceneFrame;
  referenceSpace: Space;
  summoning: boolean;
}

export interface RoomPlacementOptions<Space> {
  model: RoomModelLike;
  /** Reads one reference space's room; called again whenever the session's space changes. */
  track(referenceSpace: Space): RoomTrackerLike;
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(handle: number): void;
}

/** A `PlacementPort` (`ports.ts`) over the room model. */
export interface RoomPlacement<Space> {
  observe(observed: RoomFrame<Space>): void;
  place(request: PlacementRequestLike): Promise<PlacementLike>;
  describe(): RoomDescriptionLike | undefined;
  dispose(): void;
}

/** The model's placement, or a rejection once it has taken longer than {@link PLACEMENT_TIMEOUT_MS}. */
function withinTimeout<Space>(answer: Promise<Placement>, options: RoomPlacementOptions<Space>): Promise<Placement> {
  return new Promise((resolve, reject) => {
    const timer = options.setTimeout(
      () => reject(new Error('The room model did not answer in time.')),
      PLACEMENT_TIMEOUT_MS,
    );
    answer.then(
      (placement) => {
        options.clearTimeout(timer);
        resolve(placement);
      },
      (error: unknown) => {
        options.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createRoomPlacement<Space>(options: RoomPlacementOptions<Space>): RoomPlacement<Space> {
  let tracker: { space: Space; reader: RoomTrackerLike } | undefined;
  let lastRead = Number.NEGATIVE_INFINITY;
  /** The epoch of the last placement, handed back with its spot so a spot from before a recentre is ignored. */
  let lastEpoch: number | undefined;
  let description: RoomDescriptionLike | undefined;
  let describing = false;
  let disposed = false;

  function readerFor(space: Space): RoomTrackerLike {
    if (tracker?.space !== space) {
      tracker?.reader.dispose();
      tracker = { space, reader: options.track(space) };
    }
    return tracker.reader;
  }

  return {
    observe({ frame, referenceSpace, summoning }) {
      if (disposed) return;
      const now = options.now();
      if (!summoning && now - lastRead < SNAPSHOT_INTERVAL_MS) return;
      lastRead = now;
      // The model sends a snapshot on only when it is a different object from the last one, and
      // the tracker hands back the same object when nothing changed.
      options.model.update(readerFor(referenceSpace).take(frame));
    },
    async place(request) {
      const placement = await withinTimeout(
        options.model.place({
          head: request.head,
          forward: request.forward,
          depthProbes: request.depthProbes,
          previous: request.previous,
          previousEpoch: request.previous === undefined ? undefined : lastEpoch,
        }),
        options,
      );
      lastEpoch = placement.epoch;
      return placement;
    },
    describe() {
      if (!describing && !disposed) {
        describing = true;
        options.model.describe().then(
          (described) => {
            describing = false;
            description = described;
          },
          () => {
            // Asked again on the HUD's next refresh; a room that cannot be described has no line.
            describing = false;
          },
        );
      }
      return description;
    },
    dispose() {
      disposed = true;
      tracker?.reader.dispose();
      tracker = undefined;
      options.model.dispose();
    },
  };
}
