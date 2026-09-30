import { type Object3D, Vector3 } from 'three';
import type { Vector3Like } from '../xr/ray';

/**
 * Where the room's panels go.
 *
 * Two kinds of place. What is about Jarvis — the error, his caption, the mood's name, the keyboard
 * button — is **world-locked** at his spot, under him, and turned to face the viewer: it belongs to
 * him, and staying where he is makes it readable from wherever the user moves. What is about the
 * room — the hint, the status line — has no spot to be at, so it **tags along**: it drifts after
 * the gaze with a lag, a little ahead and below eye level, which reads as calmer than text glued
 * to the view and is still never lost behind the user.
 */

/** How quickly a tag-along panel catches up with the gaze: the time constant of its easing, in seconds. */
export const TAG_ALONG_SECONDS = 0.45;

/** Moves `object` to `offsetUp` metres above `spot` and turns it to face `eye`, staying upright. */
export function placeUnder(object: Object3D, spot: Vector3Like, offsetUp: number, eye: Vector3Like) {
  object.position.set(spot.x, spot.y + offsetUp, spot.z);
  // Faced at a point level with itself, so the panel turns to the viewer without leaning back.
  object.lookAt(eye.x, spot.y + offsetUp, eye.z);
}

/** The share of the remaining way an eased value covers in `deltaSeconds`. */
export function easingShare(deltaSeconds: number, timeConstant: number = TAG_ALONG_SECONDS): number {
  if (deltaSeconds <= 0) return 0;
  return 1 - Math.exp(-deltaSeconds / timeConstant);
}

export interface TagAlong {
  /** Moves `object` part of the way towards `target` and faces it at `eye`. The first call jumps straight there. */
  follow(object: Object3D, target: Vector3Like, eye: Vector3Like, deltaSeconds: number): void;
  /** Makes the next call jump again, as after the panel was hidden. */
  reset(): void;
}

export function createTagAlong(): TagAlong {
  const at = new Vector3();
  let placed = false;
  return {
    follow(object, target, eye, deltaSeconds) {
      if (!placed) {
        at.set(target.x, target.y, target.z);
        placed = true;
      } else {
        at.lerp(new Vector3(target.x, target.y, target.z), easingShare(deltaSeconds));
      }
      object.position.copy(at);
      object.lookAt(eye.x, eye.y, eye.z);
    },
    reset() {
      placed = false;
    },
  };
}
