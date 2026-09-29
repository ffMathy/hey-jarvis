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
  return { label: plane.label, corners, orientation, height, area: polygonArea(plane.polygon) };
}

/** Area of a plane-space polygon (x and z), whatever its winding. */
function polygonArea(polygon: readonly Vector3Like[]): number {
  let twiceArea = 0;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    twiceArea += polygon[previous].x * polygon[index].z - polygon[index].x * polygon[previous].z;
  }
  return Math.abs(twiceArea) / 2;
}

/** Whether the plane-space point x, z is inside the polygon or within `tolerance` of its outline. */
function onPolygon(polygon: readonly Vector3Like[], x: number, z: number, tolerance: number): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x)) inside = !inside;
  }
  if (inside) return true;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    if (distanceToSegment(x, z, polygon[index], polygon[previous]) <= tolerance) return true;
  }
  return false;
}

function distanceToSegment(x: number, z: number, a: Vector3Like, b: Vector3Like): number {
  const edgeX = b.x - a.x;
  const edgeZ = b.z - a.z;
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
  const along =
    lengthSquared === 0 ? 0 : Math.min(Math.max(((x - a.x) * edgeX + (z - a.z) * edgeZ) / lengthSquared, 0), 1);
  return Math.hypot(x - (a.x + along * edgeX), z - (a.z + along * edgeZ));
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
  const xs = polygon.map((point) => point.x);
  const zs = polygon.map((point) => point.z);
  const alongZ = steps(Math.min(...zs), Math.max(...zs), SAMPLE_METRES);
  // The pose written out, since this runs for every sample of every wall.
  const [xx, xy, xz, , yx, yy, yz, , zx, zy, zz, , ox, oy, oz] = pose;
  for (const x of steps(Math.min(...xs), Math.max(...xs), SAMPLE_METRES)) {
    for (const z of alongZ) {
      if (!onPolygon(polygon, x, z, 1e-4)) continue;
      const onX = xx * x + zx * z + ox;
      const onY = xy * x + zy * z + oy;
      const onZ = xz * x + zz * z + oz;
      markPoint(
        grid,
        onX - yx * PLANE_HALF_THICKNESS,
        onY - yy * PLANE_HALF_THICKNESS,
        onZ - yz * PLANE_HALF_THICKNESS,
      );
      markPoint(
        grid,
        onX + yx * PLANE_HALF_THICKNESS,
        onY + yy * PLANE_HALF_THICKNESS,
        onZ + yz * PLANE_HALF_THICKNESS,
      );
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

/** Samples one triangle of posed vertices `a`, `b`, `c` (offsets into `posed`) at half-cell spacing. */
function rasteriseTriangle(grid: OccupancyGrid, posed: Float32Array, a: number, b: number, c: number) {
  const abX = posed[b] - posed[a];
  const abY = posed[b + 1] - posed[a + 1];
  const abZ = posed[b + 2] - posed[a + 2];
  const acX = posed[c] - posed[a];
  const acY = posed[c + 1] - posed[a + 1];
  const acZ = posed[c + 2] - posed[a + 2];
  const longest = Math.sqrt(
    Math.max(
      abX * abX + abY * abY + abZ * abZ,
      acX * acX + acY * acY + acZ * acZ,
      (acX - abX) ** 2 + (acY - abY) ** 2 + (acZ - abZ) ** 2,
    ),
  );
  // Most of a room scan's triangles are smaller than a sample spacing, and their corners are
  // already in the grid: every vertex is marked before the triangles are walked.
  if (longest <= SAMPLE_METRES) return;
  const divisions = Math.ceil(longest / SAMPLE_METRES);
  for (let along = 0; along <= divisions; along++) {
    for (let across = 0; across <= divisions - along; across++) {
      const u = along / divisions;
      const v = across / divisions;
      markPoint(grid, posed[a] + abX * u + acX * v, posed[a + 1] + abY * u + acY * v, posed[a + 2] + abZ * u + acZ * v);
    }
  }
}

/** Triangles drawn between two yields, so a room scan never holds the worker for long. */
const TRIANGLES_PER_SLICE = 4000;

/** Draws the mesh's surface into the grid, yielding every few thousand triangles. */
export function* rasteriseMesh(grid: OccupancyGrid, posed: Float32Array, indices: Uint32Array): Generator<void> {
  for (let index = 0; index < posed.length; index += 3)
    markPoint(grid, posed[index], posed[index + 1], posed[index + 2]);
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
