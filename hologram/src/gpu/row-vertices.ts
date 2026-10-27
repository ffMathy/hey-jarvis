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
 * The price is memory: each row's 64 bytes are held once per corner, 2.6 MB rather than 0.65 MB, and
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
  ['identity', 3],
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

// Laying the rows out runs on the JS thread at every mount, under an interpreter on a phone, where
// each number moved by JavaScript costs far more than an engine's own copy of a whole run of them.
// So the vertices are written in runs, with `copyWithin`, rather than a number at a time.

/**
 * One row's `size` numbers of `values`, written once for each of its four corners.
 *
 * The numbers are copied in all at once, packed at the front, and each row then moves its own out
 * to its first corner and doubles that twice over the next three: three copies a row, and nothing
 * made for them. It goes from the last row to the first because a row's corners start at four times
 * where its numbers lie packed, so a row writes only from there on — past the packed numbers of
 * every row still to move, which are all nearer the front — and nothing is overwritten before it
 * has been moved. A view of each row's numbers to `set` from, as this used to take, made fifty
 * thousand small objects for the scene's five attributes.
 */
function onEveryCorner(values: Float32Array, size: number): Float32Array {
  const rows = values.length / size;
  const spread = new Float32Array(values.length * 4);
  spread.set(values);
  for (let row = rows - 1; row >= 0; row--) {
    const packed = row * size;
    const firstCorner = packed * 4;
    spread.copyWithin(firstCorner, packed, packed + size);
    spread.copyWithin(firstCorner + size, firstCorner, firstCorner + size);
    spread.copyWithin(firstCorner + 2 * size, firstCorner, firstCorner + 2 * size);
  }
  return spread;
}

/** Every row's corners at ±1: the same eight numbers a row, copied in runs that double each time. */
function cornersOf(rowCount: number) {
  const corner = new Float32Array(rowCount * CORNERS.length);
  if (rowCount === 0) return corner;
  corner.set(CORNERS);
  for (let filled = CORNERS.length; filled < corner.length; filled *= 2) corner.copyWithin(filled, 0, filled);
  return corner;
}

/**
 * Where each row's quad goes in the index: in ascending order of the rows' density keys, and of the
 * rows' own order where two keys are the same — what a stable sort of the rows by key gives. The
 * keys are sorted as numbers, which an engine does natively, and each row then takes the next place
 * still free among those of its key, in the order the rows come in, which is what keeps a tie in
 * row order. A sort of the rows themselves called back into JavaScript for each of its hundred and
 * thirty thousand comparisons.
 */
function placesByKey(thinning: Float32Array) {
  const sortedKeys = thinning.slice().sort();
  // each key's first place, which becomes the next one free as rows take them
  const nextFree = new Map<number, number>();
  for (let place = sortedKeys.length - 1; place >= 0; place--) nextFree.set(sortedKeys[place], place);
  const places = new Uint32Array(thinning.length);
  for (let row = 0; row < thinning.length; row++) {
    const key = thinning[row];
    const place = nextFree.get(key);
    if (place === undefined) throw new Error(`row ${row}'s density key ${key} is not among the sorted keys`);
    places[row] = place;
    nextFree.set(key, place + 1);
  }
  return places;
}

export function buildRowVertices(rows: HologramRows): RowVertices {
  const attributes = ROW_ATTRIBUTES.map(([name, size]) => ({ name, size, values: onEveryCorner(rows[name], size) }));
  const corner = cornersOf(rows.count);
  const vertexCount = rows.count * 4;
  const indexCount = rows.count * TRIANGLES.length;
  const index = vertexCount <= SHORT_INDEX_VERTICES ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  const { thinning } = rows;
  const places = placesByKey(thinning);
  const keys = new Float32Array(rows.count);
  for (let row = 0; row < rows.count; row++) {
    const quad = places[row];
    keys[quad] = thinning[row];
    const firstIndex = quad * TRIANGLES.length;
    const firstVertex = row * 4;
    for (let at = 0; at < TRIANGLES.length; at++) index[firstIndex + at] = firstVertex + TRIANGLES[at];
  }
  return { vertexCount, attributes, corner, index, keys };
}
