import { describe, expect, it } from 'bun:test';
import { poseFromAxes } from './pose-matrix';
import {
  createRoomTracker,
  type LiveRoomSnapshot,
  type MeshSource,
  type PlaneSource,
  type SceneFrame,
  snapshotRoom,
  watchResets,
} from './room-snapshot';

/**
 * A stand-in for the headset: planes and meshes with spaces of their own, and a frame that
 * poses each space from a table the spec fills in. The objects stay the same from frame to
 * frame, as the browser keeps them while it tracks them.
 */

function translation(x: number, y: number, z: number): Float32Array {
  return poseFromAxes({ x, y, z }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
}

interface FakePlane extends PlaneSource {
  lastChangedTime: number;
  polygon: { x: number; y: number; z: number }[];
}

interface FakeMesh extends MeshSource {
  lastChangedTime: number;
  vertices: Float32Array;
}

function fakeHeadset() {
  const referenceSpace = new EventTarget();
  const poses = new Map<XRSpace, Float32Array | null>();
  const floor: FakePlane = {
    planeSpace: new EventTarget(),
    polygon: [
      { x: -1, y: 0, z: -1 },
      { x: 1, y: 0, z: -1 },
      { x: 1, y: 0, z: 1 },
    ],
    lastChangedTime: 1,
    semanticLabel: 'floor',
  };
  const scan: FakeMesh = {
    meshSpace: new EventTarget(),
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    lastChangedTime: 1,
    semanticLabel: 'global mesh',
  };
  poses.set(floor.planeSpace, translation(0, 0, 0));
  poses.set(scan.meshSpace, translation(0, 0, 0));
  const planes = new Set<PlaneSource>([floor]);
  const meshes = new Set<MeshSource>([scan]);
  let enabledFeatures = ['local-floor', 'plane-detection', 'mesh-detection'];
  const frame: SceneFrame = {
    get session() {
      return { enabledFeatures };
    },
    detectedPlanes: planes,
    detectedMeshes: meshes,
    getPose: (space) => {
      const matrix = poses.get(space);
      return matrix === null || matrix === undefined ? null : { transform: { matrix } };
    },
  };
  const grant = (features: string[]) => {
    enabledFeatures = features;
  };
  return { referenceSpace, poses, floor, scan, planes, meshes, frame, grant };
}

describe('snapshotRoom', () => {
  it('copies each plane and mesh, posed and labelled, as plain data', () => {
    const headset = fakeHeadset();
    headset.poses.set(headset.floor.planeSpace, translation(0.5, 0, -2));
    const snapshot = snapshotRoom(headset.frame, headset.referenceSpace);
    expect(snapshot.epoch).toBe(0);
    expect(snapshot.planes).toHaveLength(1);
    const [floor] = snapshot.planes;
    expect(floor.label).toBe('floor');
    expect(Array.from(floor.pose.subarray(12, 15))).toEqual([0.5, 0, -2]);
    expect(floor.polygon).toEqual(headset.floor.polygon);
    expect(floor.polygon[0]).not.toBe(headset.floor.polygon[0]);
    const [scan] = snapshot.meshes;
    expect(scan.label).toBe('global mesh');
    expect(scan.vertices).toEqual(headset.scan.vertices);
    expect(scan.vertices).not.toBe(headset.scan.vertices);
    expect(scan.indices).not.toBe(headset.scan.indices);
  });

  it('is the previous snapshot itself when nothing has changed', () => {
    const headset = fakeHeadset();
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    expect(snapshotRoom(headset.frame, headset.referenceSpace, first)).toBe(first);
  });

  it('sees through a change time that moves while nothing changes, as the emulator reports it', () => {
    const headset = fakeHeadset();
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    headset.floor.lastChangedTime = 2;
    headset.scan.lastChangedTime = 2;
    expect(snapshotRoom(headset.frame, headset.referenceSpace, first)).toBe(first);
  });

  it('copies again only what changed', () => {
    const headset = fakeHeadset();
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    headset.scan.vertices = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    headset.scan.lastChangedTime = 2;
    const second = snapshotRoom(headset.frame, headset.referenceSpace, first);
    expect(second).not.toBe(first);
    expect(second.meshes[0].vertices[3]).toBe(2);
    expect(second.planes[0]).toBe(first.planes[0]);
  });

  it('takes a moved pose without copying the vertices again', () => {
    const headset = fakeHeadset();
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    // Tracking jitter of a few millimetres is not a move.
    headset.poses.set(headset.scan.meshSpace, translation(0.004, 0, 0));
    expect(snapshotRoom(headset.frame, headset.referenceSpace, first)).toBe(first);
    headset.poses.set(headset.scan.meshSpace, translation(0.3, 0, 0));
    const second = snapshotRoom(headset.frame, headset.referenceSpace, first);
    expect(second).not.toBe(first);
    expect(second.meshes[0].pose[12]).toBeCloseTo(0.3, 6);
    expect(second.meshes[0].vertices).toBe(first.meshes[0].vertices);
  });

  it('follows planes and meshes coming and going', () => {
    const headset = fakeHeadset();
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    headset.meshes.delete(headset.scan);
    const second = snapshotRoom(headset.frame, headset.referenceSpace, first);
    expect(second.meshes).toHaveLength(0);
    const table: PlaneSource = { ...headset.floor, planeSpace: new EventTarget(), semanticLabel: 'table' };
    headset.poses.set(table.planeSpace, translation(0, 0.7, 0));
    headset.planes.add(table);
    const third = snapshotRoom(headset.frame, headset.referenceSpace, second);
    expect(third.planes.map((plane) => plane.label)).toEqual(['floor', 'table']);
  });

  it('leaves out what cannot be posed yet, and keeps what was posed before where it was', () => {
    const headset = fakeHeadset();
    const table: PlaneSource = { ...headset.floor, planeSpace: new EventTarget(), semanticLabel: 'table' };
    headset.poses.set(table.planeSpace, null);
    headset.planes.add(table);
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    expect(first.planes.map((plane) => plane.label)).toEqual(['floor']);
    headset.poses.set(headset.floor.planeSpace, null);
    expect(snapshotRoom(headset.frame, headset.referenceSpace, first)).toBe(first);
  });

  it('starts afresh in a new epoch, even when nothing else changed', () => {
    const headset = fakeHeadset();
    const first = snapshotRoom(headset.frame, headset.referenceSpace);
    const second = snapshotRoom(headset.frame, headset.referenceSpace, first, 1);
    expect(second).not.toBe(first);
    expect(second.epoch).toBe(1);
    // Nothing is reused across a recentre: the old copies were posed in the old space.
    expect(second.planes[0]).not.toBe(first.planes[0]);
    // A pose the frame cannot give is not carried over from the old space either.
    headset.poses.set(headset.floor.planeSpace, null);
    expect(snapshotRoom(headset.frame, headset.referenceSpace, second, 2).planes).toHaveLength(0);
  });

  it('reads nothing the session was not granted', () => {
    const headset = fakeHeadset();
    headset.grant(['local-floor', 'plane-detection']);
    const frame: SceneFrame = {
      session: headset.frame.session,
      detectedPlanes: headset.planes,
      get detectedMeshes(): ReadonlySet<MeshSource> {
        throw new Error('Read without mesh-detection.');
      },
      getPose: headset.frame.getPose,
    };
    expect(snapshotRoom(frame, headset.referenceSpace).meshes).toHaveLength(0);
  });

  it('treats a refused feature as absent, and lets any other error through', () => {
    const headset = fakeHeadset();
    const throwing = (error: Error): SceneFrame => ({
      session: {},
      get detectedPlanes(): ReadonlySet<PlaneSource> {
        throw error;
      },
      detectedMeshes: headset.meshes,
      getPose: headset.frame.getPose,
    });
    const refused = throwing(new DOMException('Plane detection is not enabled.', 'NotSupportedError'));
    expect(snapshotRoom(refused, headset.referenceSpace).planes).toHaveLength(0);
    const stale = throwing(new DOMException('The frame is not active.', 'InvalidStateError'));
    expect(() => snapshotRoom(stale, headset.referenceSpace)).toThrow('not active');
  });

  it('accepts a real XRFrame and reference space', () => {
    // Compiles only while the real WebXR types fit the ones this module reads.
    const take = (frame: XRFrame, space: XRReferenceSpace): LiveRoomSnapshot => snapshotRoom(frame, space);
    const track = (frame: XRFrame, space: XRReferenceSpace): LiveRoomSnapshot => createRoomTracker(space).take(frame);
    expect(typeof take).toBe('function');
    expect(typeof track).toBe('function');
  });
});

describe('watchResets and createRoomTracker', () => {
  it('counts the reference space’s resets until disposed', () => {
    const space = new EventTarget();
    const seen: number[] = [];
    const watch = watchResets(space, (epoch) => seen.push(epoch));
    space.dispatchEvent(new Event('reset'));
    space.dispatchEvent(new Event('reset'));
    expect(watch.epoch).toBe(2);
    watch.dispose();
    space.dispatchEvent(new Event('reset'));
    expect(watch.epoch).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it('hands out the same snapshot until something changes, and a new epoch after a reset', () => {
    const headset = fakeHeadset();
    const tracker = createRoomTracker(headset.referenceSpace);
    const first = tracker.take(headset.frame);
    expect(tracker.take(headset.frame)).toBe(first);
    headset.referenceSpace.dispatchEvent(new Event('reset'));
    const second = tracker.take(headset.frame);
    expect(second).not.toBe(first);
    expect(second.epoch).toBe(1);
    expect(tracker.epoch).toBe(1);
    tracker.dispose();
  });
});
