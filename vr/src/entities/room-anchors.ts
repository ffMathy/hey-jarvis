import { toLocal, toReference } from '../room/pose-matrix';
import type { AnchorLike } from '../xr/anchor-keeper';
import { distanceBetween, type Vector3Like } from '../xr/ray';
import type { AnchorOffset, EntityPlacement, EntityRegistry } from './registry';

/**
 * Keeping placed entities where sir put them, from one session to the next.
 *
 * `local-floor` starts wherever the headset is when a session begins, and moves again on every
 * recentre, so a position stored in it is somewhere else next time. A persistent anchor is a point
 * the headset recognises in the real room across sessions, by a handle (a UUID) the page keeps. So
 * each entity is stored as an offset in the space of the nearest of a few such anchors, and found
 * each frame by reading that anchor's pose — which survives recentring for free.
 *
 * - **Few anchors.** Quest allows an origin eight persistent anchors, and this origin
 *   (`ffmathy.github.io`) is shared with every other Pages project of the owner's, so this app keeps
 *   to {@link MAX_ROOM_ANCHORS}. A drop within {@link ANCHOR_REUSE_METRES} of an anchor located in
 *   this frame uses it; farther away, a new one is created while the budget lasts, and past it the
 *   nearest located one is used however far — worse, since a degree of rotation error is 7 cm at
 *   4 m, but kept rather than refused.
 * - **Created in the frame of the drop.** `XRFrame.createAnchor` only works on an active frame, and
 *   the handle comes later, so a drop onto a new anchor completes in a later {@link RoomAnchors.update}.
 *   Until then the entity stands where it was dropped. A recentre meanwhile moves the space under
 *   that point: the entity is no longer drawn there, and is kept only on its own new anchor — at no
 *   offset, since the anchor is the spot — never on another one by a point that has moved.
 * - **Restored once per session.** Every handle a placement uses that the session lists in
 *   `persistentAnchors` is restored; one it does not list is gone for good (the site's data was
 *   cleared, or the headset forgot the room), and the caller forgets it, which leaves its
 *   entities as lost placements. Until an anchor is located, its entities are not shown and cannot be
 *   pointed at: they may simply be in another room.
 * - **Given back while the session is live, and forgotten only once it has been.** A handle no
 *   placement uses is deleted from the headset — which may refuse once the session has ended — and
 *   {@link RoomAnchors.release} says which ones it let go of. The caller forgets only those, so a
 *   refused one stays in the registry and is given back again at the start of the next session,
 *   rather than using one of the origin's eight for good with nothing left that knows its handle.
 *
 * Generic over the space and transform types, like `xr/anchor-keeper.ts`, so the tests can hand it
 * plain objects; in the app they are `XRSpace` and `XRRigidTransform`, and an `XRSession` and an
 * `XRFrame` fit {@link PersistentAnchorSession} and {@link RoomAnchorFrame} as they are.
 */

/** The most persistent anchors this app keeps, out of the eight Quest allows an origin. */
export const MAX_ROOM_ANCHORS = 4;

/** How near an anchor has to be for a drop to use it rather than ask for a new one. */
export const ANCHOR_REUSE_METRES = 2.5;

/** How long a restored anchor can go unlocated before its entities count as not found here. */
export const NOT_FOUND_AFTER_SECONDS = 10;

/** An anchor that may be made persistent: what an `XRAnchor` is. */
export interface PersistentAnchorLike<Space> extends AnchorLike<Space> {
  requestPersistentHandle?: () => Promise<string>;
}

/** What this needs of an `XRSession`. */
export interface PersistentAnchorSession<Space> {
  readonly persistentAnchors?: Iterable<string>;
  restorePersistentAnchor?: (uuid: string) => Promise<PersistentAnchorLike<Space>>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
}

/** What this needs of an `XRFrame`. */
export interface RoomAnchorFrame<Space, Transform> {
  createAnchor?: (pose: Transform, space: Space) => Promise<PersistentAnchorLike<Space>>;
  getPose(space: Space, baseSpace: Space): { transform: { matrix: Float32Array } } | undefined | null;
}

/** A placement a drop ended in: on `anchor`, at `offset` in its space. The caller writes it to the registry. */
export interface AnchoredPlacement {
  id: string;
  anchor: string;
  offset: AnchorOffset;
}

/** What became of a drop. */
export type DropResult =
  /** Placed on an anchor located in this frame. */
  | ({ kind: 'placed' } & AnchoredPlacement)
  /** A new anchor is being made; the placement comes out of a later `update`. */
  | { kind: 'pending'; id: string }
  /** It cannot be kept: no anchor could be made or found in this room. */
  | { kind: 'failed'; id: string; reason: string };

/** What a later frame settled about a drop that was waiting on a new anchor. */
export type SettledDrop = Exclude<DropResult, { kind: 'pending' }>;

/** How far each stored anchor has got in this session. */
export type RoomAnchorState =
  /** Asked for; the headset has not answered yet. */
  | 'restoring'
  /** Answered, and located in the last frame. */
  | 'located'
  /** Answered, but not located in the last frame: another room, or still relocalising. */
  | 'unlocated'
  /** The headset no longer has it. */
  | 'missing'
  /** The headset would not restore it. */
  | 'failed'
  /** This session has no persistent anchors at all. */
  | 'unsupported';

export interface RoomAnchorStatus {
  anchors: Record<string, RoomAnchorState>;
  /** Anchors restored or on their way for longer than NOT_FOUND_AFTER_SECONDS without ever being located. */
  notFound: string[];
  /** Drops still waiting on a new anchor. */
  pending: number;
}

export interface RoomAnchors<Space, Transform> {
  /**
   * Restores every anchor in `uuids` — the ones placements use — that the headset still lists.
   * Returns the handles it no longer lists, for the caller to forget, which leaves their entities
   * lost. Call once, at the start of the session.
   */
  restore(uuids: readonly string[], now: number): string[];
  /**
   * Each frame, before anything asks where an entity is: re-reads every anchor's pose, and settles
   * the drops whose new anchors have been made — or have failed — since. `epoch` is how many times
   * `space` has been reset (the stage's count): a recentre moves every pose in it, so a point kept
   * from an earlier epoch no longer names the spot it did.
   */
  update(frame: RoomAnchorFrame<Space, Transform>, space: Space, now: number, epoch: number): SettledDrop[];
  /**
   * Keeps entity `id` at `point` (in `space`, this frame): on the nearest anchor, or a new one.
   * Call from the frame callback of the frame the drop happened in, after `update`, whose epoch
   * the point is in.
   */
  drop(
    frame: RoomAnchorFrame<Space, Transform>,
    space: Space,
    id: string,
    point: Vector3Like,
    registry: EntityRegistry,
    now: number,
  ): DropResult;
  /**
   * Takes back entity `id`'s drop still waiting on its new anchor — it went back into the drawer —
   * and gives that anchor back: at once when its handle has come, or as soon as it does. Nothing
   * else would ever give it back, since no placement will name it.
   */
  cancel(id: string): void;
  /** Where a placement is in the last frame updated, or undefined while its anchor is not located. */
  positionOf(placement: EntityPlacement): Vector3Like | undefined;
  /**
   * Where each drop still waiting on a new anchor was dropped, so it can be drawn there meanwhile —
   * leaving out one dropped before a recentre, whose point is somewhere else now.
   */
  pendingDrops(): { id: string; position: Vector3Like }[];
  /**
   * Gives back the persistent handles in `anchors` — ones no placement uses any more — asking the
   * headset at once, so call it while the session is live. Resolves with the handles the headset
   * let go of, or no longer had: the ones the caller may forget.
   */
  release(anchors: readonly string[]): Promise<string[]>;
  status(now: number): RoomAnchorStatus;
}

interface StoredAnchor<Space> {
  state: RoomAnchorState;
  anchor?: PersistentAnchorLike<Space>;
  /** The anchor's pose in the last frame it was located in; kept in place, never reallocated. */
  pose: Float32Array;
  /** When it was asked for, for NOT_FOUND_AFTER_SECONDS. */
  askedAt: number;
  everLocated: boolean;
}

interface PendingDrop {
  id: string;
  /** Where it was dropped, in the space as it was in `epoch`. */
  point: Vector3Like;
  /** The space's reset count when it was dropped. */
  epoch: number;
  droppedAt: number;
  /** The new anchor's handle once the headset has given one. */
  anchor?: string;
  /** Why the new anchor could not be made, once it could not. */
  failure?: string;
}

function offsetOf(pose: Float32Array, point: Vector3Like): AnchorOffset {
  const local = toLocal(pose, point);
  return [local.x, local.y, local.z];
}

function includes(list: Iterable<string>, wanted: string): boolean {
  for (const item of list) if (item === wanted) return true;
  return false;
}

export function createRoomAnchors<Space, Transform>(
  session: PersistentAnchorSession<Space>,
  makeTransform: (position: Vector3Like) => Transform,
): RoomAnchors<Space, Transform> {
  const stored = new Map<string, StoredAnchor<Space>>();
  const pending: PendingDrop[] = [];
  /** The space's reset count in the last frame updated. */
  let currentEpoch = 0;

  function located(uuid: string): Float32Array | undefined {
    const entry = stored.get(uuid);
    return entry?.state === 'located' ? entry.pose : undefined;
  }

  /** The located anchor nearest `point`, and how far it is. */
  function nearestLocated(point: Vector3Like): { uuid: string; distance: number } | undefined {
    let nearest: { uuid: string; distance: number } | undefined;
    for (const [uuid, entry] of stored) {
      if (entry.state !== 'located') continue;
      const distance = distanceBetween(toReference(entry.pose, 0, 0, 0), point);
      if (nearest === undefined || distance < nearest.distance) nearest = { uuid, distance };
    }
    return nearest;
  }

  function placeOn(uuid: string, pose: Float32Array, id: string, point: Vector3Like): SettledDrop {
    return { kind: 'placed', id, anchor: uuid, offset: offsetOf(pose, point) };
  }

  /** The fallback: the nearest located anchor however far, or `reason` when there is none. */
  function placeOnNearest(id: string, point: Vector3Like, reason: string): SettledDrop {
    const nearest = nearestLocated(point);
    const pose = nearest === undefined ? undefined : located(nearest.uuid);
    if (nearest === undefined || pose === undefined) return { kind: 'failed', id, reason };
    return placeOn(nearest.uuid, pose, id, point);
  }

  /** How many persistent anchors are taken: the registry's, this session's, and those being made. */
  function anchorsTaken(registry: EntityRegistry): number {
    const taken = new Set(Object.keys(registry.anchors));
    for (const [uuid, entry] of stored) {
      if (entry.state === 'missing') taken.delete(uuid);
      else taken.add(uuid);
    }
    const creating = pending.filter((drop) => drop.anchor === undefined && drop.failure === undefined).length;
    return taken.size + creating;
  }

  function track(uuid: string, anchor: PersistentAnchorLike<Space>, now: number) {
    stored.set(uuid, { state: 'unlocated', anchor, pose: new Float32Array(16), askedAt: now, everLocated: false });
  }

  /** Makes a new persistent anchor at `point` for `drop`, which settles once it is made or refused. */
  function createFor(drop: PendingDrop, frame: RoomAnchorFrame<Space, Transform>, space: Space, now: number) {
    const create = frame.createAnchor;
    if (create === undefined) {
      drop.failure = 'This headset cannot anchor anything in the room.';
      return;
    }
    const fail = (why: string) => {
      drop.failure = why;
    };
    let request: Promise<PersistentAnchorLike<Space>>;
    try {
      request = create.call(frame, makeTransform(drop.point), space);
    } catch {
      fail('The headset would not anchor that spot.');
      return;
    }
    request.then(
      (anchor) => {
        const persist = anchor.requestPersistentHandle;
        if (persist === undefined) {
          anchor.delete();
          fail('This headset cannot keep anchors from one session to the next.');
          return;
        }
        persist.call(anchor).then(
          (uuid) => {
            track(uuid, anchor, now);
            // A drop that has been replaced or taken back meanwhile no longer wants the anchor, so
            // its handle is given back at once rather than left using one of the few the origin has.
            if (pending.includes(drop)) drop.anchor = uuid;
            else void release([uuid]);
          },
          () => {
            anchor.delete();
            fail('The headset would not keep another anchor.');
          },
        );
      },
      () => fail('The headset would not anchor that spot.'),
    );
  }

  /**
   * Takes entity `id`'s waiting drop out of the list, and gives back its new anchor if the handle
   * has come; a handle still on its way is given back when it arrives (`createFor`). That anchor is
   * never located here — once located, it would have settled the drop in this frame's `update` —
   * so no later drop could have been put on it instead.
   */
  function takeBack(id: string) {
    const index = pending.findIndex((drop) => drop.id === id);
    if (index < 0) return;
    const [drop] = pending.splice(index, 1);
    if (drop?.anchor !== undefined) void release([drop.anchor]);
  }

  /** Whether the headset still lists `uuid`; undefined when it cannot say. */
  function listed(uuid: string): boolean | undefined {
    try {
      const handles = session.persistentAnchors;
      return handles === undefined ? undefined : includes(handles, uuid);
    } catch {
      return undefined;
    }
  }

  /** Deletes `uuid` from the headset: resolves with whether it is gone now. */
  function deleteHandle(uuid: string): Promise<boolean> {
    const remove = session.deletePersistentAnchor;
    if (remove === undefined) return Promise.resolve(false);
    // A refusal for a handle the headset no longer lists is a handle already gone, which is what
    // was wanted; one it still lists was refused for real, and is kept to be given back later.
    const refused = () => listed(uuid) === false;
    try {
      return remove.call(session, uuid).then(() => true, refused);
    } catch {
      return Promise.resolve(refused());
    }
  }

  function release(anchors: readonly string[]): Promise<string[]> {
    const deletions = anchors.map((uuid) => {
      const entry = stored.get(uuid);
      stored.delete(uuid);
      entry?.anchor?.delete();
      return deleteHandle(uuid).then((gone) => (gone ? [uuid] : []));
    });
    return Promise.all(deletions).then((released) => released.flat());
  }

  function readPoses(frame: RoomAnchorFrame<Space, Transform>, space: Space) {
    for (const entry of stored.values()) {
      if (entry.anchor === undefined || (entry.state !== 'located' && entry.state !== 'unlocated')) continue;
      const pose = frame.getPose(entry.anchor.anchorSpace, space);
      if (pose) {
        entry.pose.set(pose.transform.matrix);
        entry.state = 'located';
        entry.everLocated = true;
      } else {
        entry.state = 'unlocated';
      }
    }
  }

  /**
   * What `drop` settled as, or undefined while it still waits: on its new anchor once that is
   * located; on the nearest one when the new one was refused, or has not been located in
   * NOT_FOUND_AFTER_SECONDS, which a spot just anchored always should be.
   *
   * On its own anchor it is at no offset at all: the anchor was made at the drop's point, level, in
   * the drop's own frame, so it is that point whatever the space has done since. Working the offset
   * out from the point instead would mix the anchor's pose after a recentre with a point from before
   * it, and store the recentre itself as where the entity stands.
   */
  function settled(drop: PendingDrop, now: number): SettledDrop | undefined {
    if (drop.failure !== undefined) return fallBack(drop, drop.failure);
    if (drop.anchor !== undefined && located(drop.anchor) !== undefined) {
      return { kind: 'placed', id: drop.id, anchor: drop.anchor, offset: [0, 0, 0] };
    }
    if (now - drop.droppedAt < NOT_FOUND_AFTER_SECONDS) return undefined;
    // The new anchor is not used after all, so its handle is given back rather than kept for nothing.
    if (drop.anchor !== undefined) void release([drop.anchor]);
    return fallBack(drop, 'The headset did not find the new anchor.');
  }

  /**
   * `drop` on the nearest located anchor, by its point — unless the space has been reset since it
   * was dropped, when the point names a spot the recentre has moved and it is refused instead.
   */
  function fallBack(drop: PendingDrop, reason: string): SettledDrop {
    if (drop.epoch !== currentEpoch) {
      return { kind: 'failed', id: drop.id, reason: 'The room was recentred before it could be kept.' };
    }
    return placeOnNearest(drop.id, drop.point, reason);
  }

  function settle(now: number): SettledDrop[] {
    const results: SettledDrop[] = [];
    for (const drop of [...pending]) {
      const result = settled(drop, now);
      if (result === undefined) continue;
      results.push(result);
      pending.splice(pending.indexOf(drop), 1);
    }
    return results;
  }

  return {
    restore(uuids, now) {
      const handles = session.persistentAnchors;
      const restorer = session.restorePersistentAnchor;
      const missing: string[] = [];
      for (const uuid of uuids) {
        if (stored.has(uuid)) continue;
        const entry: StoredAnchor<Space> = {
          state: 'unsupported',
          pose: new Float32Array(16),
          askedAt: now,
          everLocated: false,
        };
        stored.set(uuid, entry);
        if (handles === undefined || restorer === undefined) continue;
        if (!includes(handles, uuid)) {
          entry.state = 'missing';
          missing.push(uuid);
          continue;
        }
        entry.state = 'restoring';
        let request: Promise<PersistentAnchorLike<Space>>;
        try {
          request = restorer.call(session, uuid);
        } catch {
          entry.state = 'failed';
          continue;
        }
        request.then(
          (anchor) => {
            // Released while it was on its way: the handle is already given back.
            if (stored.get(uuid) !== entry) {
              anchor.delete();
              return;
            }
            entry.anchor = anchor;
            entry.state = 'unlocated';
          },
          () => {
            entry.state = 'failed';
          },
        );
      }
      return missing;
    },
    update(frame, space, now, epoch) {
      currentEpoch = epoch;
      readPoses(frame, space);
      return settle(now);
    },
    drop(frame, space, id, point, registry, now) {
      const where = { x: point.x, y: point.y, z: point.z };
      // A later drop of the same entity replaces one still waiting on its anchor.
      takeBack(id);
      const nearest = nearestLocated(where);
      const nearestPose = nearest === undefined ? undefined : located(nearest.uuid);
      if (nearest !== undefined && nearestPose !== undefined && nearest.distance <= ANCHOR_REUSE_METRES) {
        return placeOn(nearest.uuid, nearestPose, id, where);
      }
      if (anchorsTaken(registry) >= MAX_ROOM_ANCHORS) {
        return placeOnNearest(id, where, 'Every anchor this app may keep is in use, and none of them is in this room.');
      }
      const drop: PendingDrop = { id, point: where, epoch: currentEpoch, droppedAt: now };
      pending.push(drop);
      createFor(drop, frame, space, now);
      return { kind: 'pending', id };
    },
    cancel: takeBack,
    positionOf(placement) {
      const pose = located(placement.anchor);
      if (pose === undefined) return undefined;
      const [x, y, z] = placement.offset;
      return toReference(pose, x, y, z);
    },
    pendingDrops() {
      return pending
        .filter((drop) => drop.epoch === currentEpoch)
        .map((drop) => ({ id: drop.id, position: { ...drop.point } }));
    },
    release,
    status(now) {
      const notFound: string[] = [];
      for (const [uuid, entry] of stored) {
        const waiting = entry.state === 'restoring' || entry.state === 'unlocated';
        if (waiting && !entry.everLocated && now - entry.askedAt >= NOT_FOUND_AFTER_SECONDS) notFound.push(uuid);
      }
      // Defined from entries rather than assigned, since a stored handle is any string the page kept.
      const anchors = Object.fromEntries([...stored].map(([uuid, entry]) => [uuid, entry.state]));
      return { anchors, notFound, pending: pending.length };
    },
  };
}
