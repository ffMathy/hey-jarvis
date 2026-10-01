import { containsPoint } from '../../src/room/floor-polygon';
import { toReference } from '../../src/room/pose-matrix';
import { createRoomModel } from '../../src/room/room-model';
import { type LiveRoomSnapshot, snapshotRoom } from '../../src/room/room-snapshot';
import type { Placement, RoomDescription } from '../../src/room/types';

/**
 * The placement code, run in the page against the emulated headset's own XR objects.
 *
 * The unit tests feed placement rooms built by hand and a capture read from disk; what they
 * cannot say is whether the real thing — `XRFrame.detectedPlanes`, `detectedMeshes` and
 * `getPose` as the browser tests' emulated Quest hands them over — reads the same. This opens a
 * session of its own beside the app (the app is never entered), snapshots the room over a run of
 * frames, and places Jarvis from where the emulated head is. Bundled into an init script by the
 * spec, like the harness, so it never reaches the production build.
 */

export interface RoomProbeResult {
  description: RoomDescription;
  frames: number;
  /** How many different snapshot objects those frames produced: 1 when nothing changed between them. */
  distinctSnapshots: number;
  head: { x: number; y: number; z: number };
  placement: Placement;
  insideFloor: boolean;
  firstSnapshotMilliseconds: number;
  laterSnapshotMilliseconds: number;
  buildMilliseconds: number;
  /** The quickest of three builds after the first. */
  warmBuildMilliseconds: number;
  placeMilliseconds: number;
}

declare global {
  interface Window {
    __roomProbe?: () => Promise<RoomProbeResult>;
  }
}

/** Frames snapshotted: enough for the emulator to have marked everything changed many times over. */
const FRAMES = 12;

interface FrameReading {
  snapshots: LiveRoomSnapshot[];
  times: number[];
  pose: XRViewerPose;
}

function readFrames(session: XRSession, space: XRReferenceSpace): Promise<FrameReading> {
  const snapshots: LiveRoomSnapshot[] = [];
  const times: number[] = [];
  return new Promise((resolve, reject) => {
    const onFrame = (_time: number, frame: XRFrame) => {
      try {
        const start = performance.now();
        snapshots.push(snapshotRoom(frame, space, snapshots.at(-1)));
        times.push(performance.now() - start);
        const pose = frame.getViewerPose(space);
        if (snapshots.length >= FRAMES && pose !== undefined) resolve({ snapshots, times, pose });
        else session.requestAnimationFrame(onFrame);
      } catch (error) {
        reject(error);
      }
    };
    session.requestAnimationFrame(onFrame);
  });
}

async function probeRoom(): Promise<RoomProbeResult> {
  const xr = navigator.xr;
  if (xr === undefined) throw new Error('No WebXR in this page.');
  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['plane-detection', 'mesh-detection'],
  });
  try {
    // Frames only come to a session with a layer to draw into.
    const context = document.createElement('canvas').getContext('webgl2', { xrCompatible: true });
    if (context === null) throw new Error('No WebGL 2 for the probe.');
    await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, context) });
    const space = await session.requestReferenceSpace('local-floor');
    const { snapshots, times, pose } = await readFrames(session, space);
    const room = snapshots[snapshots.length - 1];

    const model = createRoomModel();
    let start = performance.now();
    model.update(room);
    const buildMilliseconds = performance.now() - start;
    // Built again, warm: the first build also pays for compiling the code.
    let warmBuildMilliseconds = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round++) {
      start = performance.now();
      model.update({ ...room });
      warmBuildMilliseconds = Math.min(warmBuildMilliseconds, performance.now() - start);
    }

    const { position, orientation } = pose.transform;
    const { x, y, z, w } = orientation;
    // The head's -z axis: where the emulated headset looks.
    const forward = { x: -2 * (x * z + y * w), y: -2 * (y * z - x * w), z: -(1 - 2 * (x * x + y * y)) };
    const head = { x: position.x, y: position.y, z: position.z };
    start = performance.now();
    const placement = model.place({ head, forward, depthProbes: [] });
    const placeMilliseconds = performance.now() - start;

    const floor = room.planes.find((plane) => plane.label === 'floor');
    const outline = floor?.polygon.map((point) => toReference(floor.pose, point.x, 0, point.z)) ?? [];
    const later = times.slice(1);
    return {
      description: model.describe(),
      frames: snapshots.length,
      distinctSnapshots: new Set(snapshots).size,
      head,
      placement,
      insideFloor: containsPoint(outline, placement.position),
      firstSnapshotMilliseconds: times[0],
      laterSnapshotMilliseconds: later.reduce((sum, time) => sum + time, 0) / later.length,
      buildMilliseconds,
      warmBuildMilliseconds,
      placeMilliseconds,
    };
  } finally {
    await session.end();
  }
}

window.__roomProbe = probeRoom;
