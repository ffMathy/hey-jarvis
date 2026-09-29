import { LEAVING_SECONDS } from 'hologram';
import { Group, Quaternion, Vector3 } from 'three';
import type { HologramSurfaceKind } from '../debug-hook';
import type { Painter } from '../hologram3d/canvaskit';
import { DISTANCE_AHEAD_METRES, HOLOGRAM_RADIUS_METRES } from '../hologram3d/dimensions';
import { createFlatHologram } from '../hologram3d/flat-hologram';
import { silentFrame } from '../hologram3d/silent-frame';
import { createViewPlaneQuad, VIEW_PLANE_SIDE_METRES } from '../hologram3d/view-plane-quad';
import { pointAhead } from '../xr/viewer-pose';
import type { HologramPort, PlacementLike, PlacementPort } from './ports';

/**
 * Stand-ins for the parts of the room other modules will fill, so the room runs end to end before
 * they exist: Milestone 0's flat hologram as a `HologramPort`, and "1.6 m straight ahead" as a
 * `PlacementPort`.
 *
 * They are replaced, not extended — by `createJarvisHologram3D` from `src/hologram3d/` and the room
 * model from `src/room/` — and `main.ts` is the one place that chooses them.
 */

/** Milestone 0's hologram with the surface CanvasKit drew it on, for the browser tests. */
export interface FlatHologramStandIn extends HologramPort {
  readonly surface: HologramSurfaceKind;
}

/**
 * The phone's whole drawing on a view-facing square, idling: Milestone 0's hologram, behind the
 * port the volumetric one will fill.
 *
 * It follows no voice — that is the frame clock's job, which comes with the real hologram — but it
 * arrives and leaves: presence falls over `LEAVING_SECONDS` while leaving, which the drawing shows
 * as him shrinking and fading, and which tells the room when he has gone.
 */
export function createFlatHologramStandIn(painter: Painter): FlatHologramStandIn {
  const flat = createFlatHologram(painter);
  const quad = createViewPlaneQuad(VIEW_PLANE_SIDE_METRES);
  const object = new Group();
  object.add(quad.mesh);
  const eye = new Vector3();
  let time = 0;
  let presence = 1;
  let radius = HOLOGRAM_RADIUS_METRES;

  return {
    object,
    surface: flat.kind,
    arrive() {
      time = 0;
      presence = 1;
    },
    update(deltaSeconds, drive, centreEye) {
      time += deltaSeconds;
      presence = drive.leaving ? Math.max(0, presence - deltaSeconds / LEAVING_SECONDS) : 1;
      object.scale.setScalar(radius / HOLOGRAM_RADIUS_METRES);
      quad.faceViewer(eye.set(centreEye.position.x, centreEye.position.y, centreEye.position.z));
      quad.showPicture(flat.draw({ ...silentFrame(time), presence }));
    },
    get presence() {
      return presence;
    },
    get radius() {
      return radius;
    },
    set radius(value: number) {
      radius = value;
    },
    dispose() {
      quad.dispose();
      flat.dispose();
    },
  };
}

/**
 * Milestone 0's placement: 1.6 m ahead along the floor, at eye height, at full size — wherever that
 * is. Along the ray of the select that summoned him when there was one, else along the gaze.
 */
export function createAheadPlacement(): PlacementPort {
  return {
    place(request): PlacementLike {
      const along = Math.hypot(request.forward.x, request.forward.z);
      const position =
        along > 1e-3
          ? {
              x: request.head.x + (request.forward.x / along) * DISTANCE_AHEAD_METRES,
              y: request.head.y,
              z: request.head.z + (request.forward.z / along) * DISTANCE_AHEAD_METRES,
            }
          : // Straight up or down has no direction along the floor; the top of the head says which way is ahead.
            pointAhead(
              {
                position: new Vector3(request.head.x, request.head.y, request.head.z),
                orientation: new Quaternion(
                  request.headOrientation.x,
                  request.headOrientation.y,
                  request.headOrientation.z,
                  request.headOrientation.w,
                ),
              },
              DISTANCE_AHEAD_METRES,
            );
      return {
        position,
        radius: HOLOGRAM_RADIUS_METRES,
        level: 'fallback',
        clearance: Number.POSITIVE_INFINITY,
        needsPointer: false,
      };
    },
  };
}
