import { describe, expect, it } from 'bun:test';
import { SCENE_SEED } from './frame-timing';
import {
  analyseFrame,
  appendBody,
  appendCrescent,
  appendStream,
  BODY_ID_FIELD,
  BODY_STRIDE,
  createHologramScene,
  densityRowsEnd,
  FRAGMENT_FAINTEST,
  FRAGMENT_WANDER,
  fragmentTier,
  type HologramFrame,
  type HologramFrameState,
  type HologramScene,
  LATTICE_STROKE_SHRINK,
  latticeFragment,
  makePathBuilder,
  PARTICLE_COUNT,
  type PathBuilder,
  placeFragment,
  readFragment,
  readShellFragment,
  STREAM_ID_FIELD,
  STREAM_STRIDE,
  scanned,
  swirlFragment,
  WATCH_PARTICLE_COUNT,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

// ---- the reference --------------------------------------------------------------------------------
//
// The body's, the shell's and the crescent's loops as they were before they were written out by hand,
// copied line for line from `hologram-drawing.ts` ('worklet' directives aside), together with the
// private pieces they called: the path writer, appendGlyph, appendArc and the small arithmetic helpers.
// The body and the shell are composed from the exported per-fragment helpers, exactly as they were, so
// the helpers stay the definition of what a fragment does and the loops are held to them.
//
// They are frozen on purpose. The phone's picture must not change because its loops were made faster,
// so a change to what a fragment does has to be made to its helper, which this copy follows, and to the
// hand-written loop, which this spec then holds to it.

const MOVE_VERB = 0;
const LINE_VERB = 1;
const CONIC_VERB = 3;
const CLOSE_VERB = 5;
const QUARTER_CIRCLE_WEIGHT = Math.SQRT1_2;
const DEGREES_TO_RADIANS = 0.017453292519943295;
const CRESCENT_PIECE_STRIDE = 3;
const CRESCENT_PIECES_PER_STRAND = 14;

function clamp01(value: number) {
  return value > 0 ? (value > 1 ? 1 : value) : 0;
}

function fraction(value: number) {
  return value - Math.floor(value);
}

function hashInteger(value: number) {
  let mixed = Math.imul(value | 0, 0x9e3779b1);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85ebca77);
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) / 4294967296;
}

function clockRadians(clockDegrees: number) {
  return (clockDegrees - 90) * DEGREES_TO_RADIANS;
}

function nextCommand(builder: PathBuilder, size: number): number[] {
  const existing = builder.commands[builder.count];
  if (existing !== undefined && existing.length === size) {
    builder.count++;
    return existing;
  }
  const made = new Array<number>(size);
  builder.commands[builder.count] = made;
  builder.count++;
  return made;
}

function pathMoveTo(builder: PathBuilder, x: number, y: number) {
  const command = nextCommand(builder, 3);
  command[0] = MOVE_VERB;
  command[1] = x;
  command[2] = y;
}

function pathLineTo(builder: PathBuilder, x: number, y: number) {
  const command = nextCommand(builder, 3);
  command[0] = LINE_VERB;
  command[1] = x;
  command[2] = y;
}

function pathConicTo(builder: PathBuilder, x1: number, y1: number, x2: number, y2: number, weight: number) {
  const command = nextCommand(builder, 6);
  command[0] = CONIC_VERB;
  command[1] = x1;
  command[2] = y1;
  command[3] = x2;
  command[4] = y2;
  command[5] = weight;
}

function pathClose(builder: PathBuilder) {
  const command = nextCommand(builder, 1);
  command[0] = CLOSE_VERB;
}

function pathAddCircle(builder: PathBuilder, x: number, y: number, radius: number) {
  pathMoveTo(builder, x + radius, y);
  pathConicTo(builder, x + radius, y + radius, x, y + radius, QUARTER_CIRCLE_WEIGHT);
  pathConicTo(builder, x - radius, y + radius, x - radius, y, QUARTER_CIRCLE_WEIGHT);
  pathConicTo(builder, x - radius, y - radius, x, y - radius, QUARTER_CIRCLE_WEIGHT);
  pathConicTo(builder, x + radius, y - radius, x + radius, y, QUARTER_CIRCLE_WEIGHT);
  pathClose(builder);
}

function appendArc(
  builder: PathBuilder,
  centreX: number,
  centreY: number,
  radius: number,
  startAngle: number,
  sweep: number,
) {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / 0.8));
  const step = sweep / pieces;
  const halfStep = step * 0.5;
  const weight = Math.cos(halfStep);
  pathMoveTo(builder, centreX + Math.cos(startAngle) * radius, centreY + Math.sin(startAngle) * radius);
  for (let piece = 0; piece < pieces; piece++) {
    const pieceStart = startAngle + step * piece;
    pathConicTo(
      builder,
      centreX + (Math.cos(pieceStart + halfStep) * radius) / weight,
      centreY + (Math.sin(pieceStart + halfStep) * radius) / weight,
      centreX + Math.cos(pieceStart + step) * radius,
      centreY + Math.sin(pieceStart + step) * radius,
      weight,
    );
  }
}

function appendGlyph(
  builder: PathBuilder,
  glyph: number,
  x: number,
  y: number,
  unitX: number,
  unitY: number,
  half: number,
) {
  const alongX = unitX * half;
  const alongY = unitY * half;
  if (glyph === 5) {
    pathAddCircle(builder, x, y, half * 0.45);
    return;
  }
  // the normal, shorter than the length: ticks and cell heights
  const normalX = -alongY * 0.55;
  const normalY = alongX * 0.55;
  if (glyph === 6) {
    pathMoveTo(builder, x - alongX - normalX, y - alongY - normalY);
    pathLineTo(builder, x + alongX - normalX, y + alongY - normalY);
    pathLineTo(builder, x + alongX + normalX, y + alongY + normalY);
    pathLineTo(builder, x - alongX + normalX, y - alongY + normalY);
    pathClose(builder);
    return;
  }
  if (glyph === 2 || glyph === 4) {
    pathMoveTo(builder, x - alongX + normalX, y - alongY + normalY);
    pathLineTo(builder, x - alongX, y - alongY);
    pathLineTo(builder, x + alongX, y + alongY);
    pathLineTo(
      builder,
      x + alongX + (glyph === 2 ? normalX : -normalX),
      y + alongY + (glyph === 2 ? normalY : -normalY),
    );
    return;
  }
  pathMoveTo(builder, x - alongX, y - alongY);
  pathLineTo(builder, x + alongX, y + alongY);
  if (glyph === 1) pathLineTo(builder, x + alongX + normalX, y + alongY + normalY);
  else if (glyph === 3) {
    pathMoveTo(builder, x, y);
    pathLineTo(builder, x + normalX * 1.4, y + normalY * 1.4);
  }
}

/** The fragment body, turning about the vertical axis, sorted into the dim, mid and bright builders. */
function referenceAppendBody(builders: PathBuilder[], body: number[], state: HologramFrameState) {
  const placed = state.scratch;
  const reading = state.reading;
  const end = densityRowsEnd(body, BODY_STRIDE, BODY_ID_FIELD, state.density);
  for (let offset = 0; offset < end; offset += BODY_STRIDE) {
    const strength = readFragment(body, offset, state, reading);
    if (strength <= 0) continue;
    const id = body[offset + BODY_ID_FIELD];
    const unitX = body[offset + 2];
    const unitY = body[offset + 3];
    const length = body[offset + 4];
    // each time it re-lights, it does so a little along or across from where it was
    const hop = fraction(reading[3] * 0.618034 + id * 9.7);
    const along = (hop - 0.5) * 1.4 * length;
    // while he talks the body loosens: a fragment re-lights further still from where it was.
    // The loosening fades out toward the limb: the silhouette must not move with his voice, and a
    // fragment at 0.9R that strayed a tenth of a radius outward would take it with it. Compared as
    // squares, so this costs no square root.
    const fromCentre = body[offset] * body[offset] + body[offset + 1] * body[offset + 1];
    const inward = clamp01((0.76 - fromCentre) * 3.2);
    const across = (fraction(hop * 23.17) - 0.5) * (FRAGMENT_WANDER + 1.3 * state.agitation * inward);
    placeFragment(body, offset, along, across, state, placed);
    const lit = strength * placed[3];
    if (lit < FRAGMENT_FAINTEST) continue;
    swirlFragment(placed[0], placed[1], unitX, unitY, id, state);
    const swirled = state.swirled;
    const drawn = swirled[4];
    if (drawn <= 0) continue;
    latticeFragment(swirled[0], swirled[1], id, state);
    const x = state.listened[0];
    const y = state.listened[1];
    // While he thinks, only what the plane is passing stays lit; see SCAN_SECONDS.
    const litHere = lit * scanned(y, state);
    if (litHere < FRAGMENT_FAINTEST) continue;
    const facing = placed[2] >= 0;
    // the far side of the ball is dimmer, as the turning shell below the core already is
    const plain = facing ? fragmentTier(reading[4], litHere, id, state.hotShare) : 0;
    // ...and what the plane is in the middle of is lit to the brightest tier whatever it is, which
    // is what makes the pass a line of attention rather than a moving shadow.
    const tier = state.scanBright[0] > 0 && facing ? 2 : plain;
    // Its length is its whole fade: a fragment grows out of nothing and shrinks back into it,
    // because a paint is set once for a whole tier and so cannot fade with one stroke in it.
    // Arriving at a third of its length, as it used to, meant arriving at full brightness over
    // a dozen pixels at once — with twice as many fragments that is a visible speckle at every
    // frame, and it is what the spec's script-boundary check counts.
    const gathered = 1 - LATTICE_STROKE_SHRINK * state.hearing;
    appendGlyph(
      builders[tier + reading[2]],
      reading[1],
      x,
      y,
      swirled[2],
      swirled[3],
      length * 0.5 * litHere * drawn * gathered,
    );
  }
}

/** The lower hemisphere's turning shell: its front drifts right, its back (dim) drifts left. */
function referenceAppendStream(builders: PathBuilder[], stream: number[], state: HologramFrameState) {
  const cosYaw = state.streamCos;
  const sinYaw = state.streamSin;
  const end = densityRowsEnd(stream, STREAM_STRIDE, STREAM_ID_FIELD, state.density);
  for (let offset = 0; offset < end; offset += STREAM_STRIDE) {
    const strength = readShellFragment(stream, offset, state);
    if (strength <= 0) continue;
    const restX = stream[offset];
    const restZ = stream[offset + 2];
    const x = restX * cosYaw + restZ * sinYaw;
    const depth = restZ * cosYaw - restX * sinYaw;
    const y = stream[offset + 1];
    // fade out before the limb, so nothing pops where the shell turns out of view
    const edge = clamp01((0.86 - x * x - y * y) * 8);
    const lit = strength * edge;
    if (lit < FRAGMENT_FAINTEST) continue;
    // a latitude runs horizontally on screen, foreshortened as it turns toward the limb
    const halfX = stream[offset + 3] * cosYaw + stream[offset + 4] * sinYaw;
    const plain = stream[offset + 8] - 3 * state.reading[0];
    const tier = depth < 0 ? 0 : fragmentTier(plain, lit, stream[offset + STREAM_ID_FIELD], state.hotShare);
    swirlFragment(x, y, 1, 0, stream[offset + STREAM_ID_FIELD], state);
    const swirled = state.swirled;
    if (swirled[4] <= 0) continue;
    // The shell snaps onto the lattice too, or it would go on streaming under it.
    latticeFragment(swirled[0], swirled[1], stream[offset + STREAM_ID_FIELD], state);
    appendGlyph(
      builders[tier],
      stream[offset + 9],
      state.listened[0],
      state.listened[1],
      swirled[2],
      swirled[3],
      Math.abs(halfX) * lit * swirled[4] * (1 - LATTICE_STROKE_SHRINK * state.hearing),
    );
  }
}

/**
 * Appends one crescent strand's pieces that fall inside a pinned clock window. The
 * pieces roll with the rim layer, gaps open as `gapGrowth` rises, and pieces near a
 * fresh burst's launch point are knocked out as the chips leave from there.
 */
function referenceAppendCrescentStrand(
  builder: PathBuilder,
  pieces: number[],
  strand: number,
  radius: number,
  drift: number,
  windowFrom: number,
  windowTo: number,
  state: HologramFrameState,
  shatterClock: number,
) {
  const gapGrowth = state.spread;
  const shatter = state.burstAge < 0.18 ? (1 - state.burstAge / 0.18) * (0.5 + 0.5 * state.burstStrength) : 0;
  const first = strand * CRESCENT_PIECES_PER_STRAND * CRESCENT_PIECE_STRIDE;
  for (let piece = 0; piece < CRESCENT_PIECES_PER_STRAND; piece++) {
    const offset = first + piece * CRESCENT_PIECE_STRIDE;
    const sweep = pieces[offset + 1];
    const hash = pieces[offset + 2];
    // while he talks the split strands keep streaming outward and back at about 0.1 R/s, as the
    // film's limb unravels on "Doctor." rather than holding a new shape
    const along = radius + drift * Math.sin((state.time * 0.45 + hash) * 6.283185307179586);
    const shrink = gapGrowth * sweep * (strand < 2 ? 0.1 + 0.45 * hash : 0.25 + 0.6 * hash) * 0.5;
    let from = pieces[offset] + state.roll + shrink;
    from -= 360 * Math.floor(from / 360);
    const span = sweep - 2 * shrink;
    // the window's ends are ragged and belong to the pieces rolling through them, so the
    // crescent frays out at its tips rather than stopping at a fixed angle
    const ragged = 14 * fraction(hash * 7.3 + strand * 0.37);
    // a piece can straddle 12 o'clock: try it at its angle and one turn earlier
    for (let turn = 0; turn < 2; turn++) {
      const start = Math.max(from - 360 * turn, windowFrom + ragged);
      const end = Math.min(from - 360 * turn + span, windowTo - ragged);
      if (end - start < 0.6) continue;
      if (shatter > hash && Math.abs((start + end) * 0.5 - shatterClock) < 16) continue;
      appendArc(builder, 0, 0, along, clockRadians(start), (end - start) * DEGREES_TO_RADIANS);
    }
  }
}

/** Where the latest burst's chips leave the limb, as a clock angle: the left limb about mid-height. */
function burstClock(burstCount: number) {
  return 255 + hashInteger(burstCount * 131 + 7) * 35;
}

/**
 * One crescent strand's radius, the deepest width tier it reaches and the clock angle it is
 * centred on, written into out[0..2]. Calm, the four strands lie between 0.965R and 1.03R; split,
 * they open out to 0.94-1.19R, and the outer two gather toward the upper left.
 */
function crescentStrandNumbers(strand: number, spread: number, out: number[]) {
  let calm = 0.965;
  let split = 0.94;
  let deepestTier = 2;
  if (strand === 1) {
    calm = 0.99;
    split = 1.02;
    deepestTier = 3;
  } else if (strand === 2) {
    calm = 1.012;
    split = 1.1;
    deepestTier = 1;
  } else if (strand === 3) {
    calm = 1.03;
    split = 1.19;
    deepestTier = 0;
  }
  out[0] = calm + spread * (split - calm);
  out[1] = deepestTier;
  out[2] = 262 + 28 * (strand >= 2 ? spread : 0);
}

/**
 * Builds the crescent's four strands into the width-tier builders (0 thin, 1 medium,
 * 2 wide, 3 core): the inner strands reach the wide and core tiers, the outer ones only
 * the thin and medium. Tier windows are centred on 8:40.
 */
function referenceAppendCrescent(builders: PathBuilder[], pieces: number[], state: HologramFrameState) {
  const spread = state.spread;
  const shatterClock = burstClock(state.burstCount);
  const strandNumbers = [0, 0, 0];
  for (let strand = 0; strand < 4; strand++) {
    crescentStrandNumbers(strand, spread, strandNumbers);
    const radius = strandNumbers[0];
    const deepestTier = strandNumbers[1];
    const strandCentre = strandNumbers[2];
    // the outer strands, as they split off, shorten as well as gathering toward the upper left
    const outer = strand >= 2 ? spread : 0;
    for (let tier = 0; tier <= deepestTier; tier++) {
      // 70, 56, 40 and 24 degrees of half-width, thin tier to core tier
      const tierWidth = tier === 0 ? 70 : 72 - tier * 16;
      const halfWidth = tierWidth * (1 - 0.4 * outer);
      referenceAppendCrescentStrand(
        builders[tier],
        pieces,
        strand,
        radius,
        spread * (strand < 2 ? 0.025 : 0.06),
        strandCentre - halfWidth,
        strandCentre + halfWidth,
        state,
        shatterClock,
      );
    }
  }
}

// ---- the grid ---------------------------------------------------------------------------------------

/**
 * The times every look is drawn at: the start, fractions, an hour in, the last moments the clocks are
 * floored by truncating and the first ones past it (2^29 s), times far past that, negative times, which
 * no view hands over but the helpers take, and the times that are not numbers at all.
 */
const TIMES = [
  0,
  0.37,
  6.25,
  47.9,
  3600.5,
  2 ** 29 - 0.5,
  2 ** 29 + 0.5,
  1e9 + 0.77,
  3e9,
  -3.7,
  -1234.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
];

/** Every state the loops branch on, alone and together. */
const LOOKS: Partial<HologramFrame>[] = [
  {},
  { agitation: 0.3, level: 0.4 },
  { agitation: 1, level: 0.9, bands: Array.from({ length: VOICE_BAND_COUNT }, (_, band) => (band * 0.37) % 1) },
  { agitation: 0.8, level: 0.7, burstAge: 0.05, burstStrength: 0.8, burstCount: 7 },
  { agitation: 0.8, level: 0.5, burstAge: 0.15, burstStrength: 0.3, burstCount: 12 },
  { hearing: 0.0005, hearingLevel: 0.5 },
  { hearing: 0.4, hearingLevel: 0.6 },
  { hearing: 1, hearingLevel: 0 },
  { hearing: 1, hearingLevel: 1 },
  { thinking: 0.3 },
  { thinking: 0.7 },
  { appearance: 0 },
  { appearance: 0.05 },
  { appearance: 0.3 },
  { appearance: 0.6 },
  { appearance: 0.85 },
  { appearance: 0.99 },
  { presence: 0.5 },
  { hearing: 0.7, hearingLevel: 0.4, thinking: 0.6, appearance: 0.7, agitation: 0.6 },
];

const DENSITIES = [0, 0.025, 0.4, 1];

function frameAt(time: number, density: number, look: Partial<HologramFrame>): HologramFrame {
  return {
    time,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0.2),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    density,
    presence: 1,
    thinking: 0,
    hearing: 0,
    hearingLevel: 0,
    ...look,
  };
}

/** What a set of builders holds, copied, so nothing a later frame writes over can change it. */
function copied(builders: PathBuilder[]) {
  return builders.map((builder) => builder.commands.slice(0, builder.count).map((command) => command.slice()));
}

/** Where two builders' commands first differ, with `Object.is` on every number: -0 is not 0, NaN is NaN. */
function firstDifference(expected: number[][][], actual: number[][][]) {
  for (let builder = 0; builder < expected.length; builder++) {
    if (expected[builder].length !== actual[builder].length) {
      return `builder ${builder} holds ${actual[builder].length} commands, not ${expected[builder].length}`;
    }
    for (let command = 0; command < expected[builder].length; command++) {
      const want = expected[builder][command];
      const got = actual[builder][command];
      if (want.length !== got.length) {
        return `builder ${builder}, command ${command}: [${got}] is not [${want}]`;
      }
      for (let number = 0; number < want.length; number++) {
        if (!Object.is(want[number], got[number])) {
          return `builder ${builder}, command ${command}: [${got}] is not [${want}]`;
        }
      }
    }
  }
  return null;
}

/** What the grid reached, so a grid that stopped exercising something fails loudly. */
interface Coverage {
  frames: number;
  commands: number;
  verbs: Set<number>;
  notANumber: number;
  /** Command arrays the hand-written body wrote into that were last frame's, and ones it had to make. */
  reused: number;
  made: number;
}

/** One way of building the body's and the crescent's paths, with the builders it keeps between frames. */
interface ParticleLoops {
  appendBody: typeof appendBody;
  appendStream: typeof appendStream;
  appendCrescent: typeof appendCrescent;
  body: PathBuilder[];
  crescent: PathBuilder[];
}

function particleLoops(loops: Pick<ParticleLoops, 'appendBody' | 'appendStream' | 'appendCrescent'>): ParticleLoops {
  return {
    ...loops,
    body: Array.from({ length: 6 }, makePathBuilder),
    crescent: Array.from({ length: 4 }, makePathBuilder),
  };
}

/**
 * One frame's body, shell and crescent, built as drawBody and drawCrescent build them — into builders
 * that pathOf has emptied and that still hold last frame's arrays to be written over — and copied out.
 */
function build(loops: ParticleLoops, frame: HologramFrame, scene: HologramScene) {
  for (const builder of [...loops.body, ...loops.crescent]) builder.count = 0;
  const state = analyseFrame(frame, 512, scene);
  loops.appendBody(loops.body, scene.body, state);
  loops.appendStream(loops.body, scene.stream, state);
  loops.appendCrescent(loops.crescent, scene.crescentPieces, state);
  return [...copied(loops.body), ...copied(loops.crescent)];
}

function noteCoverage(coverage: Coverage, built: number[][][], written: PathBuilder[], before: number[][][]) {
  coverage.frames++;
  for (const commands of built) {
    coverage.commands += commands.length;
    for (const command of commands) {
      coverage.verbs.add(command[0]);
      if (command.some(Number.isNaN)) coverage.notANumber++;
    }
  }
  written.forEach((builder, index) => {
    for (let command = 0; command < builder.count; command++) {
      if (builder.commands[command] === before[index][command]) coverage.reused++;
      else coverage.made++;
    }
  });
}

/** Every look at every time and density. */
const GRID = TIMES.flatMap((time) => LOOKS.flatMap((look) => DENSITIES.map((density) => frameAt(time, density, look))));

/** Builds every frame of the grid both ways, one after another into the same builders, and compares. */
function compareOver(scene: HologramScene, coverage: Coverage) {
  const reference = particleLoops({
    appendBody: referenceAppendBody,
    appendStream: referenceAppendStream,
    appendCrescent: referenceAppendCrescent,
  });
  const written = particleLoops({ appendBody, appendStream, appendCrescent });
  for (const frame of GRID) {
    const before = written.body.map((builder) => builder.commands.slice());
    const expected = build(reference, frame, scene);
    // The frame rides along so that a failure says which one it was.
    expect({ frame, difference: firstDifference(expected, build(written, frame, scene)) }).toEqual({
      frame,
      difference: null,
    });
    noteCoverage(coverage, expected, written.body, before);
  }
}

describe('the hand-written particle loops, against the loops composed from the helpers', () => {
  const scenes = [
    { name: "the phone's scene", particleCount: PARTICLE_COUNT },
    { name: "the watch's scene", particleCount: WATCH_PARTICLE_COUNT },
  ];

  for (const { name, particleCount } of scenes) {
    it(`write every command bit for bit as they did, in ${name}`, () => {
      const coverage: Coverage = { frames: 0, commands: 0, verbs: new Set(), notANumber: 0, reused: 0, made: 0 };
      compareOver(createHologramScene(SCENE_SEED, particleCount), coverage);

      // The grid has to have reached everything it is there to reach, or its agreement means little:
      // a million commands and more in either scene, every verb the loops write — moveTo and lineTo from
      // the glyphs, conics from the rings and the crescent, closes from the cells — the NaNs a time that
      // is not a number leaves in the crescent, and both of nextCommand's ways to a command's array.
      expect(coverage.frames).toBe(GRID.length);
      expect(coverage.commands).toBeGreaterThan(1_000_000);
      expect([...coverage.verbs].sort((first, second) => first - second)).toEqual([
        MOVE_VERB,
        LINE_VERB,
        CONIC_VERB,
        CLOSE_VERB,
      ]);
      expect(coverage.notANumber).toBeGreaterThan(0);
      expect(coverage.reused).toBeGreaterThan(coverage.made);
      expect(coverage.made).toBeGreaterThan(0);
    });
  }
});
