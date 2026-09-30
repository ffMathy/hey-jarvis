import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { distanceBetween, type Vector3Like } from '../xr/ray';
import { UI_COLOURS } from './ui-colours';

/**
 * The ring round what sir is pointing at: the answer to "what does he mean by that?" drawn where he
 * can see it before he says it.
 *
 * In the accent, sir's own colour — Jarvis's orange is his corona, lit round what he is working on,
 * and the two must never be taken for each other. It faces the eyes, is never smaller than
 * {@link RETICLE_MIN_DEGREES} across so a lamp across the room is still ringed, and lands with a
 * short shrink onto its target when the target changes, which is what says the point was taken.
 */

/** The ring's radius near to, in metres: a little wider than Jarvis's corona, which it may frame. */
export const RETICLE_RADIUS_METRES = 0.08;

/** The least angle its radius subtends at the eye, so a far target is still plainly ringed. */
export const RETICLE_MIN_DEGREES = 2.2;

/** How long it takes to land on a new target, and how much bigger it starts. */
export const RETICLE_LANDING_SECONDS = 0.2;
const LANDING_SCALE = 1.6;

/** The ring's radius at `distance` from the eye. */
export function reticleRadiusAt(distance: number): number {
  return Math.max(RETICLE_RADIUS_METRES, distance * Math.tan((RETICLE_MIN_DEGREES * Math.PI) / 180));
}

/** How much bigger than its resting size the ring is, `since` seconds after it landed on its target. */
export function landingScale(since: number): number {
  const share = Math.min(1, Math.max(0, since / RETICLE_LANDING_SECONDS));
  return 1 + (LANDING_SCALE - 1) * (1 - share) * (1 - share);
}

export interface PointingReticle {
  readonly object: Mesh;
  /** Rings `position` for `eye`, `since` seconds after it was first pointed at; undefined hides it. */
  show(position: Vector3Like | undefined, eye: Vector3Like, since: number): void;
  dispose(): void;
}

export function createPointingReticle(): PointingReticle {
  const material = new MeshBasicMaterial({
    color: UI_COLOURS.accent,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const ring = new Mesh(new RingGeometry(0.86, 1, 64), material);
  ring.renderOrder = 9;
  ring.visible = false;
  return {
    object: ring,
    show(position, eye, since) {
      ring.visible = position !== undefined;
      if (position === undefined) return;
      ring.position.set(position.x, position.y, position.z);
      ring.lookAt(eye.x, eye.y, eye.z);
      ring.scale.setScalar(reticleRadiusAt(distanceBetween(position, eye)) * landingScale(since));
    },
    dispose() {
      ring.geometry.dispose();
      material.dispose();
    },
  };
}
