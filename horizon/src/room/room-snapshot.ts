import type { RoomSnapshot, SceneMesh, ScenePlane, Vector3Like } from './types';

/**
 * Reading the room out of an XR frame: every plane and mesh the headset reports, posed in the
 * app's reference space, as plain data the placement worker can be sent.
 *
 * Planes, meshes and their poses can only be read inside a frame callback, and a scanned room's
 * mesh is tens of thousands of triangles, so a snapshot remembers what it copied and from
 * where. The next one re-reads every pose — that is cheap — but copies vertices again only for
 * what actually changed, and when nothing did it is the previous snapshot itself, so the caller
 * can tell with `!==` whether there is anything to send.
 */

/** The parts of an `XRPlane` read here. */
export interface PlaneSource {
  readonly planeSpace: XRSpace;
  readonly polygon: readonly Vector3Like[];
  readonly lastChangedTime: number;
  readonly semanticLabel?: string;
}

/** The parts of an `XRMesh` read here. */
export interface MeshSource {
  readonly meshSpace: XRSpace;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly lastChangedTime: number;
  readonly semanticLabel?: string;
}

/** The parts of an `XRFrame` read here, so the specs can hand in a frame of their own; a real one fits. */
export interface SceneFrame {
  readonly session: { readonly enabledFeatures?: readonly string[] };
  readonly detectedPlanes?: ReadonlySet<PlaneSource>;
  readonly detectedMeshes?: ReadonlySet<MeshSource>;
  getPose(
    space: XRSpace,
    baseSpace: XRSpace,
  ): { readonly transform: { readonly matrix: Float32Array } } | null | undefined;
}

interface PlaneRecord {
  /** When the source last changed, as far as this record knows. */
  lastChangedTime: number;
  plane: ScenePlane;
}

interface MeshRecord {
  lastChangedTime: number;
  /** The arrays the copies were made from, to tell a mesh handed over again from a new one. */
  vertices: Float32Array;
  indices: Uint32Array;
  mesh: SceneMesh;
}

/** A snapshot, and what each of its planes and meshes was copied from. */
export interface LiveRoomSnapshot extends RoomSnapshot {
  /** Keyed by the `XRPlane` and `XRMesh` objects themselves, which the browser keeps the same while it tracks them. */
  readonly sources: {
    readonly planes: ReadonlyMap<PlaneSource, PlaneRecord>;
    readonly meshes: ReadonlyMap<MeshSource, MeshRecord>;
  };
}

/**
 * How far a pose may drift before it counts as moved: a centimetre, or about a third of a
 * degree. Tracking nudges scene anchors by less than that all the time, and rebuilding the grid
 * for it would be all cost and no difference to where he stands.
 */
const MOVED_METRES = 0.01;
const TURNED = 0.005;

function samePose(held: Float32Array, current: Float32Array): boolean {
  for (let index = 0; index < 12; index++) if (Math.abs(held[index] - current[index]) > TURNED) return false;
  for (let index = 12; index < 15; index++) if (Math.abs(held[index] - current[index]) > MOVED_METRES) return false;
  return true;
}

function samePolygon(copy: readonly Vector3Like[], source: readonly Vector3Like[]): boolean {
  return (
    copy.length === source.length &&
    copy.every(
      (point, index) => point.x === source[index].x && point.y === source[index].y && point.z === source[index].z,
    )
  );
}

function sameArray(copy: Float32Array | Uint32Array, source: Float32Array | Uint32Array): boolean {
  if (copy.length !== source.length) return false;
  for (let index = 0; index < copy.length; index++) if (copy[index] !== source[index]) return false;
  return true;
}

/**
 * The frame's planes or meshes, or none when the feature was not granted.
 *
 * Reading `detectedPlanes` or `detectedMeshes` without the feature throws `NotSupportedError`
 * in Chromium, and a session that was refused the spatial permission has neither. Any other
 * error — `InvalidStateError` from a frame that is no longer active above all — is a mistake
 * in the caller, and is let through.
 */
function detected<Source>(
  frame: SceneFrame,
  feature: string,
  read: () => ReadonlySet<Source> | undefined,
): ReadonlySet<Source> {
  const granted = frame.session.enabledFeatures;
  if (granted !== undefined && !granted.includes(feature)) return new Set();
  try {
    return read() ?? new Set();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotSupportedError') return new Set();
    throw error;
  }
}

/** The record for this plane now: the old one when nothing about it changed, else a fresh copy. */
function planeRecord(source: PlaneSource, pose: Float32Array, old: PlaneRecord | undefined): PlaneRecord {
  if (old !== undefined && samePose(old.plane.pose, pose)) {
    if (old.lastChangedTime === source.lastChangedTime) return old;
    // Said to have changed, yet the same: the emulator the browser tests use marks every plane
    // changed on every frame. Remember the time, so the comparison is not repeated for nothing.
    if (samePolygon(old.plane.polygon, source.polygon)) {
      old.lastChangedTime = source.lastChangedTime;
      return old;
    }
  }
  const polygon =
    old !== undefined && samePolygon(old.plane.polygon, source.polygon)
      ? old.plane.polygon
      : source.polygon.map(({ x, y, z }) => ({ x, y, z }));
  return {
    lastChangedTime: source.lastChangedTime,
    plane: { label: source.semanticLabel ?? '', pose: new Float32Array(pose), polygon },
  };
}

/**
 * Whether the mesh's shape is the one `old` copied.
 *
 * A change time that has not moved says so; so do the very arrays the copies were made from,
 * which is how the emulator hands over a mesh it marks changed on every frame — comparing its
 * room scan element by element took several milliseconds a frame there. Anything else is
 * compared in full, since a scan whose change time moved may still hold the same triangles.
 */
function sameShape(source: MeshSource, old: MeshRecord): boolean {
  if (old.lastChangedTime === source.lastChangedTime) return true;
  if (old.vertices === source.vertices && old.indices === source.indices) return true;
  return sameArray(old.mesh.vertices, source.vertices) && sameArray(old.mesh.indices, source.indices);
}

/** The record for this mesh now; vertices are copied only when they are not the ones already held. */
function meshRecord(source: MeshSource, pose: Float32Array, old: MeshRecord | undefined): MeshRecord {
  if (old !== undefined && sameShape(source, old)) {
    old.lastChangedTime = source.lastChangedTime;
    old.vertices = source.vertices;
    old.indices = source.indices;
    if (samePose(old.mesh.pose, pose)) return old;
    return { ...old, mesh: { ...old.mesh, pose: new Float32Array(pose) } };
  }
  return {
    lastChangedTime: source.lastChangedTime,
    vertices: source.vertices,
    indices: source.indices,
    mesh: {
      label: source.semanticLabel ?? '',
      pose: new Float32Array(pose),
      vertices: new Float32Array(source.vertices),
      indices: new Uint32Array(source.indices),
    },
  };
}

/**
 * The records for every source the frame reports, and whether any differs from before.
 *
 * A source whose pose the frame cannot give is kept where it was last seen, if it was seen in
 * this epoch; one never posed yet is left out until it can be.
 */
function refresh<Source, Record>(
  sources: ReadonlySet<Source>,
  previous: ReadonlyMap<Source, Record> | undefined,
  poseOf: (source: Source) => Float32Array | undefined,
  recordOf: (source: Source, pose: Float32Array, old: Record | undefined) => Record,
): { records: Map<Source, Record>; changed: boolean } {
  const records = new Map<Source, Record>();
  let changed = previous === undefined;
  for (const source of sources) {
    const old = previous?.get(source);
    const pose = poseOf(source);
    const record = pose === undefined ? old : recordOf(source, pose, old);
    if (record === undefined) continue;
    records.set(source, record);
    if (record !== old) changed = true;
  }
  if (previous !== undefined && records.size !== previous.size) changed = true;
  return { records, changed };
}

/**
 * The room as `frame` reports it, posed in `referenceSpace`.
 *
 * Call it only inside an XR frame callback, with that callback's frame. `previous` is what the
 * last call returned; when nothing has changed since, that is what this returns too. `epoch`
 * is the reference space's reset count (see `watchResets`): a new one means every pose moved,
 * so nothing from before is reused.
 */
export function snapshotRoom(
  frame: SceneFrame,
  referenceSpace: XRSpace,
  previous?: LiveRoomSnapshot,
  epoch: number = previous?.epoch ?? 0,
): LiveRoomSnapshot {
  const earlier = previous?.epoch === epoch ? previous : undefined;
  const poseOf = (space: XRSpace) => frame.getPose(space, referenceSpace)?.transform.matrix;
  const planes = refresh(
    detected(frame, 'plane-detection', () => frame.detectedPlanes),
    earlier?.sources.planes,
    (source) => poseOf(source.planeSpace),
    planeRecord,
  );
  const meshes = refresh(
    detected(frame, 'mesh-detection', () => frame.detectedMeshes),
    earlier?.sources.meshes,
    (source) => poseOf(source.meshSpace),
    meshRecord,
  );
  if (earlier !== undefined && !planes.changed && !meshes.changed) return earlier;
  return {
    planes: [...planes.records.values()].map((record) => record.plane),
    meshes: [...meshes.records.values()].map((record) => record.mesh),
    epoch,
    sources: { planes: planes.records, meshes: meshes.records },
  };
}

/** The part of an `XRReferenceSpace` that says when it was reset. */
export type ResettableSpace = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface ResetWatch {
  /** How many times the space has been reset since the watch began. */
  readonly epoch: number;
  dispose(): void;
}

/**
 * Counts the reference space's resets.
 *
 * A recentre, or the headset relocalising, fires `reset` and moves the space's origin: every
 * pose read before it is in a frame that no longer exists, and no plane's `lastChangedTime`
 * says so. The count is the snapshot's epoch.
 */
export function watchResets(space: ResettableSpace, onReset?: (epoch: number) => void): ResetWatch {
  let epoch = 0;
  const listener = () => {
    epoch += 1;
    onReset?.(epoch);
  };
  space.addEventListener('reset', listener);
  return {
    get epoch() {
      return epoch;
    },
    dispose: () => space.removeEventListener('reset', listener),
  };
}

export interface RoomTracker {
  /**
   * The room in this frame; the same object as last time when nothing has changed. Only inside
   * an XR frame callback. Every call reads every pose, so a few times a second and on summon is
   * plenty — not every frame.
   */
  take(frame: SceneFrame): LiveRoomSnapshot;
  readonly epoch: number;
  dispose(): void;
}

/** `snapshotRoom` and `watchResets` together, for one reference space. */
export function createRoomTracker(referenceSpace: XRSpace): RoomTracker {
  const resets = watchResets(referenceSpace);
  let last: LiveRoomSnapshot | undefined;
  return {
    take(frame) {
      last = snapshotRoom(frame, referenceSpace, last, resets.epoch);
      return last;
    },
    get epoch() {
      return resets.epoch;
    },
    dispose: () => resets.dispose(),
  };
}
