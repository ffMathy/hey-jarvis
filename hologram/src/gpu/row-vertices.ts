import type { HologramRows } from './body-rows';

/**
 * Every row's quad in one plain indexed list, made once and drawn by every pass that reads the
 * rows: the halo union once a frame and the strokes once per eye (or once, on a flat screen).
 *
 * Four vertices a row, each carrying the whole row and one corner at ±1, which each draw's vertex
 * shader stretches over whatever that row is this frame, and two triangles a row, in the order of
 * the rows' density keys (`thinning`) rather than the rows' own: see {@link RowVertices.keys}. That is what one instance per row drew
 * before — the same arithmetic per vertex and the same triangles — as one draw of 40,672 vertices
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
 * rows do, and 32-bit from 16,384 rows on, rather than wrapping round silently or naming the
 * restart index.
 *
 * Plain typed arrays, so the headset's three.js geometry (`vr/src/hologram3d/row-geometry.ts`) and
 * the raw renderer (`gpu-body.ts`) upload the same bytes.
 */

/** A row's quad: its four corners at ±1, and the two triangles they make, wound as they always were. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const TRIANGLES = [0, 1, 2, 0, 2, 3];

/**
 * How many vertices a 16-bit index can number: 0 to 65534, since WebGL 2 always takes 65535 in a
 * 16-bit index as a primitive restart, not as a vertex (three's own `arrayNeedsUint32` stops there too).
 */
const SHORT_INDEX_VERTICES = 65535;

/** The rows' attributes, as the shaders name them (`FRAGMENT_GLSL`), and how many numbers each holds a row. */
export const ROW_ATTRIBUTES = [
  ['rest', 4],
  ['shape', 4],
  ['hashes', 4],
  ['identity', 4],
  ['thinning', 1],
] as const;

export type RowAttributeName = (typeof ROW_ATTRIBUTES)[number][0];

/** One of the rows' attributes as a vertex buffer holds it: the row's numbers once per corner. */
export interface RowVertexAttribute {
  name: RowAttributeName;
  /** Numbers a vertex. */
  size: number;
  values: Float32Array;
}

export interface RowVertices {
  /** Four a row. */
  vertexCount: number;
  /** Every row attribute, in ROW_ATTRIBUTES' order. */
  attributes: RowVertexAttribute[];
  /** Two numbers a vertex: its corner at ±1. */
  corner: Float32Array;
  /** Six a row, 16-bit while the vertices fit one, a row's quad after another's in ascending `keys`. */
  index: Uint16Array | Uint32Array;
  /**
   * Each quad's density key, in the index's order: ascending, so a share keeps the first quads of
   * the index and none after them (see {@link quadsKept}), and a draw of only those does the work
   * of the share rather than of the whole scene.
   *
   * **That is the watch's frame.** Every row's vertices were shaded every pass, and the shader then
   * hid the ones over the share, so at the density loop's floor — a fortieth of the rows — a frame
   * still did nearly all of the vertex work of the whole scene. Measured on SwiftShader at the
   * watch's 340 pixels: 21.3 ms a frame drawing every row at a share of 0.025, 5.4 ms drawing the
   * share's alone. The vertices stay in the rows' order, so a vertex is still its row's (the
   * headset's port check reads them back by row); only which triangles come first changes, and the
   * headset's geometry and this renderer draw the same index, so their pixels still match to the
   * byte.
   */
  keys: Float32Array;
}

/**
 * How many of the index's quads a share keeps: those whose key is under it, as the shader compares
 * them, in float32 (`thinning >= density` hides a row). A binary search over the sorted keys.
 */
export function quadsKept(keys: Float32Array, density: number): number {
  'worklet';
  const share = Math.fround(density);
  let below = 0;
  let above = keys.length;
  while (below < above) {
    const middle = (below + above) >>> 1;
    if (keys[middle] < share) below = middle + 1;
    else above = middle;
  }
  return below;
}

/** One row's `size` numbers of `values`, written once for each of its four corners. */
function onEveryCorner(values: Float32Array, size: number): Float32Array {
  const rows = values.length / size;
  const spread = new Float32Array(values.length * 4);
  for (let row = 0; row < rows; row++) {
    const value = values.subarray(row * size, (row + 1) * size);
    for (let corner = 0; corner < 4; corner++) spread.set(value, (row * 4 + corner) * size);
  }
  return spread;
}

export function buildRowVertices(rows: HologramRows): RowVertices {
  const attributes = ROW_ATTRIBUTES.map(([name, size]) => ({ name, size, values: onEveryCorner(rows[name], size) }));
  const corner = new Float32Array(rows.count * CORNERS.length);
  for (let row = 0; row < rows.count; row++) corner.set(CORNERS, row * CORNERS.length);
  const vertexCount = rows.count * 4;
  const indexCount = rows.count * TRIANGLES.length;
  const index = vertexCount <= SHORT_INDEX_VERTICES ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  // Stable, so rows with the same key keep the order they had.
  const order = Array.from({ length: rows.count }, (_, row) => row).sort(
    (first, second) => rows.thinning[first] - rows.thinning[second] || first - second,
  );
  const keys = new Float32Array(rows.count);
  for (let quad = 0; quad < order.length; quad++) {
    const row = order[quad];
    keys[quad] = rows.thinning[row];
    for (let at = 0; at < TRIANGLES.length; at++) {
      index[quad * TRIANGLES.length + at] = row * 4 + TRIANGLES[at];
    }
  }
  return { vertexCount, attributes, corner, index, keys };
}
