import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createJarvisHologram3D, DISTANCE_AHEAD_METRES, type JarvisHologram3D, type Painter } from '../hologram3d';
import { type CentreEye, centreEyeOf, pointAhead } from '../xr/viewer-pose';
import { createPhaseDrives } from './phase-drives';
import {
  PREVIEW_PHASES,
  type PreviewMode,
  type PreviewPhase,
  type RoomPoint,
  type RoomStatus,
  type RoomTimings,
} from './preview-hook';

/** How many frames' timings are kept for the readout and the browser tests. */
const TIMINGS_KEPT = 240;

/** As the room's renderer blurs the edges of the view: see `src/xr/room-view.ts`. */
const FOVEATION = 0.3;

export interface PreviewRoom {
  /** A copy of where the room is now. */
  status(): RoomStatus;
  /** What he does from now on; see `HologramPreviewHook.setRoomPhase` for `holdAtSeconds`. */
  setPhase(phase: PreviewPhase, holdAtSeconds?: number): void;
  setMode(mode: PreviewMode): void;
  setAlphaFactor(share: number): void;
  /** Stands him in the room of `session`, 1.6 m ahead, until the session ends. */
  enter(session: XRSession): Promise<void>;
}

function keep(list: number[], value: number) {
  list.push(value);
  if (list.length > TIMINGS_KEPT) list.shift();
}

/**
 * The preview in a headset: the same hologram, 1.6 m ahead of where the head is when the room
 * opens, going through whichever phase the page or the controller asks for. A select — the
 * trigger, or a pinch — moves on to the next phase, so every phase can be seen with the headset on.
 *
 * A renderer of its own, as the app's room has, so the desktop stage's GL context is left alone.
 */
export function createPreviewRoom(painter: Painter): PreviewRoom {
  let entered = false;
  let phase: PreviewPhase = 'greeting';
  let secondsIntoPhase = 0;
  let holdAtSeconds = Number.POSITIVE_INFINITY;
  let mode: PreviewMode = 'volumetric';
  let alphaFactor: number | null = null;
  let hologram: JarvisHologram3D | null = null;
  let head: RoomPoint | null = null;
  let placedAt: RoomPoint | null = null;
  let headAtPlacement: RoomPoint | null = null;
  const drives = createPhaseDrives(() => secondsIntoPhase);
  const timings: RoomTimings = { frames: 0, intervals: [], updates: [], canvasKit: [] };

  function setPhase(next: PreviewPhase, holdAt = Number.POSITIVE_INFINITY) {
    phase = next;
    secondsIntoPhase = 0;
    holdAtSeconds = holdAt;
    if (hologram !== null && (drives[next].arrives || hologram.presence <= 0)) {
      hologram.arrive(head ?? undefined);
    }
  }

  async function enter(session: XRSession) {
    const renderer = new WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    const shown = await createJarvisHologram3D(renderer, {
      assetBase: new URL(document.baseURI),
      painter,
      // Every frame alike in the preview: the emulator's frame times say nothing about a headset's.
      densityBackstop: false,
    });
    shown.mode = mode;
    if (alphaFactor !== null) shown.alphaFactor = alphaFactor;
    hologram = shown;
    const scene = new Scene();
    scene.add(shown.object);
    const camera = new PerspectiveCamera();
    const ended = new Promise<void>((resolve) => session.addEventListener('end', () => resolve(), { once: true }));
    session.addEventListener('select', () => {
      setPhase(PREVIEW_PHASES[(PREVIEW_PHASES.indexOf(phase) + 1) % PREVIEW_PHASES.length]);
    });
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(FOVEATION);
    entered = true;

    let placed = false;
    let lastTime: number | null = null;
    const standHimAhead = (eye: CentreEye) => {
      const { x, y, z } = pointAhead(eye, DISTANCE_AHEAD_METRES);
      shown.object.position.set(x, y, z);
      shown.arrive(eye.position);
      placedAt = { x, y, z };
      headAtPlacement = head;
      placed = true;
    };
    const draw = (time: number, eye: CentreEye) => {
      const deltaSeconds = lastTime === null ? 0 : (time - lastTime) / 1000;
      if (lastTime !== null) keep(timings.intervals, time - lastTime);
      lastTime = time;
      secondsIntoPhase = Math.min(holdAtSeconds, secondsIntoPhase + deltaSeconds);
      shown.update(deltaSeconds, drives[phase].drive, eye);
      keep(timings.updates, shown.diagnostics.cpuMilliseconds);
      keep(timings.canvasKit, shown.diagnostics.canvasKitMilliseconds);
      renderer.render(scene, camera);
      timings.frames += 1;
    };
    renderer.setAnimationLoop((time, frame) => {
      const space = renderer.xr.getReferenceSpace();
      if (frame === undefined || space === null) return;
      const eye = centreEyeOf(frame, space);
      if (eye === null) return;
      head = { x: eye.position.x, y: eye.position.y, z: eye.position.z };
      if (!placed) standHimAhead(eye);
      draw(time, eye);
    });

    await ended;
    renderer.setAnimationLoop(null);
    entered = false;
    hologram = null;
    shown.dispose();
    renderer.dispose();
  }

  return {
    status() {
      return {
        ...timings,
        intervals: [...timings.intervals],
        updates: [...timings.updates],
        canvasKit: [...timings.canvasKit],
        entered,
        phase,
        secondsIntoPhase,
        placedAt,
        headAtPlacement,
      };
    },
    setPhase,
    setMode(next) {
      mode = next;
      if (hologram !== null) hologram.mode = next;
    },
    setAlphaFactor(share) {
      alphaFactor = share;
      if (hologram !== null) hologram.alphaFactor = share;
    },
    enter,
  };
}
