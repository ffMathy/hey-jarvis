import { areaOf, coversPoint } from './floor-polygon';
import { markPoint, type OccupancyGrid, VOXEL_METRES } from './occupancy-grid';
import { axisOf, toLocal, toReference } from './pose-matrix';
import type { SceneMesh, ScenePlane, Vector3Like } from './types';

/**
 * Planes and meshes posed in the reference space, and drawn into the occupancy grid.
 *
 * A plane's polygon is in its own space, on y = 0 with +y along its normal; a mesh's vertices
 * are in the mesh's space. Everything here happens after the pose has been applied, so the
 * rest of placement only ever deals with points in the room.
 */

/**
 * Spacing between the points sampled on a surface: half a cell, so consecutive samples never
 * skip a cell and a surface comes out as an unbroken sheet of cells.
 */
const SAMPLE_METRES = VOXEL_METRES / 2;

/**
 * How far either side of a plane it is sampled, instead of on the plane itself. A plane at an
 * angle to the grid can graze a cell by a sliver that samples on the plane miss, and a sliver
 * is exactly the gap a line of sight slips through; two sheets of samples this far apart
 * between them cover every cell the plane passes through. The walls this thickens are the
 * room's, so erring thick only keeps him a little further from them.
 */
const PLANE_HALF_THICKNESS = VOXEL_METRES / 4;

/**
 * Meshes with no more vertices than this, other than the room scan, are furniture boxes, and
 * are filled solid rather than drawn as a shell — so a point inside a couch's box is inside
 * something, not in the middle of a hollow with room around it. Quest sends a box as 8 to 24
 * vertices; a room scan has thousands.
 */
const MOST_BOX_VERTICES = 64;

/** A plane counts as horizontal or vertical within about 15° of it. */
const LEVEL_COSINE = Math.cos((15 * Math.PI) / 180);

export type PlaneOrientation = 'horizontal' | 'vertical' | 'slanted';

export interface PosedPlane {
  label: string;
  /** The polygon's corners in the reference space. */
  corners: Vector3Like[];
  orientation: PlaneOrientation;
  /** Mean height of the corners, metres. */
  height: number;
  /** Area of the polygon, square metres. */
  area: number;
}

/**
 * The plane's corners in the reference space, and which way it faces.
 *
 * Only the axis of the normal matters, never its sign: the synthetic rooms the browser tests
 * run in turn some floors upside down, normal pointing into the ground, and a real headset is
 * free to do the same.
 */
export function posePlane(plane: ScenePlane): PosedPlane {
  const corners = plane.polygon.map((point) => toReference(plane.pose, point.x, 0, point.z));
  const upness = Math.abs(axisOf(plane.pose, 1).y);
  const orientation: PlaneOrientation =
    upness >= LEVEL_COSINE ? 'horizontal' : upness <= Math.sqrt(1 - LEVEL_COSINE ** 2) ? 'vertical' : 'slanted';
  const height = corners.reduce((sum, corner) => sum + corner.y, 0) / Math.max(corners.length, 1);
  return { label: plane.label, corners, orientation, height, area: areaOf(plane.polygon) };
}

/** Evenly spaced values from `min` to `max`, both included, no further apart than `spacing`. */
function steps(min: number, max: number, spacing: number): number[] {
  const count = Math.max(1, Math.ceil((max - min) / spacing));
  return Array.from({ length: count + 1 }, (_, index) => min + ((max - min) * index) / count);
}

/** Draws the plane into the grid as a sheet a little thicker than a cell is wide. */
export function rasterisePlane(grid: OccupancyGrid, plane: ScenePlane): void {
  const { polygon, pose } = plane;
  if (polygon.length < 3) return;
  const acrossX = polygon.map((point) => point.x);
  const acrossZ = polygon.map((point) => point.z);
  const samplesAlongZ = steps(Math.min(...acrossZ), Math.max(...acrossZ), SAMPLE_METRES);
  // The pose written out, since this runs for every sample of every wall.
  const [xAxisX, xAxisY, xAxisZ, , normalX, normalY, normalZ, , zAxisX, zAxisY, zAxisZ, , originX, originY, originZ] =
    pose;
  const offsetX = normalX * PLANE_HALF_THICKNESS;
  const offsetY = normalY * PLANE_HALF_THICKNESS;
  const offsetZ = normalZ * PLANE_HALF_THICKNESS;
  for (const x of steps(Math.min(...acrossX), Math.max(...acrossX), SAMPLE_METRES)) {
    for (const z of samplesAlongZ) {
      if (!coversPoint(polygon, { x, z }, 1e-4)) continue;
      const onX = xAxisX * x + zAxisX * z + originX;
      const onY = xAxisY * x + zAxisY * z + originY;
      const onZ = xAxisZ * x + zAxisZ * z + originZ;
      markPoint(grid, onX - offsetX, onY - offsetY, onZ - offsetZ);
      markPoint(grid, onX + offsetX, onY + offsetY, onZ + offsetZ);
    }
  }
}

/** Whether the mesh is a piece of furniture's box, to be filled solid. */
export function isBox(mesh: SceneMesh): boolean {
  return mesh.label !== 'global mesh' && mesh.vertices.length / 3 <= MOST_BOX_VERTICES;
}

/** The mesh's vertices in the reference space, x y z per vertex. */
export function poseVertices(mesh: SceneMesh): Float32Array {
  const { vertices, pose } = mesh;
  const posed = new Float32Array(vertices.length);
  for (let index = 0; index < vertices.length; index += 3) {
    const point = toReference(pose, vertices[index], vertices[index + 1], vertices[index + 2]);
    posed[index] = point.x;
    posed[index + 1] = point.y;
    posed[index + 2] = point.z;
  }
  return posed;
}

/**
 * Samples one triangle at half-cell spacing. `first`, `second` and `third` are the offsets of
 * its corners into `posed`.
 */
function rasteriseTriangle(grid: OccupancyGrid, posed: Float32Array, first: number, second: number, third: number) {
  const toSecondX = posed[second] - posed[first];
  const toSecondY = posed[second + 1] - posed[first + 1];
  const toSecondZ = posed[second + 2] - posed[first + 2];
  const toThirdX = posed[third] - posed[first];
  const toThirdY = posed[third + 1] - posed[first + 1];
  const toThirdZ = posed[third + 2] - posed[first + 2];
  const longest = Math.sqrt(
    Math.max(
      toSecondX * toSecondX + toSecondY * toSecondY + toSecondZ * toSecondZ,
      toThirdX * toThirdX + toThirdY * toThirdY + toThirdZ * toThirdZ,
      (toThirdX - toSecondX) ** 2 + (toThirdY - toSecondY) ** 2 + (toThirdZ - toSecondZ) ** 2,
    ),
  );
  // Most of a room scan's triangles are smaller than a sample spacing, and their corners are
  // already in the grid: every vertex is marked before the triangles are walked.
  if (longest <= SAMPLE_METRES) return;
  const divisions = Math.ceil(longest / SAMPLE_METRES);
  for (let towardsSecond = 0; towardsSecond <= divisions; towardsSecond++) {
    for (let towardsThird = 0; towardsThird <= divisions - towardsSecond; towardsThird++) {
      const secondWeight = towardsSecond / divisions;
      const thirdWeight = towardsThird / divisions;
      markPoint(
        grid,
        posed[first] + toSecondX * secondWeight + toThirdX * thirdWeight,
        posed[first + 1] + toSecondY * secondWeight + toThirdY * thirdWeight,
        posed[first + 2] + toSecondZ * secondWeight + toThirdZ * thirdWeight,
      );
    }
  }
}

/** Triangles drawn between two yields, so a room scan never holds the worker for long. */
const TRIANGLES_PER_SLICE = 4000;

/** Draws the mesh's surface into the grid, yielding every few thousand triangles. */
export function* rasteriseMesh(grid: OccupancyGrid, posed: Float32Array, indices: Uint32Array): Generator<void> {
  for (let index = 0; index < posed.length; index += 3) {
    markPoint(grid, posed[index], posed[index + 1], posed[index + 2]);
  }
  for (let index = 0; index + 2 < indices.length; index += 3) {
    rasteriseTriangle(grid, posed, indices[index] * 3, indices[index + 1] * 3, indices[index + 2] * 3);
    if ((index / 3) % TRIANGLES_PER_SLICE === TRIANGLES_PER_SLICE - 1) yield;
  }
}

/** The box of a mesh in its own space: the smallest and largest vertex coordinates. */
export function localBounds(vertices: Float32Array): { min: Vector3Like; max: Vector3Like } {
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  for (let index = 0; index < vertices.length; index += 3) {
    min.x = Math.min(min.x, vertices[index]);
    min.y = Math.min(min.y, vertices[index + 1]);
    min.z = Math.min(min.z, vertices[index + 2]);
    max.x = Math.max(max.x, vertices[index]);
    max.y = Math.max(max.y, vertices[index + 1]);
    max.z = Math.max(max.z, vertices[index + 2]);
  }
  return { min, max };
}

/** The eight corners of a mesh's own-space box, in the reference space. */
export function boxCorners(mesh: SceneMesh): Vector3Like[] {
  const { min, max } = localBounds(mesh.vertices);
  const corners: Vector3Like[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) corners.push(toReference(mesh.pose, x, y, z));
    }
  }
  return corners;
}

/** Marks every cell whose centre is inside the mesh's own-space box. */
export function fillBox(grid: OccupancyGrid, mesh: SceneMesh): void {
  const { min, max } = localBounds(mesh.vertices);
  const corners = boxCorners(mesh);
  const cellRange = (values: number[], origin: number, size: number): [number, number] => [
    Math.max(0, Math.floor((Math.min(...values) - origin) / VOXEL_METRES)),
    Math.min(size - 1, Math.floor((Math.max(...values) - origin) / VOXEL_METRES)),
  ];
  const [fromX, toX] = cellRange(
    corners.map((corner) => corner.x),
    grid.minX,
    grid.sizeX,
  );
  const [fromY, toY] = cellRange(
    corners.map((corner) => corner.y),
    grid.minY,
    grid.sizeY,
  );
  const [fromZ, toZ] = cellRange(
    corners.map((corner) => corner.z),
    grid.minZ,
    grid.sizeZ,
  );
  const inside = (value: number, low: number, high: number) => value >= low && value <= high;
  for (let cellZ = fromZ; cellZ <= toZ; cellZ++) {
    for (let cellY = fromY; cellY <= toY; cellY++) {
      for (let cellX = fromX; cellX <= toX; cellX++) {
        const centre = {
          x: grid.minX + (cellX + 0.5) * VOXEL_METRES,
          y: grid.minY + (cellY + 0.5) * VOXEL_METRES,
          z: grid.minZ + (cellZ + 0.5) * VOXEL_METRES,
        };
        const local = toLocal(mesh.pose, centre);
        if (inside(local.x, min.x, max.x) && inside(local.y, min.y, max.y) && inside(local.z, min.z, max.z)) {
          grid.occupied[(cellZ * grid.sizeY + cellY) * grid.sizeX + cellX] = 1;
        }
      }
    }
  }
}
