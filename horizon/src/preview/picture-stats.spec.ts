import { describe, expect, it } from 'bun:test';
import { GRID_SIZE, gridDifference, pictureStats } from './picture-stats';

const SIZE = 101;
const CENTRE = 50.5;
const RADIUS = 40;

/** A picture lit `inner` inside half a radius, `body` out to 0.94R and `rim` out to 1.25R, top to bottom. */
function rings(inner: number, body: number, rim: number): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const reach = Math.hypot(x + 0.5 - CENTRE, y + 0.5 - CENTRE) / RADIUS;
      const level = reach < 0.5 ? inner : reach < 0.94 ? body : reach < 1.25 ? rim : 0;
      pixels.set([level, level, level, 255], (y * SIZE + x) * 4);
    }
  }
  return pixels;
}

const GEOMETRY = { centreX: CENTRE, centreY: CENTRE, radiusPixels: RADIUS };

describe('the picture’s statistics', () => {
  it('take the mean luma of each annulus about his centre', () => {
    const stats = pictureStats(rings(200, 100, 40), SIZE, SIZE, GEOMETRY, false);
    expect(stats.annuli[0]).toBeCloseTo(200, 6);
    expect(stats.annuli[1]).toBeCloseTo(100, 6);
    expect(stats.annuli[2]).toBeCloseTo(40, 6);
    expect(stats.litShare).toBe(1);
    expect(stats.radiusPixels).toBe(RADIUS);
  });

  it('weigh red, green and blue as luma does', () => {
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    for (let pixel = 0; pixel < SIZE * SIZE; pixel++) pixels.set([255, 0, 0, 255], pixel * 4);
    expect(pictureStats(pixels, SIZE, SIZE, GEOMETRY, false).annuli[0]).toBeCloseTo(0.2126 * 255, 6);
  });

  it('find the 95th percentile of what is inside the rim', () => {
    // Almost all of the disc is the body's 100; only the core's quarter-area is brighter.
    expect(pictureStats(rings(200, 100, 100), SIZE, SIZE, GEOMETRY, false).percentile95).toBe(200);
    expect(pictureStats(rings(100, 100, 100), SIZE, SIZE, GEOMETRY, false).percentile95).toBe(100);
  });

  it('read WebGL’s rows from the bottom up the right way round', () => {
    const topLit = new Uint8Array(SIZE * SIZE * 4);
    for (let x = 0; x < SIZE; x++) topLit.set([255, 255, 255, 255], (20 * SIZE + x) * 4);
    const topDown = pictureStats(topLit, SIZE, SIZE, GEOMETRY, false).grid;
    const bottomUp = pictureStats(topLit, SIZE, SIZE, GEOMETRY, true).grid;
    const litRow = (grid: number[]) => Math.floor(grid.findIndex((cell) => cell > 0) / GRID_SIZE);
    expect(litRow(topDown)).toBeLessThan(GRID_SIZE / 2);
    expect(litRow(bottomUp)).toBeGreaterThan(GRID_SIZE / 2);
  });

  it('say how differently two pictures are lit, cell by cell', () => {
    const first = pictureStats(rings(200, 100, 40), SIZE, SIZE, GEOMETRY, false).grid;
    const second = pictureStats(rings(200, 60, 40), SIZE, SIZE, GEOMETRY, false).grid;
    expect(gridDifference(first, first)).toBe(0);
    expect(gridDifference(first, second)).toBeGreaterThan(5);
    expect(gridDifference(first, second)).toBe(gridDifference(second, first));
  });
});
