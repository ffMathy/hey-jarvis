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

/** Cells per metre, to multiply by rather than divide by in the loops that mark millions of points. */
const CELLS_PER_METRE = 1 / VOXEL_METRES;

/** Marks the cell holding the point x, y, z as occupied; a point outside the grid is ignored. */
export function markPoint(grid: OccupancyGrid, x: number, y: number, z: number): void {
  const cellX = Math.floor((x - grid.minX) * CELLS_PER_METRE);
  const cellY = Math.floor((y - grid.minY) * CELLS_PER_METRE);
  const cellZ = Math.floor((z - grid.minZ) * CELLS_PER_METRE);
  if (cellX < 0 || cellY < 0 || cellZ < 0 || cellX >= grid.sizeX || cellY >= grid.sizeY || cellZ >= grid.sizeZ) return;
  grid.occupied[(cellZ * grid.sizeY + cellY) * grid.sizeX + cellX] = 1;
}

/** How many cells hold something. */
export function countOccupied(grid: OccupancyGrid): number {
  const { occupied } = grid;
  let count = 0;
  // Indexed: iterating a typed array with for…of is several times slower in JavaScriptCore.
  for (let cell = 0; cell < occupied.length; cell++) count += occupied[cell];
  return count;
}

/**
 * The exact Euclidean distance transform of one line of squared distances, into `out`.
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
}

/**
 * The lines of one pass: `length` cells `stride` apart, one starting at every
 * `inner × innerStride + outer × outerStride`.
 */
interface Lines {
  length: number;
  stride: number;
  innerCount: number;
  innerStride: number;
  outerCount: number;
  outerStride: number;
}

/** Lines transformed between two yields. */
const LINES_PER_SLICE = 512;

/** Copies one line of `squared` into `line`, and returns the smallest value on it. */
function readLine(squared: Float32Array, start: number, stride: number, line: Float64Array): number {
  let nearest = FAR_SQUARED_CELLS;
  for (let cell = 0; cell < line.length; cell++) {
    const value = squared[start + cell * stride];
    line[cell] = value;
    if (value < nearest) nearest = value;
  }
  return nearest;
}

/**
 * Runs `transformLine` over every line of `squared` along one axis, yielding now and then.
 *
 * A line with nothing occupied on it, and nothing near it found by an earlier pass, is left as
 * far as it was without being transformed — which in a room is most of the first pass.
 */
function* transformAxis(squared: Float32Array, lines: Lines): Generator<void, void, void> {
  const { length, stride } = lines;
  const line = new Float64Array(length);
  const out = new Float64Array(length);
  const roots = new Int32Array(length);
  const bounds = new Float64Array(length + 1);
  let linesSinceYield = 0;
  for (let outer = 0; outer < lines.outerCount; outer++) {
    for (let inner = 0; inner < lines.innerCount; inner++) {
      const start = inner * lines.innerStride + outer * lines.outerStride;
      if (readLine(squared, start, stride, line) === FAR_SQUARED_CELLS) continue;
      transformLine(line, length, roots, bounds, out);
      for (let cell = 0; cell < length; cell++) squared[start + cell * stride] = out[cell];
    }
    linesSinceYield += lines.innerCount;
    if (linesSinceYield >= LINES_PER_SLICE) {
      linesSinceYield = 0;
      yield;
    }
  }
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
  yield* transformAxis(distance, {
    length: sizeX,
    stride: 1,
    innerCount: sizeY,
    innerStride: sizeX,
    outerCount: sizeZ,
    outerStride: plane,
  });
  yield* transformAxis(distance, {
    length: sizeY,
    stride: sizeX,
    innerCount: sizeX,
    innerStride: 1,
    outerCount: sizeZ,
    outerStride: plane,
  });
  yield* transformAxis(distance, {
    length: sizeZ,
    stride: plane,
    innerCount: sizeX,
    innerStride: 1,
    outerCount: sizeY,
    outerStride: sizeX,
  });
  for (let cell = 0; cell < distance.length; cell++) {
    const squared = distance[cell];
    distance[cell] = squared >= FAR_SQUARED_CELLS / 2 ? Number.POSITIVE_INFINITY : Math.sqrt(squared) * VOXEL_METRES;
  }
}

/** A coordinate as a position among cell centres (0 at the first centre), kept inside the grid. */
function centreCoordinate(value: number, min: number, size: number): number {
  return Math.min(Math.max((value - min) * CELLS_PER_METRE - 0.5, 0), size - 1);
}

/** The distance field at a point inside the grid, interpolated between the eight nearest cell centres. */
function interpolatedDistance(grid: OccupancyGrid, point: Vector3Like): number {
  const { sizeX, sizeY, sizeZ, distance } = grid;
  const x = centreCoordinate(point.x, grid.minX, sizeX);
  const y = centreCoordinate(point.y, grid.minY, sizeY);
  const z = centreCoordinate(point.z, grid.minZ, sizeZ);
  const lowX = Math.min(Math.floor(x), Math.max(sizeX - 2, 0));
  const lowY = Math.min(Math.floor(y), Math.max(sizeY - 2, 0));
  const lowZ = Math.min(Math.floor(z), Math.max(sizeZ - 2, 0));
  // Steps to the neighbouring centre along each axis, or none on an axis one cell thick.
  const stepX = sizeX > 1 ? 1 : 0;
  const stepY = sizeY > 1 ? sizeX : 0;
  const stepZ = sizeZ > 1 ? sizeX * sizeY : 0;
  const alongX = x - lowX;
  const alongY = y - lowY;
  const alongZ = z - lowZ;
  const near = (lowZ * sizeY + lowY) * sizeX + lowX;
  const far = near + stepZ;
  const bottomNear = distance[near] + (distance[near + stepX] - distance[near]) * alongX;
  const topNear = distance[near + stepY] + (distance[near + stepY + stepX] - distance[near + stepY]) * alongX;
  const bottomFar = distance[far] + (distance[far + stepX] - distance[far]) * alongX;
  const topFar = distance[far + stepY] + (distance[far + stepY + stepX] - distance[far + stepY]) * alongX;
  const nearValue = bottomNear + (topNear - bottomNear) * alongY;
  const farValue = bottomFar + (topFar - bottomFar) * alongY;
  return nearValue + (farValue - nearValue) * alongZ;
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

/**
 * The part of the segment from `from` along `delta` that is inside the grid, as fractions of the
 * way along it (0 at `from`, 1 at the end), or null.
 */
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
  /** How far along the segment the walk next crosses a cell boundary on this axis. */
  next: number;
  /** How far along the segment two crossings on this axis are apart. */
  every: number;
}

function startAxis(start: number, delta: number, min: number, size: number, fraction: number): AxisWalk {
  const position = (start + delta * fraction - min) / VOXEL_METRES;
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
  let fraction = enter;
  while (fraction <= exit) {
    if (grid.occupied[(z.cell * grid.sizeY + y.cell) * grid.sizeX + x.cell] === 1) return fraction;
    const axis = x.next <= y.next && x.next <= z.next ? x : y.next <= z.next ? y : z;
    fraction = axis.next;
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
