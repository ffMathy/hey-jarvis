/**
 * Rays: where a controller or a pinching hand is pointing, and what it is pointing at.
 *
 * Plain `{x, y, z}` objects rather than three's vectors, so the app's state machine can carry a
 * ray in an event and its tests can build one by hand, and so nothing that only needs a direction
 * has to import the renderer.
 */

/** A point or direction in the session's `local-floor` space, in metres. */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** A unit quaternion, x y z w. */
export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A position and an orientation: what WebXR calls a rigid transform. */
export interface PoseLike {
  position: Vector3Like;
  orientation: QuaternionLike;
}

/** Where a ray starts, and which way it goes (unit length). */
export interface Ray {
  origin: Vector3Like;
  direction: Vector3Like;
}

/**
 * `vector` turned by the unit quaternion `rotation`.
 *
 * The usual expansion of q·v·q⁻¹ that needs no quaternion product: t = 2(q × v), then
 * v + w·t + q × t.
 */
export function rotate(vector: Vector3Like, rotation: QuaternionLike): Vector3Like {
  const { x, y, z, w } = rotation;
  const twiceCrossX = 2 * (y * vector.z - z * vector.y);
  const twiceCrossY = 2 * (z * vector.x - x * vector.z);
  const twiceCrossZ = 2 * (x * vector.y - y * vector.x);
  return {
    x: vector.x + w * twiceCrossX + (y * twiceCrossZ - z * twiceCrossY),
    y: vector.y + w * twiceCrossY + (z * twiceCrossX - x * twiceCrossZ),
    z: vector.z + w * twiceCrossZ + (x * twiceCrossY - y * twiceCrossX),
  };
}

/**
 * The ray a pose points along.
 *
 * WebXR's target-ray spaces, like the viewer, point down their own −Z: that is the direction a
 * controller's laser leaves it in, and the direction a hand's emulated ray goes from the pinch.
 */
export function rayFromPose(pose: PoseLike): Ray {
  return {
    origin: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    direction: rotate({ x: 0, y: 0, z: -1 }, pose.orientation),
  };
}

/**
 * How far along `ray` it first touches the sphere, or undefined when it misses — or when the
 * sphere is entirely behind where the ray starts.
 *
 * A ray starting inside the sphere touches it at once, at distance 0: someone standing inside
 * Jarvis and pulling the trigger is pointing at him by any reasonable reading.
 */
export function raySphereDistance(ray: Ray, centre: Vector3Like, radius: number): number | undefined {
  const offsetX = centre.x - ray.origin.x;
  const offsetY = centre.y - ray.origin.y;
  const offsetZ = centre.z - ray.origin.z;
  const offsetSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
  if (offsetSquared <= radius * radius) return 0;
  const along = offsetX * ray.direction.x + offsetY * ray.direction.y + offsetZ * ray.direction.z;
  if (along < 0) return undefined;
  const missSquared = offsetSquared - along * along;
  if (missSquared > radius * radius) return undefined;
  return along - Math.sqrt(radius * radius - missSquared);
}

/** Straight-line distance between two points. */
export function distanceBetween(from: Vector3Like, to: Vector3Like): number {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}
