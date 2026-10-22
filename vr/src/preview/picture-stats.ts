import type { PictureStats } from './preview-hook';

/** Where he is in a picture: his centre in pixels from the top left, and his drawn radius in pixels. */
export interface PictureGeometry {
  centreX: number;
  centreY: number;
  radiusPixels: number;
}

/** How far out his disc is taken to reach, in radii: the rim and what leaves it. */
const DISC_REACH = 1.25;

/** Cells across the grid, and how far out it reaches, in radii. */
export const GRID_SIZE = 24;
export const GRID_REACH = 1.9;

function luma(pixels: Uint8Array, index: number) {
  return 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
}

/** Which grid cell a point in radii falls in, or -1 outside the grid. */
function cellOf(across: number, down: number) {
  const column = Math.floor(((across / GRID_REACH + 1) / 2) * GRID_SIZE);
  const row = Math.floor(((down / GRID_REACH + 1) / 2) * GRID_SIZE);
  const inside = column >= 0 && column < GRID_SIZE && row >= 0 && row < GRID_SIZE;
  return inside ? row * GRID_SIZE + column : -1;
}

/** Sums and counts, to take means of. */
class Means {
  readonly sums: number[];
  readonly counts: number[];
  constructor(size: number) {
    this.sums = new Array<number>(size).fill(0);
    this.counts = new Array<number>(size).fill(0);
  }
  add(slot: number, value: number) {
    this.sums[slot] += value;
    this.counts[slot] += 1;
  }
  means() {
    return this.sums.map((sum, slot) => (this.counts[slot] > 0 ? sum / this.counts[slot] : 0));
  }
}

/** How many of a picture's pixels are on his disc, and how many of those are lit. */
interface DiscCount {
  inside: number;
  lit: number;
}

/** Counts a pixel `across` and `down` radii from his centre toward `disc`, if it is on it. */
function countOnDisc(disc: DiscCount, value: number, across: number, down: number) {
  if (Math.hypot(across, down) >= DISC_REACH) return;
  disc.inside += 1;
  if (value > 0) disc.lit += 1;
}

/**
 * How bright he is where: a coarse grid of mean luma, which the browser tests tell the phases
 * apart by, and how much of the disc is lit at all.
 *
 * `pixels` are RGBA rows of `width`, from the bottom row up when `bottomUp`, as WebGL reads them.
 */
export function pictureStats(
  pixels: Uint8Array,
  width: number,
  height: number,
  geometry: PictureGeometry,
  bottomUp: boolean,
): PictureStats {
  const grid = new Means(GRID_SIZE * GRID_SIZE);
  const disc: DiscCount = { inside: 0, lit: 0 };
  const { centreX, centreY, radiusPixels } = geometry;
  for (let row = 0; row < height; row++) {
    const down = ((bottomUp ? height - 1 - row : row) + 0.5 - centreY) / radiusPixels;
    for (let x = 0; x < width; x++) {
      const value = luma(pixels, (row * width + x) * 4);
      const across = (x + 0.5 - centreX) / radiusPixels;
      countOnDisc(disc, value, across, down);
      const cell = cellOf(across, down);
      if (cell >= 0) grid.add(cell, value);
    }
  }
  return {
    grid: grid.means(),
    gridSize: GRID_SIZE,
    litShare: disc.inside > 0 ? disc.lit / disc.inside : 0,
    radiusPixels,
  };
}

/** Mean absolute difference between two grids of luma: how differently two pictures are lit. */
export function gridDifference(first: number[], second: number[]): number {
  let total = 0;
  for (let cell = 0; cell < first.length; cell++) {
    total += Math.abs(first[cell] - second[cell]);
  }
  return first.length > 0 ? total / first.length : 0;
}
