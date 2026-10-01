import { FRONT_VIEW, type Vector3Tuple, type ViewBasis } from './fragment-3d';

/** A point or a direction in the session's reference space: metres, y up. */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** A pose in the session's reference space. */
export interface PoseLike {
  position: Vector3Like;
  /** Unit quaternion, x y z w. */
  orientation: { x: number; y: number; z: number; w: number };
}

function normalised(vector: Vector3Tuple): Vector3Tuple | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length < 1e-6 ? null : [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dot(first: Vector3Tuple, second: Vector3Tuple) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

/**
 * Which way his front faces: level, from his centre towards the head, fixed when he arrives.
 *
 * The body turns about the vertical from there at the phone's rate, so the side of him the phone
 * shows first is the side the user sees him arrive with. Straight overhead there is no level
 * direction to the head, and he faces the reference space's +z.
 */
export function frontTowards(centre: Vector3Like, head: Vector3Like): Vector3Tuple {
  return normalised([head.x - centre.x, 0, head.z - centre.z]) ?? [0, 0, 1];
}

/** The body's own frame from its front: x right, y the world's up, z the front. */
export function bodyFrame(front: Vector3Tuple): ViewBasis {
  return { right: [front[2], 0, -front[0]], up: [0, 1, 0], front };
}

/**
 * The plane through his centre that faces the centre eye, in the reference space: `front` points
 * at the eye, `up` is the world's up made square to it, `right` completes a right-handed set.
 *
 * Worked out from the centre eye rather than per eye, so both eyes see the same view plane and
 * with it the same fragments lit and the same glyphs. Straight above or below him the world's up
 * has nothing left once squared to the view, and the previous frame's plane is kept.
 */
export function viewBasisTowards(centre: Vector3Like, head: Vector3Like, previous: ViewBasis | null): ViewBasis {
  const front = normalised([head.x - centre.x, head.y - centre.y, head.z - centre.z]);
  if (front === null) return previous ?? FRONT_VIEW;
  const up = normalised([-front[1] * front[0], 1 - front[1] * front[1], -front[1] * front[2]]);
  if (up === null) return previous ?? FRONT_VIEW;
  return { right: cross(up, front), up, front };
}

/** `basis`, expressed in the body's frame: what the fragment arithmetic reads. */
export function inFrame(basis: ViewBasis, frame: ViewBasis): ViewBasis {
  const express = (vector: Vector3Tuple): Vector3Tuple => [
    dot(vector, frame.right),
    dot(vector, frame.up),
    dot(vector, frame.front),
  ];
  return { right: express(basis.right), up: express(basis.up), front: express(basis.front) };
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
