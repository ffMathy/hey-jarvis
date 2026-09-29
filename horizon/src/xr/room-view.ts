import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { type JarvisDebugState, toRoomPoint } from '../debug-hook';
import type { Painter } from '../hologram3d/canvaskit';
import { DISTANCE_AHEAD_METRES } from '../hologram3d/dimensions';
import { createFlatHologram } from '../hologram3d/flat-hologram';
import { silentFrame } from '../hologram3d/silent-frame';
import { createViewPlaneQuad, VIEW_PLANE_SIDE_METRES } from '../hologram3d/view-plane-quad';
import { centreEyeOf, pointAhead } from './viewer-pose';

/**
 * How hard the headset may blur the edges of the view to save fill: 0 is none, 1 is three's
 * default and the most. He is mostly glow, and glow smeared at the periphery reads as a lens
 * flaw, so this stays low until a headset says the frame rate needs more.
 */
const FOVEATION = 0.3;

/**
 * Jarvis in the room for as long as the session lasts: placed ahead of the head when it starts,
 * turned to face the viewer every frame, and drawn by the phone's own code.
 *
 * Resolves once the session has ended and everything it made is released.
 */
export async function showJarvisInRoom(session: XRSession, painter: Painter, debug: JarvisDebugState): Promise<void> {
  // Transparent, so the passthrough shows through everywhere he is not; premultiplied, which is
  // how the compositor reads the layer anyway; no multisampling, because the quad's edges are
  // black and the hologram's own strokes are antialiased by Skia.
  const renderer = new WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const flat = createFlatHologram(painter);
  debug.surface = flat.kind;
  const quad = createViewPlaneQuad(VIEW_PLANE_SIDE_METRES);
  const scene = new Scene();
  scene.add(quad.mesh);
  // Never used for the room itself: three renders each eye with the XR system's own cameras.
  const camera = new PerspectiveCamera();

  const ended = new Promise<void>((resolve) => session.addEventListener('end', () => resolve(), { once: true }));
  await renderer.xr.setSession(session);
  renderer.xr.setFoveation(FOVEATION);
  debug.phase = 'in-room';

  let startTime: number | null = null;
  let placed = false;
  renderer.setAnimationLoop((time, frame) => {
    const space = renderer.xr.getReferenceSpace();
    if (frame === undefined || space === null) return;
    const eye = centreEyeOf(frame, space);
    if (eye === null) return;

    if (!placed) {
      quad.mesh.position.copy(pointAhead(eye, DISTANCE_AHEAD_METRES));
      debug.hologramPosition = toRoomPoint(quad.mesh.position);
      debug.headPositionAtPlacement = toRoomPoint(eye.position);
      placed = true;
    }
    startTime ??= time;

    quad.faceViewer(eye.position);
    quad.showPicture(flat.draw(silentFrame((time - startTime) / 1000)));
    renderer.render(scene, camera);
    debug.frames += 1;
  });

  await ended;
  renderer.setAnimationLoop(null);
  quad.dispose();
  flat.dispose();
  renderer.dispose();
}
