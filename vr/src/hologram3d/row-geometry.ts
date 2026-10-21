import { BufferAttribute, BufferGeometry } from 'three';
import type { HologramRows } from './body-rows';

/** A row's quad: its four corners at ±1, and the two triangles they make, wound as they always were. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const TRIANGLES = [0, 1, 2, 0, 2, 3];

/** How many vertices a 16-bit index can number. */
const SHORT_INDEX_VERTICES = 65536;

/** The rows' attributes, as the shaders name them (`FRAGMENT_GLSL`), and how many numbers each holds a row. */
export const ROW_ATTRIBUTES = [
  ['rest', 4],
  ['shape', 4],
  ['hashes', 4],
  ['identity', 4],
  ['thinning', 1],
] as const;

/** One row's `size` numbers of `values`, written once for each of its four corners. */
function onEveryCorner(values: Float32Array, size: number): BufferAttribute {
  const rows = values.length / size;
  const spread = new Float32Array(values.length * 4);
  for (let row = 0; row < rows; row++) {
    const value = values.subarray(row * size, (row + 1) * size);
    for (let corner = 0; corner < 4; corner++) spread.set(value, (row * 4 + corner) * size);
  }
  return new BufferAttribute(spread, size);
}

/**
 * Every row's quad in one plain indexed list, made once and drawn by every pass that reads the
 * rows: the halo union once a frame and the strokes once per eye.
 *
 * Four vertices a row, each carrying the whole row and one corner at ±1, which each draw's vertex
 * shader stretches over whatever that row is this frame, and two triangles a row, in the rows'
 * order. That is what one instance per row drew before — the same arithmetic per vertex, the same
 * triangles in the same order, so the same pixels to the byte — as one draw of 40,672 vertices
 * rather than 10,168 instances of four.
 *
 * Instancing a mesh of a handful of vertices is what the GPU makers' own guidance (Arm's for Mali,
 * Qualcomm's for the Adreno a Quest has) warns against: vertices are shaded in waves, and an
 * instance of four leaves most of each wave idle. SwiftShader showed the same at its worst: the
 * same 10,168 quads, hidden by a one-line shader, took 106 ms a draw instanced and 7.4 ms as one
 * plain list. With the real shaders, at 1024 pixels square, the halo union went from about 140 ms
 * to 38 and each eye's strokes from about 150 ms to 55, and the browser tests' emulated room, with
 * him in it, from a frame every half second to one every fifth of a second.
 *
 * The price is memory: each row's 68 bytes are held once per corner, 3 MB rather than 0.7 MB, and
 * each vertex reads its own copy. The index is 16-bit while the vertices fit one, as ten thousand
 * rows do, and 32-bit past 16,384 rows rather than wrapping round silently.
 */
export function createRowGeometry(rows: HologramRows): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, size] of ROW_ATTRIBUTES) geometry.setAttribute(name, onEveryCorner(rows[name], size));
  const corners = new Float32Array(rows.count * CORNERS.length);
  for (let row = 0; row < rows.count; row++) corners.set(CORNERS, row * CORNERS.length);
  geometry.setAttribute('corner', new BufferAttribute(corners, 2));
  const vertices = rows.count * 4;
  const indexCount = rows.count * TRIANGLES.length;
  const index = vertices <= SHORT_INDEX_VERTICES ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  for (let row = 0; row < rows.count; row++) {
    for (let corner = 0; corner < TRIANGLES.length; corner++) {
      index[row * TRIANGLES.length + corner] = row * 4 + TRIANGLES[corner];
    }
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}
