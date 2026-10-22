/**
 * The head, as the room hands it to the hologram: its pose, and how near it may come to him.
 *
 * Headset-only, which is why it stayed here when the view-basis maths moved to `hologram/gpu`.
 */
import type { Vector3Like } from 'hologram/gpu';

/** A pose in the session's reference space. */
export interface PoseLike {
  position: Vector3Like;
  /** Unit quaternion, x y z w. */
  orientation: { x: number; y: number; z: number; w: number };
}

/**
 * How much of him to show when the head is `distance` metres from his centre and he is `radius`
 * across at rest: all of him from 2.5 radii out, nothing inside 1.5.
 *
 * Someone who walks into him should not find their view filled with his inside: it is where the
 * GPU's cost goes up with the square of how close they are, where the near plane starts cutting
 * strokes in half, and where chips thrown at 1.6–1.9R would fly through their face. So he fades
 * out as they come within reach and back as they step away.
 */
export function closeRangeFade(distance: number, radius: number): number {
  const share = distance / radius - 1.5;
  const clamped = share < 0 ? 0 : share > 1 ? 1 : share;
  return clamped * clamped * (3 - 2 * clamped);
}
