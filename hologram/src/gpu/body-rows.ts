import {
  BODY_ID_FIELD,
  BODY_STRIDE,
  densityKey,
  FRAGMENT_CODE_GLYPH_STEP,
  FRAGMENT_PHASE_FROM_ID,
  type HologramScene,
  STREAM_ID_FIELD,
  STREAM_STRIDE,
} from '../hologram-drawing';

/**
 * The body's and the stream's fragments as the GPU reads them: one row per fragment, up to four
 * numbers to an attribute, which `buildRowVertices` (`row-vertices.ts`) gives every corner of the
 * fragment's quad.
 *
 * The scene is the phone's own (`createHologramScene(SCENE_SEED)`), so the headset's Jarvis is made
 * of the same ten thousand fragments in the same places. Every per-fragment number that is a hash
 * of the fragment's id is worked out here, once, in double precision as the phone works it out,
 * rather than per vertex, per eye and per pass on the GPU: an id is a fraction, so float32 would
 * only be a millionth out, but that is a millionth that can move a fragment across the edge of
 * its blink or its tier, and the work is the same ten thousand multiplications every frame.
 *
 * Both tables go in one buffer, the body's rows first, so both are drawn with one draw; `rest.w`
 * says which table a row came from.
 */
export interface HologramRows {
  /** Rows in all: the body's, then the stream's. */
  count: number;
  bodyCount: number;
  streamCount: number;
  /**
   * Where it sits at rest, in the drawing's unit space (y down): x, y, depth, and 0 for a body row
   * or 1 for a stream row.
   */
  rest: Float32Array;
  /**
   * Body: its direction along the ring and out from his middle where it is seen (`ringDirection`),
   * its length, its clock's rate. Stream: its half-length along its latitude (x, z), unused, its rate.
   */
  shape: Float32Array;
  /**
   * Its blink phase (`fraction(id × 37.9)` for the body, the stream's own phase), and the hashes of
   * its id that decide whether it stays bright (× 13.7), when it leaves the core in the vortex
   * (× 3.91) and where it sits in a lattice point's knot (× 7.7113).
   */
  hashes: Float32Array;
  /**
   * Three numbers a row: where it re-lights (`fraction(id × 9.7)`, the body only), the id itself, and
   * its class code: brightness + 3 × pool + 6 × rides the turning shell + FRAGMENT_CODE_GLYPH_STEP ×
   * glyph — the body's own packing, which the stream's rows are given too.
   */
  identity: Float32Array;
  /** Where it sits in the density share (`densityKey`): a share keeps the rows under it. */
  thinning: Float32Array;
}

/** Fractional part, as the drawing takes it. */
function fraction(value: number) {
  return value - Math.floor(value);
}

/** Multipliers the drawing hashes an id by; see `readFragment`, `fragmentTier`, `swirlFragment`, `latticeTarget`. */
const HOT_FROM_ID = 13.7;
const VORTEX_ORDER_FROM_ID = 3.91;
const LATTICE_JITTER_FROM_ID = 7.7113;
const RELIGHT_FROM_ID = 9.7;

/** Lays the scene's body and stream out as rows. */
export function buildHologramRows(scene: HologramScene): HologramRows {
  const bodyCount = scene.body.length / BODY_STRIDE;
  const streamCount = scene.stream.length / STREAM_STRIDE;
  const count = bodyCount + streamCount;
  const rows: HologramRows = {
    count,
    bodyCount,
    streamCount,
    rest: new Float32Array(count * 4),
    shape: new Float32Array(count * 4),
    hashes: new Float32Array(count * 4),
    identity: new Float32Array(count * 3),
    thinning: new Float32Array(count),
  };
  for (let row = 0; row < bodyCount; row++) {
    writeBodyRow(rows, row, scene.body, row * BODY_STRIDE);
  }
  for (let row = 0; row < streamCount; row++) {
    writeStreamRow(rows, bodyCount + row, scene.stream, row * STREAM_STRIDE);
  }
  return rows;
}

// The rows are written a number at a time rather than `set` from a literal of each attribute's
// numbers: that made five arrays a row, fifty thousand of them for the scene, on the JS thread.

function writeBodyRow(rows: HologramRows, row: number, body: number[], offset: number) {
  const { rest, shape, hashes, identity } = rows;
  const id = body[offset + BODY_ID_FIELD];
  const at = row * 4;
  rest[at] = body[offset];
  rest[at + 1] = body[offset + 1];
  rest[at + 2] = body[offset + 8];
  rest[at + 3] = 0;
  shape[at] = body[offset + 2];
  shape[at + 1] = body[offset + 3];
  shape[at + 2] = body[offset + 4];
  shape[at + 3] = body[offset + 5];
  hashes[at] = fraction(id * FRAGMENT_PHASE_FROM_ID);
  writeIdHashes(hashes, at, id);
  identity[row * 3] = fraction(id * RELIGHT_FROM_ID);
  identity[row * 3 + 1] = id;
  identity[row * 3 + 2] = body[offset + 7];
  rows.thinning[row] = densityKey(id);
}

function writeStreamRow(rows: HologramRows, row: number, stream: number[], offset: number) {
  const { rest, shape, hashes, identity } = rows;
  const id = stream[offset + STREAM_ID_FIELD];
  const at = row * 4;
  rest[at] = stream[offset];
  rest[at + 1] = stream[offset + 1];
  rest[at + 2] = stream[offset + 2];
  rest[at + 3] = 1;
  shape[at] = stream[offset + 3];
  shape[at + 1] = stream[offset + 4];
  shape[at + 2] = 0;
  shape[at + 3] = stream[offset + 5];
  hashes[at] = stream[offset + 6];
  writeIdHashes(hashes, at, id);
  identity[row * 3] = 0;
  identity[row * 3 + 1] = id;
  // The stream's brightness and pool are packed as the body's are, with its glyph beside them.
  identity[row * 3 + 2] = stream[offset + 8] + FRAGMENT_CODE_GLYPH_STEP * stream[offset + 9];
  rows.thinning[row] = densityKey(id);
}

/** The hashes of a row's id that both tables share, after its blink phase in `hashes`. */
function writeIdHashes(hashes: Float32Array, at: number, id: number) {
  hashes[at + 1] = fraction(id * HOT_FROM_ID);
  hashes[at + 2] = fraction(id * VORTEX_ORDER_FROM_ID);
  hashes[at + 3] = fraction(id * LATTICE_JITTER_FROM_ID);
}
