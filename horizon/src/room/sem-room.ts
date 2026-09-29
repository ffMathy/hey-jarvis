import { poseFromQuaternion } from './pose-matrix';
import type { RoomSnapshot, SceneMesh, ScenePlane } from './types';

/**
 * A real room for the placement specs: one of the Space Setup captures `@iwer/sem` ships, read
 * the way the Synthetic Environment Module reads it and turned into what the browser tests'
 * emulated Quest hands the app — the same planes, boxes and room scan, in the same places.
 * Only the specs import this.
 *
 * The module's own conversion (`lib/src/native/entity.js` and its components) makes three.js
 * objects; this does the same arithmetic without them:
 * - every entity is posed by its `locatable_META` position and orientation;
 * - a `bounded2D_META` rectangle becomes a plane whose polygon is the rectangle's corners in
 *   x/z, on y = 0, with the first corner repeated at the end, as the module sends it;
 * - a `bounded3D_META` box becomes a box mesh from its offset and extent (the module sends
 *   three's 24-vertex box; the 8 corners here describe the same solid);
 * - a `triangleMesh_META` becomes a mesh from its base64 float32 vertices and uint32 indices;
 * - labels are mapped as the module maps Meta's to WebXR's.
 */

/** Meta's scene labels to WebXR's, exactly as `entity.js` maps them. */
const WEBXR_LABELS: Record<string, string> = {
  OTHER: 'other',
  TABLE: 'table',
  COUCH: 'couch',
  FLOOR: 'floor',
  CEILING: 'ceiling',
  WALL_FACE: 'wall',
  INVISIBLE_WALL_FACE: 'window',
  INNER_WALL_FACE: 'wall',
  DOOR_FRAME: 'door',
  WINDOW_FRAME: 'window',
  WALL_ART: 'wall art',
  STORAGE: 'shelf',
  BED: 'bed',
  LAMP: 'lamp',
  SCREEN: 'screen',
  PLANT: 'plant',
  GLOBAL_MESH: 'global mesh',
  CHAIR: 'couch',
  UNKNOWN: 'other',
  OTHER_ROOM_FACE: 'other',
  OPENING: 'other',
};

export type SemRoomName = 'living_room' | 'meeting_room' | 'music_room' | 'office_large' | 'office_small';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, key: string): JsonRecord {
  const field = isRecord(value) ? value[key] : undefined;
  if (!isRecord(field)) throw new Error(`The capture has no object at "${key}".`);
  return field;
}

function numberAt(value: JsonRecord, key: string): number {
  const field = value[key];
  // Protobuf's JSON form leaves out fields that are zero.
  if (field === undefined) return 0;
  if (typeof field !== 'number') throw new Error(`The capture has no number at "${key}".`);
  return field;
}

function base64Bytes(value: JsonRecord, key: string): ArrayBuffer {
  const field = value[key];
  if (typeof field !== 'string') throw new Error(`The capture has no base64 at "${key}".`);
  return Uint8Array.from(Buffer.from(field, 'base64')).buffer;
}

function vector(value: JsonRecord) {
  return { x: numberAt(value, 'x'), y: numberAt(value, 'y'), z: numberAt(value, 'z') };
}

function planeFrom(label: string, pose: Float32Array, bounds: JsonRecord): ScenePlane {
  const offset = record(bounds, 'offset');
  const extent = record(bounds, 'extent');
  const left = numberAt(offset, 'x');
  const near = numberAt(offset, 'y');
  const right = left + numberAt(extent, 'width');
  const far = near + numberAt(extent, 'height');
  const polygon = [
    { x: left, y: 0, z: near },
    { x: right, y: 0, z: near },
    { x: right, y: 0, z: far },
    { x: left, y: 0, z: far },
    { x: left, y: 0, z: near },
  ];
  return { label, pose, polygon };
}

function boxFrom(label: string, pose: Float32Array, bounds: JsonRecord): SceneMesh {
  const low = vector(record(bounds, 'offset'));
  const extent = record(bounds, 'extent');
  const high = {
    x: low.x + numberAt(extent, 'width'),
    y: low.y + numberAt(extent, 'height'),
    z: low.z + numberAt(extent, 'depth'),
  };
  const vertices = new Float32Array(24);
  let offset = 0;
  for (const y of [low.y, high.y]) {
    for (const [x, z] of [
      [low.x, low.z],
      [high.x, low.z],
      [high.x, high.z],
      [low.x, high.z],
    ]) {
      vertices.set([x, y, z], offset);
      offset += 3;
    }
  }
  const faces = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  return { label, pose, vertices, indices: new Uint32Array(faces) };
}

function meshFrom(label: string, pose: Float32Array, triangles: JsonRecord): SceneMesh {
  return {
    label,
    pose,
    vertices: new Float32Array(base64Bytes(triangles, 'vertices')),
    indices: new Uint32Array(base64Bytes(triangles, 'indices')),
  };
}

/** One of `@iwer/sem`'s captured rooms as a snapshot, in the emulator's `local-floor` space. */
export async function loadSemRoom(name: SemRoomName): Promise<RoomSnapshot> {
  // Read at run time rather than imported: a 1.5 MB JSON module would have the typechecker
  // work through every byte of it.
  const path = Bun.resolveSync(`@iwer/sem/captures/${name}.json`, import.meta.dir);
  const capture: unknown = await Bun.file(path).json();
  const entities = isRecord(capture) ? capture.spatialEntities : undefined;
  if (!Array.isArray(entities)) throw new Error(`${name} has no spatial entities.`);
  const snapshot: RoomSnapshot = { planes: [], meshes: [], epoch: 0 };
  for (const entity of entities) {
    if (!isRecord(entity) || !isRecord(entity.locatable_META)) continue;
    const locatable = entity.locatable_META;
    const pose = poseFromQuaternion(vector(record(locatable, 'position')), {
      ...vector(record(locatable, 'orientation')),
      w: numberAt(record(locatable, 'orientation'), 'w'),
    });
    const meta = typeof entity.semanticLabel_META === 'string' ? entity.semanticLabel_META : 'UNKNOWN';
    const label = WEBXR_LABELS[meta] ?? 'other';
    if (isRecord(entity.bounded2D_META)) snapshot.planes.push(planeFrom(label, pose, entity.bounded2D_META));
    else if (isRecord(entity.bounded3D_META)) snapshot.meshes.push(boxFrom(label, pose, entity.bounded3D_META));
    else if (isRecord(entity.triangleMesh_META)) snapshot.meshes.push(meshFrom(label, pose, entity.triangleMesh_META));
  }
  return snapshot;
}
