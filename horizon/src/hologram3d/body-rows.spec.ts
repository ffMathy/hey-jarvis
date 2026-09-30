import { describe, expect, it } from 'bun:test';
import {
  BODY_STRIDE,
  createHologramScene,
  densityKey,
  densityRowsEnd,
  PARTICLE_COUNT,
  SCENE_SEED,
  STREAM_STRIDE,
  THINNED_TABLES,
} from 'hologram';
import { buildHologramRows } from './body-rows';

const scene = createHologramScene(SCENE_SEED);
const rows = buildHologramRows(scene);

function fraction(value: number) {
  return value - Math.floor(value);
}

describe('the hologram’s rows on the GPU', () => {
  it('holds every body fragment and then every stream fragment, marked by table', () => {
    expect(rows.bodyCount).toBe(PARTICLE_COUNT);
    expect(rows.streamCount).toBe(168);
    expect(rows.count).toBe(PARTICLE_COUNT + 168);
    expect(rows.rest[3]).toBe(0);
    expect(rows.rest[(rows.bodyCount - 1) * 4 + 3]).toBe(0);
    expect(rows.rest[rows.bodyCount * 4 + 3]).toBe(1);
    expect(rows.rest[(rows.count - 1) * 4 + 3]).toBe(1);
  });

  it('works out the id hashes in double precision, as the phone does', () => {
    for (const row of [0, 17, 4321, rows.bodyCount - 1]) {
      const id = scene.body[row * BODY_STRIDE + 6];
      expect(rows.hashes[row * 4]).toBeCloseTo(fraction(id * 37.9), 6);
      expect(rows.hashes[row * 4 + 1]).toBeCloseTo(fraction(id * 13.7), 6);
      expect(rows.hashes[row * 4 + 2]).toBeCloseTo(fraction(id * 3.91), 6);
      expect(rows.hashes[row * 4 + 3]).toBeCloseTo(fraction(id * 7.7113), 6);
      expect(rows.identity[row * 4]).toBeCloseTo(fraction(id * 9.7), 6);
    }
  });

  it('keeps the body’s own layout: place, direction, length, rate, reveal order and class code', () => {
    const row = 123;
    const offset = row * BODY_STRIDE;
    expect(Array.from(rows.rest.slice(row * 4, row * 4 + 3))).toEqual(
      [scene.body[offset], scene.body[offset + 1], scene.body[offset + 9]].map((value) => Math.fround(value)),
    );
    expect(Array.from(rows.shape.slice(row * 4, row * 4 + 4))).toEqual(
      [2, 3, 4, 5].map((field) => Math.fround(scene.body[offset + field])),
    );
    expect(rows.identity[row * 4 + 2]).toBe(Math.fround(scene.body[offset + 8]));
    expect(rows.identity[row * 4 + 3]).toBe(scene.body[offset + 7]);
  });

  it('packs the stream’s brightness, pool and glyph the way the body packs its own', () => {
    for (let row = 0; row < rows.streamCount; row++) {
      const offset = row * STREAM_STRIDE;
      const code = rows.identity[(rows.bodyCount + row) * 4 + 3];
      expect(Math.floor(code / 12)).toBe(scene.stream[offset + 9]);
      expect(code % 12).toBe(scene.stream[offset + 8]);
      expect(rows.hashes[(rows.bodyCount + row) * 4]).toBe(Math.fround(scene.stream[offset + 6]));
    }
  });

  it('thins exactly the rows the phone’s density share thins', () => {
    for (const density of [0.1, 0.5, 0.9]) {
      const kept = densityRowsEnd(scene.body, BODY_STRIDE, THINNED_TABLES.body.idField, density) / BODY_STRIDE;
      for (let row = 0; row < rows.bodyCount; row++) {
        expect(rows.thinning[row] < density).toBe(row < kept);
      }
    }
    expect(rows.thinning[5]).toBeCloseTo(densityKey(scene.body[5 * BODY_STRIDE + 6]), 6);
  });
});
