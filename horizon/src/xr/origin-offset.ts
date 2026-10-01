import type { PoseLike } from './ray';

/**
 * `?origin=x,z,yawDegrees`: the room's reference space moved along the floor and turned about the
 * vertical from where the headset put it — for the browser tests, and nothing else.
 *
 * On a Quest, `local-floor` starts wherever the headset is when a session begins, so a position
 * written down in it means somewhere else next time; that is why placed entities are kept relative
 * to persistent anchors (`entities/room-anchors.ts`). The emulator's `local-floor` is its global
 * space, the same in every session, so there a position kept in `local-floor` would come back in the
 * right place and prove nothing. Opened with a different origin in each session, the room's space
 * starts somewhere new as it would on a headset, and an entity found in the same spot of the
 * emulated room was really kept by its anchor.
 *
 * The offset is the new origin in the headset's space: `x` and `z` metres along its floor, turned
 * `yawDegrees` anticlockwise seen from above. It is what `XRReferenceSpace.getOffsetReferenceSpace`
 * takes, so a point p in the room's space is at translate(x, 0, z) · rotateY(yaw) · p in the
 * headset's.
 */
export interface OriginOffset {
  x: number;
  z: number;
  yawDegrees: number;
}

/** How far the origin may be moved: further than any room, and short of numbers that lose precision. */
const LARGEST_OFFSET_METRES = 100;

/** The offset `value` (the `origin` URL parameter) asks for, or undefined when it asks for none that reads. */
export function parseOriginOffset(value: string | null): OriginOffset | undefined {
  if (value === null) return undefined;
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => part === '')) return undefined;
  const [x, z, yawDegrees] = parts.map(Number);
  if (x === undefined || z === undefined || yawDegrees === undefined) return undefined;
  if (![x, z, yawDegrees].every(Number.isFinite)) return undefined;
  if (Math.abs(x) > LARGEST_OFFSET_METRES || Math.abs(z) > LARGEST_OFFSET_METRES) return undefined;
  return { x, z, yawDegrees };
}

/** The offset as a pose: the new origin's position and orientation in the headset's space. */
export function originPose(offset: OriginOffset): PoseLike {
  const half = (offset.yawDegrees * Math.PI) / 360;
  return {
    position: { x: offset.x, y: 0, z: offset.z },
    orientation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
  };
}
