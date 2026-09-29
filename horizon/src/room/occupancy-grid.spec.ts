import { describe, expect, it } from 'bun:test';
import {
  clearanceAt,
  computeDistanceField,
  countOccupied,
  createGrid,
  firstBlockedFraction,
  markPoint,
  type OccupancyGrid,
  VOXEL_METRES,
} from './occupancy-grid';

/** A deterministic pseudo-random sequence in [0, 1), so a failure reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function finish(grid: OccupancyGrid): OccupancyGrid {
  const field = computeDistanceField(grid);
  while (field.next().done !== true) {
    // Run to the end.
  }
  return grid;
}

function centreOf(grid: OccupancyGrid, cellX: number, cellY: number, cellZ: number) {
  return {
    x: grid.minX + (cellX + 0.5) * VOXEL_METRES,
    y: grid.minY + (cellY + 0.5) * VOXEL_METRES,
    z: grid.minZ + (cellZ + 0.5) * VOXEL_METRES,
  };
}

/** A 1.3 × 0.9 × 1.1 m grid with `count` random occupied cells. */
function scatteredGrid(seed: number, count: number): OccupancyGrid {
  const next = random(seed);
  const grid = createGrid({ x: -0.6, y: 0, z: 0.2 }, { x: 0.7, y: 0.9, z: 1.3 });
  for (let index = 0; index < count; index++) {
    markPoint(grid, -0.6 + next() * 1.3, next() * 0.9, 0.2 + next() * 1.1);
  }
  return finish(grid);
}

/** Every cell of the grid as its x, y and z cell numbers and its index. */
function* cellsOf(grid: OccupancyGrid): Generator<[number, number, number, number]> {
  for (let cellZ = 0; cellZ < grid.sizeZ; cellZ++) {
    for (let cellY = 0; cellY < grid.sizeY; cellY++) {
      for (let cellX = 0; cellX < grid.sizeX; cellX++) {
        yield [cellX, cellY, cellZ, (cellZ * grid.sizeY + cellY) * grid.sizeX + cellX];
      }
    }
  }
}

describe('the distance field', () => {
  it('is the exact distance from every cell centre to the nearest occupied one', () => {
    for (const seed of [1, 2, 3]) {
      const grid = scatteredGrid(seed, 12);
      const occupied = [...cellsOf(grid)].filter(([, , , index]) => grid.occupied[index] === 1);
      for (const [cellX, cellY, cellZ, index] of cellsOf(grid)) {
        const nearest = Math.min(
          ...occupied.map(([x, y, z]) => Math.hypot(x - cellX, y - cellY, z - cellZ) * VOXEL_METRES),
        );
        expect(grid.distance[index]).toBeCloseTo(nearest, 5);
      }
    }
  });

  it('is infinite everywhere when nothing is occupied, and clearance with it', () => {
    const grid = finish(createGrid({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }));
    expect(grid.distance.every((value) => value === Number.POSITIVE_INFINITY)).toBe(true);
    expect(clearanceAt(grid, { x: 0.2, y: 0.2, z: 0.2 }, countOccupied(grid))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('clearance', () => {
  // One occupied cell in the middle of a 2 m cube, its centre at (1.05, 1.05, 1.05).
  const grid = createGrid({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
  markPoint(grid, 1.05, 1.05, 1.05);
  finish(grid);

  it('is the distance to the occupied cell, less half a cell', () => {
    expect(clearanceAt(grid, { x: 1.55, y: 1.05, z: 1.05 }, 1)).toBeCloseTo(0.45, 5);
    expect(clearanceAt(grid, { x: 1.05, y: 1.05, z: 1.05 }, 1)).toBe(0);
  });

  it('never claims more room outside the grid than there can be', () => {
    // 1 m past the grid's east face: at least that far from anything, and at least the clamped
    // point's clearance less the way out to it.
    const outside = clearanceAt(grid, { x: 3, y: 1.05, z: 1.05 }, 1);
    expect(outside).toBeGreaterThanOrEqual(0.9);
    expect(outside).toBeLessThanOrEqual(Math.hypot(3 - 1.05, 0, 0));
  });
});

describe('line of sight', () => {
  /** The first occupied cell along the segment, found by stepping 1 mm at a time. */
  function sampledFraction(grid: OccupancyGrid, from: number[], to: number[]): number {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const steps = Math.ceil(length / 0.001);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = Math.floor((from[0] + (to[0] - from[0]) * t - grid.minX) / VOXEL_METRES);
      const y = Math.floor((from[1] + (to[1] - from[1]) * t - grid.minY) / VOXEL_METRES);
      const z = Math.floor((from[2] + (to[2] - from[2]) * t - grid.minZ) / VOXEL_METRES);
      const inside = x >= 0 && y >= 0 && z >= 0 && x < grid.sizeX && y < grid.sizeY && z < grid.sizeZ;
      if (inside && grid.occupied[(z * grid.sizeY + y) * grid.sizeX + x] === 1) return t;
    }
    return Number.POSITIVE_INFINITY;
  }

  it('finds the same first occupied cell as walking the segment in tiny steps', () => {
    const next = random(7);
    const grid = scatteredGrid(11, 40);
    let blocked = 0;
    for (let trial = 0; trial < 300; trial++) {
      // Segments from outside the grid to outside it, so clipping is exercised too.
      const from = [-1 + next() * 2.5, -0.3 + next() * 1.5, -0.2 + next() * 2];
      const to = [-1 + next() * 2.5, -0.3 + next() * 1.5, -0.2 + next() * 2];
      const expected = sampledFraction(grid, from, to);
      const actual = firstBlockedFraction(
        grid,
        { x: from[0], y: from[1], z: from[2] },
        { x: to[0], y: to[1], z: to[2] },
      );
      if (expected === Number.POSITIVE_INFINITY) {
        expect(actual).toBe(Number.POSITIVE_INFINITY);
      } else {
        blocked++;
        // The walk returns where the segment enters the cell; the 1 mm steps land just inside it.
        const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        expect(actual).toBeLessThanOrEqual(expected + 1e-9);
        expect((expected - actual) * length).toBeLessThan(0.0011);
      }
    }
    // Enough of both kinds for the comparison to mean something.
    expect(blocked).toBeGreaterThan(30);
    expect(blocked).toBeLessThan(270);
  });

  it('cannot slip between the cells of a diagonal wall one cell thick', () => {
    const grid = createGrid({ x: 0, y: 0, z: 0 }, { x: 1, y: 0.1, z: 1 });
    // Cells (0,0), (1,1), (2,2)… on the floor plan: touching only at their corners.
    for (let cell = 0; cell < 10; cell++) grid.occupied[cell * grid.sizeX + cell] = 1;
    for (const offset of [0, 0.01, 0.05, 0.099]) {
      const from = { x: 0.6 + offset, y: 0.05, z: 0.05 };
      const to = { x: 0.05, y: 0.05, z: 0.6 + offset };
      expect(firstBlockedFraction(grid, from, to)).not.toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('checks every cell the segment passes through, even along the grid lines', () => {
    const grid = createGrid({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const centre = centreOf(grid, 5, 5, 5);
    grid.occupied[(5 * grid.sizeY + 5) * grid.sizeX + 5] = 1;
    expect(firstBlockedFraction(grid, { ...centre, x: 0.01 }, { ...centre, x: 0.99 })).toBeCloseTo(
      (0.5 - 0.01) / 0.98,
      9,
    );
    expect(firstBlockedFraction(grid, { ...centre, z: 0.99 }, { ...centre, z: 0.01 })).toBeCloseTo(
      (0.99 - 0.6) / 0.98,
      9,
    );
  });
});
