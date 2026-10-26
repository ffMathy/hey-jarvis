import { describe, expect, it } from 'bun:test';
import { SCENE_SEED } from '../frame-timing';
import { createHologramScene } from '../hologram-drawing';
import { buildHologramRows } from './body-rows';
import { buildRowVertices, quadsKept, ROW_ATTRIBUTES } from './row-vertices';

const rows = buildHologramRows(createHologramScene(SCENE_SEED));
const vertices = buildRowVertices(rows);

describe('the rows’ vertices', () => {
  it('are one plain indexed list: four corners and two triangles a row, a row\u2019s quad after another\u2019s by density key', () => {
    expect(rows.count).toBe(10168);
    expect(vertices.vertexCount).toBe(10168 * 4);
    expect(vertices.corner.length).toBe(10168 * 4 * 2);
    expect(vertices.index.length).toBe(10168 * 6);
    // Each row's quad wound 0-1-2 and 0-2-3, every row exactly once.
    const seen = new Set<number>();
    for (let quad = 0; quad < rows.count; quad++) {
      const first = vertices.index[quad * 6];
      expect(first % 4).toBe(0);
      expect(Array.from(vertices.index.slice(quad * 6, quad * 6 + 6))).toEqual(
        [0, 1, 2, 0, 2, 3].map((at) => first + at),
      );
      seen.add(first / 4);
    }
    expect(seen.size).toBe(rows.count);
  });

  it('put the quads a share keeps first, so a draw of the first few is the share and nothing else', () => {
    for (let quad = 0; quad < rows.count; quad++) {
      expect(vertices.keys[quad]).toBe(rows.thinning[vertices.index[quad * 6] / 4]);
      if (quad > 0) expect(vertices.keys[quad]).toBeGreaterThanOrEqual(vertices.keys[quad - 1]);
    }
    for (const density of [0, 0.025, 0.25, 0.5, 0.999, 1]) {
      const kept = quadsKept(vertices.keys, density);
      // As many as the shader shows (`thinning >= density` hides a row, in float32)...
      expect(kept).toBe(rows.thinning.filter((key) => key < Math.fround(density)).length);
      // ...and exactly those rows.
      for (let quad = 0; quad < rows.count; quad++) {
        expect(vertices.keys[quad] < Math.fround(density)).toBe(quad < kept);
      }
    }
  });

  it('carry every row attribute the shaders read, in order and at its size', () => {
    expect(vertices.attributes.map(({ name, size }) => [name, size])).toEqual(
      ROW_ATTRIBUTES.map(([name, size]) => [name, size]),
    );
  });

  it('give every corner of a row that row’s numbers, exactly, and its corner at ±1', () => {
    for (const row of [0, 1, 4321, rows.bodyCount - 1, rows.bodyCount, rows.count - 1]) {
      for (const { name, size, values } of vertices.attributes) {
        expect(values.length).toBe(rows.count * 4 * size);
        const expected = Array.from(rows[name].subarray(row * size, (row + 1) * size));
        for (let vertex = row * 4; vertex < row * 4 + 4; vertex++) {
          expect(Array.from(values.slice(vertex * size, (vertex + 1) * size))).toEqual(expected);
        }
      }
      expect(Array.from(vertices.corner.slice(row * 8, row * 8 + 8))).toEqual([-1, -1, 1, -1, 1, 1, -1, 1]);
    }
  });

  it('are numbered in 16 bits while they fit, and in 32 past that rather than wrapping round', () => {
    const rowsOf = (count: number) =>
      buildRowVertices({
        count,
        bodyCount: count,
        streamCount: 0,
        rest: new Float32Array(count * 4),
        shape: new Float32Array(count * 4),
        hashes: new Float32Array(count * 4),
        identity: new Float32Array(count * 4),
        thinning: new Float32Array(count),
      });
    expect(vertices.index).toBeInstanceOf(Uint16Array);
    const fewest = rowsOf(65536 / 4 - 1);
    expect(fewest.index).toBeInstanceOf(Uint16Array);
    expect(fewest.index.at(-1)).toBe(65531);
    // At 16,384 rows the last vertex would be 65535, which a 16-bit index in WebGL 2 is a restart.
    for (const count of [65536 / 4, 65536 / 4 + 1]) {
      const many = rowsOf(count);
      expect(many.index).toBeInstanceOf(Uint32Array);
      expect(many.index.at(-1)).toBe(count * 4 - 1);
    }
  });
});
