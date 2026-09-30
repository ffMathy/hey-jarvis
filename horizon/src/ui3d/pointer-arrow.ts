import { DoubleSide, Mesh, MeshBasicMaterial, Quaternion, Shape, ShapeGeometry, Vector3 } from 'three';
import { type PoseLike, rotate, type Vector3Like } from '../xr/ray';
import { UI_COLOURS } from './ui-colours';

/**
 * A small arrow at the edge of the view that points to Jarvis, for when he had to be put somewhere
 * the user is not looking.
 *
 * Placement keeps him inside a ±35° cone of the gaze when it can; in a cramped room it may have to
 * widen to ±60°, which on a Quest 3 (about ±55° across) can be just out of sight — and his voice
 * plays from the headset, not from where he stands, so nothing else says where he went. The arrow
 * is head-locked, sits a short way out from the centre of the view in his direction, and goes as
 * soon as he is comfortably in view.
 */

/** Within this angle of the gaze he is in plain view and the arrow is not needed. */
export const IN_VIEW_DEGREES = 25;

/** How far ahead of the eyes the arrow sits, and how far out from the centre of the view. */
const ARROW_DISTANCE_METRES = 0.9;
const ARROW_OFFSET_METRES = 0.16;
const ARROW_SIZE_METRES = 0.035;

export interface PointerBearing {
  /** Whether he is outside the comfortable view, so the arrow should show. */
  offView: boolean;
  /** Which way to point, in the plane of the view: 0 is right, π/2 is up. */
  angle: number;
}

/** The inverse of a unit quaternion is its conjugate. */
function conjugate(rotation: PoseLike['orientation']): PoseLike['orientation'] {
  return { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
}

/** Where `target` is from `eye`: whether it is out of view, and which way round the view it lies. */
export function pointerBearing(eye: PoseLike, target: Vector3Like, inViewDegrees = IN_VIEW_DEGREES): PointerBearing {
  const local = rotate(
    { x: target.x - eye.position.x, y: target.y - eye.position.y, z: target.z - eye.position.z },
    conjugate(eye.orientation),
  );
  const length = Math.hypot(local.x, local.y, local.z);
  if (length < 1e-6) return { offView: false, angle: 0 };
  const fromGaze = Math.acos(Math.max(-1, Math.min(1, -local.z / length)));
  const sideways = Math.hypot(local.x, local.y);
  // Straight behind has no way round that is better than another; right, by convention.
  const angle = sideways < 1e-6 ? 0 : Math.atan2(local.y, local.x);
  return { offView: fromGaze > (inViewDegrees * Math.PI) / 180, angle };
}

export interface PointerArrow {
  readonly object: Mesh;
  /** Points at `target` from `eye` this frame, or hides when it is in view or there is no target. */
  update(eye: PoseLike, target: Vector3Like | undefined): void;
  dispose(): void;
}

export function createPointerArrow(): PointerArrow {
  // A chevron pointing along +X in its own plane, turned each frame to point his way.
  const shape = new Shape();
  shape.moveTo(ARROW_SIZE_METRES, 0);
  shape.lineTo(-ARROW_SIZE_METRES * 0.6, ARROW_SIZE_METRES * 0.7);
  shape.lineTo(-ARROW_SIZE_METRES * 0.2, 0);
  shape.lineTo(-ARROW_SIZE_METRES * 0.6, -ARROW_SIZE_METRES * 0.7);
  shape.closePath();
  const material = new MeshBasicMaterial({
    color: UI_COLOURS.accent,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const mesh = new Mesh(new ShapeGeometry(shape), material);
  mesh.renderOrder = 11;
  mesh.visible = false;
  const eyeRotation = new Quaternion();
  const roll = new Quaternion();
  const forward = new Vector3(0, 0, 1);

  return {
    object: mesh,
    update(eye, target) {
      if (target === undefined) {
        mesh.visible = false;
        return;
      }
      const bearing = pointerBearing(eye, target);
      mesh.visible = bearing.offView;
      if (!bearing.offView) return;
      const offset = rotate(
        {
          x: Math.cos(bearing.angle) * ARROW_OFFSET_METRES,
          y: Math.sin(bearing.angle) * ARROW_OFFSET_METRES,
          z: -ARROW_DISTANCE_METRES,
        },
        eye.orientation,
      );
      mesh.position.set(eye.position.x + offset.x, eye.position.y + offset.y, eye.position.z + offset.z);
      eyeRotation.set(eye.orientation.x, eye.orientation.y, eye.orientation.z, eye.orientation.w);
      mesh.quaternion.copy(eyeRotation).multiply(roll.setFromAxisAngle(forward, bearing.angle));
    },
    dispose() {
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
