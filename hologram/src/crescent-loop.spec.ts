import { describe, expect, it } from 'bun:test';
import { SCENE_SEED } from './frame-timing';
import {
  analyseFrame,
  appendCrescent,
  createHologramScene,
  type HologramFrame,
  type HologramFrameState,
  type HologramScene,
  makePathBuilder,
  PARTICLE_COUNT,
  type PathBuilder,
  WATCH_PARTICLE_COUNT,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

// ---- the reference --------------------------------------------------------------------------------
//
// The crescent's loop as it was before it was written out by hand, copied line for line from
// `hologram-drawing.ts` ('worklet' directives aside), together with the private pieces it called: the
// path writer, appendArc and the small arithmetic helpers.
//
// It is frozen on purpose. The picture must not change because its loop was made faster, so a change
// to what the crescent does has to be made here and in the hand-written loop, which this spec then
// holds to it.

const MOVE_VERB = 0;
const CONIC_VERB = 3;
const DEGREES_TO_RADIANS = 0.017453292519943295;
const CRESCENT_PIECE_STRIDE = 3;
const CRESCENT_PIECES_PER_STRAND = 14;

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

function pathConicTo(builder: PathBuilder, x1: number, y1: number, x2: number, y2: number, weight: number) {
  const command = nextCommand(builder, 6);
  command[0] = CONIC_VERB;
  command[1] = x1;
  command[2] = y1;
  command[3] = x2;
  command[4] = y2;
  command[5] = weight;
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

/** Fewer commands than this over the grid, and it no longer reaches the crescent's strands. */
const COMMANDS_AT_LEAST = 10_000;

// ---- the grid ---------------------------------------------------------------------------------------

/**
 * The times every look is drawn at: the start, fractions, an hour in, times far past that, negative
 * times, which no view hands over but the drawing takes, and the times that are not numbers at all.
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

/** Every state the loop branches on, alone and together. */
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

function frameAt(time: number, look: Partial<HologramFrame>): HologramFrame {
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
  /** Command arrays the hand-written loop wrote into that were last frame's, and ones it had to make. */
  reused: number;
  made: number;
}

/** One way of building the crescent's paths, with the builders it keeps between frames. */
interface CrescentLoop {
  appendCrescent: typeof appendCrescent;
  crescent: PathBuilder[];
}

function crescentLoop(append: typeof appendCrescent): CrescentLoop {
  return { appendCrescent: append, crescent: Array.from({ length: 4 }, makePathBuilder) };
}

/**
 * One frame's crescent, built as drawCrescent builds it — into builders that pathOf has emptied and
 * that still hold last frame's arrays to be written over — and copied out.
 */
function build(loop: CrescentLoop, frame: HologramFrame, scene: HologramScene) {
  for (const builder of loop.crescent) builder.count = 0;
  const state = analyseFrame(frame, 512, scene);
  loop.appendCrescent(loop.crescent, scene.crescentPieces, state);
  return copied(loop.crescent);
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

/** Every look at every time. */
const GRID = TIMES.flatMap((time) => LOOKS.map((look) => frameAt(time, look)));

/** Builds every frame of the grid both ways, one after another into the same builders, and compares. */
function compareOver(scene: HologramScene, coverage: Coverage) {
  const reference = crescentLoop(referenceAppendCrescent);
  const written = crescentLoop(appendCrescent);
  for (const frame of GRID) {
    const before = written.crescent.map((builder) => builder.commands.slice());
    const expected = build(reference, frame, scene);
    // The frame rides along so that a failure says which one it was.
    expect({ frame, difference: firstDifference(expected, build(written, frame, scene)) }).toEqual({
      frame,
      difference: null,
    });
    noteCoverage(coverage, expected, written.crescent, before);
  }
}

describe('the hand-written crescent loop, against the loop it replaced', () => {
  const scenes = [
    { name: "the phone's scene", particleCount: PARTICLE_COUNT },
    { name: "the watch's scene", particleCount: WATCH_PARTICLE_COUNT },
  ];

  for (const { name, particleCount } of scenes) {
    it(`writes every command bit for bit as it did, in ${name}`, () => {
      const coverage: Coverage = { frames: 0, commands: 0, verbs: new Set(), notANumber: 0, reused: 0, made: 0 };
      compareOver(createHologramScene(SCENE_SEED, particleCount), coverage);

      // The grid has to have reached everything it is there to reach, or its agreement means little:
      // every verb the crescent writes — a moveTo and conics for each arc — the NaNs a time that is not
      // a number leaves in it, and both of nextCommand's ways to a command's array.
      expect(coverage.frames).toBe(GRID.length);
      expect(coverage.commands).toBeGreaterThan(COMMANDS_AT_LEAST);
      expect([...coverage.verbs].sort((first, second) => first - second)).toEqual([MOVE_VERB, CONIC_VERB]);
      expect(coverage.notANumber).toBeGreaterThan(0);
      expect(coverage.reused).toBeGreaterThan(coverage.made);
      expect(coverage.made).toBeGreaterThan(0);
    });
  }
});
