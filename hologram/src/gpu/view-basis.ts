import { FRONT_VIEW, type Vector3Tuple, type ViewBasis } from './fragment-3d';

/** A point or a direction, y up: in metres in the headset's reference space, in any unit elsewhere. */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

function normalised(vector: Vector3Tuple): Vector3Tuple | null {
  'worklet';
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length < 1e-6 ? null : [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  'worklet';
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dot(first: Vector3Tuple, second: Vector3Tuple) {
  'worklet';
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
  'worklet';
  return normalised([head.x - centre.x, 0, head.z - centre.z]) ?? [0, 0, 1];
}

/** The body's own frame from its front: x right, y the world's up, z the front. */
export function bodyFrame(front: Vector3Tuple): ViewBasis {
  'worklet';
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
  'worklet';
  const front = normalised([head.x - centre.x, head.y - centre.y, head.z - centre.z]);
  if (front === null) return previous ?? FRONT_VIEW;
  const up = normalised([-front[1] * front[0], 1 - front[1] * front[1], -front[1] * front[2]]);
  if (up === null) return previous ?? FRONT_VIEW;
  return { right: cross(up, front), up, front };
}

/** `basis`, expressed in the body's frame: what the fragment arithmetic reads. */
export function inFrame(basis: ViewBasis, frame: ViewBasis): ViewBasis {
  'worklet';
  const express = (vector: Vector3Tuple): Vector3Tuple => [
    dot(vector, frame.right),
    dot(vector, frame.up),
    dot(vector, frame.front),
  ];
  return { right: express(basis.right), up: express(basis.up), front: express(basis.front) };
}
