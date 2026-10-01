import type { PictureStats } from './preview-hook';

/** Where he is in a picture: his centre in pixels from the top left, and his drawn radius in pixels. */
export interface PictureGeometry {
  centreX: number;
  centreY: number;
  radiusPixels: number;
}

/** The annuli the look is measured over, in radii: the core, the body, and the rim with what leaves it. */
export const ANNULUS_EDGES = [0, 0.5, 0.94, 1.25] as const;

/** Cells across the grid, and how far out it reaches, in radii. */
export const GRID_SIZE = 24;
export const GRID_REACH = 1.9;

function luma(pixels: Uint8Array, index: number) {
  return 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
}

function percentile(values: number[], share: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** Which annulus a distance in radii falls in, or -1 beyond the last. */
function annulusOf(reach: number) {
  for (let annulus = 0; annulus < ANNULUS_EDGES.length - 1; annulus++) {
    if (reach < ANNULUS_EDGES[annulus + 1]) return annulus;
  }
  return -1;
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

/**
 * How bright he is where: mean luma per annulus, the 95th percentile inside the rim, a coarse
 * grid, and how much of the disc is lit at all.
 *
 * What the browser tests hold the volumetric look to: the phone's flat drawing measured the same
 * way. A look that washed out into a flat orange coin — halos stacked instead of unioned — lifts
 * the body's annulus and the percentile far past the phone's, and that is what this catches.
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
  const annuli = new Means(ANNULUS_EDGES.length - 1);
  const grid = new Means(GRID_SIZE * GRID_SIZE);
  const inside: number[] = [];
  const { centreX, centreY, radiusPixels } = geometry;
  for (let row = 0; row < height; row++) {
    const down = ((bottomUp ? height - 1 - row : row) + 0.5 - centreY) / radiusPixels;
    for (let x = 0; x < width; x++) {
      const value = luma(pixels, (row * width + x) * 4);
      const across = (x + 0.5 - centreX) / radiusPixels;
      const annulus = annulusOf(Math.hypot(across, down));
      if (annulus >= 0) {
        annuli.add(annulus, value);
        inside.push(value);
      }
      const cell = cellOf(across, down);
      if (cell >= 0) grid.add(cell, value);
    }
  }
  const [core, body, rim] = annuli.means();
  return {
    annuli: [core, body, rim],
    percentile95: percentile(inside, 0.95),
    grid: grid.means(),
    gridSize: GRID_SIZE,
    litShare: inside.length > 0 ? inside.filter((value) => value > 0).length / inside.length : 0,
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
