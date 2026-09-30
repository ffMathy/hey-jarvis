import type { Vector3Like } from './ray';

/**
 * Keeping Jarvis where he was put while the headset's idea of the room shifts.
 *
 * Tracking drifts and relocalises, and a point in `local-floor` space is only where it was for as
 * long as the headset agrees; an anchor is a point the headset promises to keep attached to the
 * real room. So each spot he is placed at gets one: created in the same frame as the placement
 * (`XRFrame.createAnchor` only works on an active frame), followed through its `anchorSpace` once
 * it resolves, and deleted as soon as he has a new spot. His spot gets no persistent handle: Quest
 * allows a site only eight, and a spot chosen for one conversation is not worth keeping past it.
 * The things sir places in the room are another matter — they are meant to be found again next
 * session — and are kept on a few persistent anchors of their own (`entities/room-anchors.ts`).
 *
 * Until the anchor resolves, and for good on a headset without anchors, the spot as placed is
 * where he stands — so nothing ever waits on this.
 *
 * Generic over the space and transform types, so the tests can hand it plain objects; in the app
 * they are `XRSpace` and `XRRigidTransform`, and an `XRFrame` is an {@link AnchorFrame}.
 */

export interface AnchorLike<Space> {
  readonly anchorSpace: Space;
  delete(): void;
}

/** The two things this needs of an `XRFrame`. */
export interface AnchorFrame<Space, Transform> {
  createAnchor?: (pose: Transform, space: Space) => Promise<AnchorLike<Space>>;
  getPose(space: Space, baseSpace: Space): { transform: { position: Vector3Like } } | undefined | null;
}

export interface AnchorKeeper<Space, Transform> {
  /** Puts him at `position` from now on, and asks for an anchor there. Call from a frame callback. */
  place(frame: AnchorFrame<Space, Transform>, space: Space, position: Vector3Like): void;
  /** Where he stands in this frame: the anchor's pose once it is tracked, the placed spot until then. */
  where(frame: AnchorFrame<Space, Transform>, space: Space): Vector3Like | undefined;
  /** Forgets the spot and deletes its anchor. */
  clear(): void;
}

export function createAnchorKeeper<Space, Transform>(
  makeTransform: (position: Vector3Like) => Transform,
): AnchorKeeper<Space, Transform> {
  let spot: Vector3Like | undefined;
  let anchor: AnchorLike<Space> | undefined;
  // Which placement an anchor on its way belongs to: one that resolves after a newer placement, or
  // after `clear`, is for a spot he no longer stands at and is deleted the moment it arrives.
  let placement = 0;

  function dropAnchor() {
    anchor?.delete();
    anchor = undefined;
  }

  return {
    place(frame, space, position) {
      placement += 1;
      const mine = placement;
      spot = { x: position.x, y: position.y, z: position.z };
      dropAnchor();
      const create = frame.createAnchor;
      if (create === undefined) return;
      let request: Promise<AnchorLike<Space>>;
      try {
        request = create.call(frame, makeTransform(spot), space);
      } catch {
        return;
      }
      request.then(
        (created) => {
          if (mine === placement) anchor = created;
          else created.delete();
        },
        // An anchor refused is a spot that is merely not anchored; he stands there all the same.
        () => undefined,
      );
    },
    where(frame, space) {
      if (anchor !== undefined) {
        const pose = frame.getPose(anchor.anchorSpace, space);
        // A frame the anchor is not tracked in keeps him where it last was, rather than jumping.
        if (pose) spot = { x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z };
      }
      return spot;
    },
    clear() {
      placement += 1;
      spot = undefined;
      dropAnchor();
    },
  };
}
