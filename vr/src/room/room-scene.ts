import { areaOf, convexHull, type FloorPoint } from './floor-polygon';
import { computeDistanceField, countOccupied, createGrid, type OccupancyGrid } from './occupancy-grid';
import {
  boxCorners,
  fillBox,
  isBox,
  type PosedPlane,
  posePlane,
  poseVertices,
  rasteriseMesh,
  rasterisePlane,
} from './scene-geometry';
import type { RoomDescription, RoomSnapshot, SceneMesh, Vector3Like } from './types';

/**
 * Everything placement reads, built once from a snapshot: the occupancy grid and its distance
 * field, the floors and ceilings that say which room is which, and the tops he may hover above
 * when the room is too cramped for anything else.
 */

/** A horizontal outline at a height: a room's floor or ceiling, or the top of a table. */
export interface LevelArea {
  outline: FloorPoint[];
  height: number;
}

export interface RoomScene {
  epoch: number;
  /** Null when the snapshot has no geometry at all. */
  grid: OccupancyGrid | null;
  occupiedCells: number;
  floors: LevelArea[];
  ceilings: LevelArea[];
  /** The convex outline of every wall seen from above, or empty without walls. */
  wallOutline: FloorPoint[];
  /** Table and desk tops. */
  surfaces: LevelArea[];
  description: RoomDescription;
}

/**
 * Room left around the geometry, so a spot just past the last known surface still has a grid
 * under it. Less below and above than around: he is never placed under the floor or over the
 * ceiling, while a room known only by its furniture has candidates well past the last box.
 * Beyond the grid, clearance is still answered, only more cautiously.
 */
const GRID_MARGIN_METRES = 0.6;
const GRID_VERTICAL_MARGIN_METRES = 0.4;

/**
 * How far from the reference space's origin the grid may reach, horizontally and vertically.
 * The origin is where the session started, so the user is near it, and a candidate is never
 * more than a few metres from the user; a room scan of a whole floor of a house would otherwise
 * make a grid of millions of cells for nothing.
 */
const GRID_REACH_METRES = 10;
const GRID_LOWEST_METRES = -1.5;
const GRID_HIGHEST_METRES = 5;

/** Labels of the tops he may be placed above when squeezed. */
const SURFACE_LABELS = new Set(['table', 'desk']);

/** An unlabelled horizontal plane at least this big, near the floor, is taken for the floor. */
const SMALLEST_UNLABELLED_FLOOR = 1.5;

function outlineOf(plane: PosedPlane): FloorPoint[] {
  return plane.corners.map((corner) => ({ x: corner.x, z: corner.z }));
}

function isFloor(plane: PosedPlane): boolean {
  if (plane.orientation !== 'horizontal') return false;
  if (plane.label === 'floor') return true;
  return plane.label === '' && Math.abs(plane.height) < 0.3 && plane.area >= SMALLEST_UNLABELLED_FLOOR;
}

/** The tops of the tables and desks, from their planes and from their boxes. */
function surfacesOf(planes: PosedPlane[], meshes: SceneMesh[]): LevelArea[] {
  const fromPlanes = planes
    .filter((plane) => plane.orientation === 'horizontal' && SURFACE_LABELS.has(plane.label))
    .map((plane) => ({ outline: outlineOf(plane), height: plane.height }));
  const fromBoxes = meshes
    .filter((mesh) => SURFACE_LABELS.has(mesh.label) && isBox(mesh))
    .map((mesh) => {
      const corners = boxCorners(mesh);
      return {
        outline: convexHull(corners.map((corner) => ({ x: corner.x, z: corner.z }))),
        height: Math.max(...corners.map((corner) => corner.y)),
      };
    });
  return [...fromPlanes, ...fromBoxes].filter((surface) => areaOf(surface.outline) > 0.01);
}

function describe(snapshot: RoomSnapshot, occupiedCells: number): RoomDescription {
  const labels: Record<string, number> = {};
  for (const { label } of [...snapshot.planes, ...snapshot.meshes]) labels[label] = (labels[label] ?? 0) + 1;
  return {
    planes: snapshot.planes.length,
    meshes: snapshot.meshes.length,
    labels,
    triangles: snapshot.meshes.reduce((sum, mesh) => sum + Math.floor(mesh.indices.length / 3), 0),
    voxels: occupiedCells,
    epoch: snapshot.epoch,
  };
}

/** The box around every posed point, grown by the margin and cut to the grid's reach; null if there are none. */
function gridBox(planes: PosedPlane[], posedMeshes: Float32Array[]): { min: Vector3Like; max: Vector3Like } | null {
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  const include = (x: number, y: number, z: number) => {
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  };
  for (const plane of planes) for (const corner of plane.corners) include(corner.x, corner.y, corner.z);
  for (const posed of posedMeshes) {
    for (let index = 0; index < posed.length; index += 3) include(posed[index], posed[index + 1], posed[index + 2]);
  }
  const low = {
    x: Math.max(min.x - GRID_MARGIN_METRES, -GRID_REACH_METRES),
    y: Math.max(min.y - GRID_VERTICAL_MARGIN_METRES, GRID_LOWEST_METRES),
    z: Math.max(min.z - GRID_MARGIN_METRES, -GRID_REACH_METRES),
  };
  const high = {
    x: Math.min(max.x + GRID_MARGIN_METRES, GRID_REACH_METRES),
    y: Math.min(max.y + GRID_VERTICAL_MARGIN_METRES, GRID_HIGHEST_METRES),
    z: Math.min(max.z + GRID_MARGIN_METRES, GRID_REACH_METRES),
  };
  return low.x < high.x && low.y < high.y && low.z < high.z ? { min: low, max: high } : null;
}

/**
 * Builds the scene placement reads from `snapshot`.
 *
 * A generator that yields between pieces of work — a plane, a few thousand triangles, a few
 * hundred lines of the distance transform — so the worker can answer placements from the
 * previous scene while this one is built; `buildRoomSceneNow` runs it in one go.
 */
export function* buildRoomScene(snapshot: RoomSnapshot): Generator<void, RoomScene, void> {
  const planes = snapshot.planes.map(posePlane);
  const posedMeshes = snapshot.meshes.map(poseVertices);
  yield;
  const box = gridBox(planes, posedMeshes);
  const grid = box === null ? null : createGrid(box.min, box.max);
  if (grid !== null) {
    for (const plane of snapshot.planes) {
      rasterisePlane(grid, plane);
      yield;
    }
    for (const [index, mesh] of snapshot.meshes.entries()) {
      yield* rasteriseMesh(grid, posedMeshes[index], mesh.indices);
      if (isBox(mesh)) fillBox(grid, mesh);
      yield;
    }
    yield* computeDistanceField(grid);
  }
  const occupiedCells = grid === null ? 0 : countOccupied(grid);
  const walls = planes.filter((plane) => plane.label === 'wall' && plane.orientation === 'vertical');
  return {
    epoch: snapshot.epoch,
    grid,
    occupiedCells,
    floors: planes.filter(isFloor).map((plane) => ({ outline: outlineOf(plane), height: plane.height })),
    ceilings: planes
      .filter((plane) => plane.label === 'ceiling' && plane.orientation === 'horizontal')
      .map((plane) => ({ outline: outlineOf(plane), height: plane.height })),
    wallOutline: convexHull(walls.flatMap(outlineOf)),
    surfaces: surfacesOf(planes, snapshot.meshes),
    description: describe(snapshot, occupiedCells),
  };
}

/** Runs `buildRoomScene` to the end. */
export function buildRoomSceneNow(snapshot: RoomSnapshot): RoomScene {
  const builder = buildRoomScene(snapshot);
  for (;;) {
    const step = builder.next();
    if (step.done === true) return step.value;
  }
}

/** The scene of a room nothing is known about. */
export function emptyRoomScene(epoch: number): RoomScene {
  return buildRoomSceneNow({ planes: [], meshes: [], epoch });
}
