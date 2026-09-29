import type { Vector3Like } from './types';

/**
 * The room as a block of 10 cm cells, each either holding something or not, and how far every
 * cell is from the nearest one that does.
 *
 * Planes and meshes are what the headset reports, but "how much room is there around this
 * point?" and "is anything between his eyes and that point?" are questions about space, and a
 * grid answers both in constant or linear time however many triangles the room scan has. The
 * grid is built once per change of the room, off the main thread; placing him then only reads it.
 */

/** Cell size, metres. Small enough to see a table leg's worth of clutter, coarse enough to stay cheap. */
export const VOXEL_METRES = 0.1;

/**
 * Where a free cell's distance starts before the distance transform runs: far beyond any real
 * squared distance in cells (a 20 m grid is 200 cells, 40,000 squared), yet small enough that
 * adding one of those to it is still exact in a double, which the transform relies on.
 */
const FAR_SQUARED_CELLS = 1e10;

export interface OccupancyGrid {
  /** The grid's lowest corner in the reference space, metres. */
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  /** Cells along each axis. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** 1 where something is, 0 where nothing is known to be; x runs fastest, then y, then z. */
  readonly occupied: Uint8Array;
  /**
   * Metres from each cell's centre to the nearest occupied cell's centre, once
   * `computeDistanceField` has run; Infinity everywhere when no cell is occupied.
   */
  readonly distance: Float32Array;
}

/** An empty grid covering the box from `min` to `max`. */
export function createGrid(min: Vector3Like, max: Vector3Like): OccupancyGrid {
  const sizeX = Math.max(1, Math.ceil((max.x - min.x) / VOXEL_METRES));
  const sizeY = Math.max(1, Math.ceil((max.y - min.y) / VOXEL_METRES));
  const sizeZ = Math.max(1, Math.ceil((max.z - min.z) / VOXEL_METRES));
  const cells = sizeX * sizeY * sizeZ;
  return {
    minX: min.x,
    minY: min.y,
    minZ: min.z,
    sizeX,
    sizeY,
    sizeZ,
    occupied: new Uint8Array(cells),
    distance: new Float32Array(cells).fill(Number.POSITIVE_INFINITY),
  };
}

/** Marks the cell holding the point x, y, z as occupied; a point outside the grid is ignored. */
export function markPoint(grid: OccupancyGrid, x: number, y: number, z: number): void {
  const cellX = Math.floor((x - grid.minX) / VOXEL_METRES);
  const cellY = Math.floor((y - grid.minY) / VOXEL_METRES);
  const cellZ = Math.floor((z - grid.minZ) / VOXEL_METRES);
  if (cellX < 0 || cellY < 0 || cellZ < 0 || cellX >= grid.sizeX || cellY >= grid.sizeY || cellZ >= grid.sizeZ) return;
  grid.occupied[(cellZ * grid.sizeY + cellY) * grid.sizeX + cellX] = 1;
}

/** How many cells hold something. */
export function countOccupied(grid: OccupancyGrid): number {
  let count = 0;
  for (const cell of grid.occupied) count += cell;
  return count;
}

/**
 * The exact Euclidean distance transform of one line of squared distances, in place.
 *
 * Felzenszwalb and Huttenlocher's lower envelope of parabolas: each cell's squared distance is
 * the lowest of the parabolas rooted at every cell of the line. Run along x, then y, then z, it
 * gives each cell its exact squared distance, in cells, to the nearest occupied one.
 */
function transformLine(line: Float64Array, length: number, roots: Int32Array, bounds: Float64Array, out: Float64Array) {
  let top = 0;
  roots[0] = 0;
  bounds[0] = Number.NEGATIVE_INFINITY;
  bounds[1] = Number.POSITIVE_INFINITY;
  for (let cell = 1; cell < length; cell++) {
    const lifted = line[cell] + cell * cell;
    let crossing = (lifted - (line[roots[top]] + roots[top] * roots[top])) / (2 * (cell - roots[top]));
    while (crossing <= bounds[top]) {
      top--;
      crossing = (lifted - (line[roots[top]] + roots[top] * roots[top])) / (2 * (cell - roots[top]));
    }
    top++;
    roots[top] = cell;
    bounds[top] = crossing;
    bounds[top + 1] = Number.POSITIVE_INFINITY;
  }
  top = 0;
  for (let cell = 0; cell < length; cell++) {
    while (bounds[top + 1] < cell) top++;
    const offset = cell - roots[top];
    out[cell] = offset * offset + line[roots[top]];
  }
  for (let cell = 0; cell < length; cell++) line[cell] = out[cell];
}

/** Runs `transformLine` over every line of `squared` along one axis, yielding now and then. */
function* transformAxis(
  squared: Float32Array,
  length: number,
  stride: number,
  lineStarts: Generator<number>,
): Generator<void, void, void> {
  const line = new Float64Array(length);
  const out = new Float64Array(length);
  const roots = new Int32Array(length);
  const bounds = new Float64Array(length + 1);
  let linesSinceYield = 0;
  for (const start of lineStarts) {
    for (let cell = 0; cell < length; cell++) line[cell] = squared[start + cell * stride];
    transformLine(line, length, roots, bounds, out);
    for (let cell = 0; cell < length; cell++) squared[start + cell * stride] = line[cell];
    if (++linesSinceYield === 512) {
      linesSinceYield = 0;
      yield;
    }
  }
}

function* range(count: number, map: (index: number) => number): Generator<number> {
  for (let index = 0; index < count; index++) yield map(index);
}

/**
 * Fills `grid.distance` from `grid.occupied`.
 *
 * A generator so the worker can run it in slices between answering placements; run it to the
 * end in one go where nothing else needs the thread.
 */
export function* computeDistanceField(grid: OccupancyGrid): Generator<void, void, void> {
  const { sizeX, sizeY, sizeZ, occupied, distance } = grid;
  for (let cell = 0; cell < occupied.length; cell++) distance[cell] = occupied[cell] === 1 ? 0 : FAR_SQUARED_CELLS;
  const plane = sizeX * sizeY;
  yield* transformAxis(
    distance,
    sizeX,
    1,
    range(sizeY * sizeZ, (line) => line * sizeX),
  );
  yield* transformAxis(
    distance,
    sizeY,
    sizeX,
    range(sizeX * sizeZ, (line) => Math.floor(line / sizeX) * plane + (line % sizeX)),
  );
  yield* transformAxis(
    distance,
    sizeZ,
    plane,
    range(plane, (line) => line),
  );
  for (let cell = 0; cell < distance.length; cell++) {
    const squared = distance[cell];
    distance[cell] = squared >= FAR_SQUARED_CELLS / 2 ? Number.POSITIVE_INFINITY : Math.sqrt(squared) * VOXEL_METRES;
  }
}

/** The distance field at a point inside the grid, interpolated between the eight nearest cell centres. */
function interpolatedDistance(grid: OccupancyGrid, point: Vector3Like): number {
  const { sizeX, sizeY, sizeZ, distance } = grid;
  const at = (value: number, min: number, size: number) =>
    Math.min(Math.max((value - min) / VOXEL_METRES - 0.5, 0), size - 1);
  const x = at(point.x, grid.minX, sizeX);
  const y = at(point.y, grid.minY, sizeY);
  const z = at(point.z, grid.minZ, sizeZ);
  const x0 = Math.min(Math.floor(x), Math.max(sizeX - 2, 0));
  const y0 = Math.min(Math.floor(y), Math.max(sizeY - 2, 0));
  const z0 = Math.min(Math.floor(z), Math.max(sizeZ - 2, 0));
  const x1 = Math.min(x0 + 1, sizeX - 1);
  const y1 = Math.min(y0 + 1, sizeY - 1);
  const z1 = Math.min(z0 + 1, sizeZ - 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const value = (cellX: number, cellY: number, cellZ: number) => distance[(cellZ * sizeY + cellY) * sizeX + cellX];
  const lerp = (a: number, b: number, fraction: number) => a + (b - a) * fraction;
  const bottom = lerp(
    lerp(value(x0, y0, z0), value(x1, y0, z0), fx),
    lerp(value(x0, y1, z0), value(x1, y1, z0), fx),
    fy,
  );
  const top = lerp(lerp(value(x0, y0, z1), value(x1, y0, z1), fx), lerp(value(x0, y1, z1), value(x1, y1, z1), fx), fy);
  return lerp(bottom, top, fz);
}

/**
 * Free distance around `point`, metres: how far a sphere centred there could grow before it
 * touched anything the grid holds. Infinity when the grid holds nothing.
 *
 * Measured to occupied cells' centres and then brought in by half a cell, since whatever made a
 * cell occupied can be anywhere inside it — so it errs on the side of too little room. Outside
 * the grid nothing is occupied, so a point there is at least its distance to the grid away from
 * everything, and no nearer than the grid's edge allows.
 */
export function clearanceAt(grid: OccupancyGrid, point: Vector3Like, occupiedCells: number): number {
  if (occupiedCells === 0) return Number.POSITIVE_INFINITY;
  const maxX = grid.minX + grid.sizeX * VOXEL_METRES;
  const maxY = grid.minY + grid.sizeY * VOXEL_METRES;
  const maxZ = grid.minZ + grid.sizeZ * VOXEL_METRES;
  const clamped = {
    x: Math.min(Math.max(point.x, grid.minX), maxX),
    y: Math.min(Math.max(point.y, grid.minY), maxY),
    z: Math.min(Math.max(point.z, grid.minZ), maxZ),
  };
  const outside = Math.hypot(point.x - clamped.x, point.y - clamped.y, point.z - clamped.z);
  const inside = interpolatedDistance(grid, clamped);
  return Math.max(0, Math.max(outside, inside - outside) - VOXEL_METRES / 2);
}

/** The part of the segment from `from` along `delta` (t from 0 to 1) that is inside the grid, or null. */
function clipToGrid(grid: OccupancyGrid, from: Vector3Like, delta: Vector3Like): [number, number] | null {
  let enter = 0;
  let exit = 1;
  const axes: [number, number, number, number][] = [
    [from.x, delta.x, grid.minX, grid.minX + grid.sizeX * VOXEL_METRES],
    [from.y, delta.y, grid.minY, grid.minY + grid.sizeY * VOXEL_METRES],
    [from.z, delta.z, grid.minZ, grid.minZ + grid.sizeZ * VOXEL_METRES],
  ];
  for (const [start, step, min, max] of axes) {
    if (Math.abs(step) < 1e-12) {
      if (start < min || start > max) return null;
      continue;
    }
    const first = (min - start) / step;
    const second = (max - start) / step;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return enter <= exit ? [enter, exit] : null;
}

/** One axis of an Amanatides–Woo walk: which way it steps and when it next crosses a cell wall. */
interface AxisWalk {
  cell: number;
  step: number;
  /** t at which the walk next crosses a cell boundary on this axis. */
  next: number;
  /** t between two crossings on this axis. */
  every: number;
}

function startAxis(start: number, delta: number, min: number, size: number, t: number): AxisWalk {
  const position = (start + delta * t - min) / VOXEL_METRES;
  const cell = Math.min(Math.max(Math.floor(position), 0), size - 1);
  if (Math.abs(delta) < 1e-12) return { cell, step: 0, next: Number.POSITIVE_INFINITY, every: 0 };
  const step = delta > 0 ? 1 : -1;
  const boundary = min + (cell + (step > 0 ? 1 : 0)) * VOXEL_METRES;
  return { cell, step, next: (boundary - start) / delta, every: VOXEL_METRES / Math.abs(delta) };
}

/**
 * How far along the segment from `from` to `to` (0 at `from`, 1 at `to`) it first enters an
 * occupied cell, or Infinity if it never does.
 *
 * Amanatides and Woo's walk: it visits exactly the cells the segment passes through, in order,
 * one cell wall at a time — so, unlike stepping a fixed distance along the ray, it can neither
 * skip a wall one cell thick nor visit a cell twice.
 */
export function firstBlockedFraction(grid: OccupancyGrid, from: Vector3Like, to: Vector3Like): number {
  const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const span = clipToGrid(grid, from, delta);
  if (span === null) return Number.POSITIVE_INFINITY;
  const [enter, exit] = span;
  const x = startAxis(from.x, delta.x, grid.minX, grid.sizeX, enter);
  const y = startAxis(from.y, delta.y, grid.minY, grid.sizeY, enter);
  const z = startAxis(from.z, delta.z, grid.minZ, grid.sizeZ, enter);
  let t = enter;
  while (t <= exit) {
    if (grid.occupied[(z.cell * grid.sizeY + y.cell) * grid.sizeX + x.cell] === 1) return t;
    const axis = x.next <= y.next && x.next <= z.next ? x : y.next <= z.next ? y : z;
    t = axis.next;
    axis.next += axis.every;
    axis.cell += axis.step;
    if (
      x.cell < 0 ||
      y.cell < 0 ||
      z.cell < 0 ||
      x.cell >= grid.sizeX ||
      y.cell >= grid.sizeY ||
      z.cell >= grid.sizeZ
    ) {
      break;
    }
  }
  return Number.POSITIVE_INFINITY;
}
