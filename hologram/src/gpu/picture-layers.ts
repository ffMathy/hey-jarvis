import {
  COMET_STRIDE,
  CORE_X,
  CORE_Y,
  CRESCENT_PIECE_STRIDE,
  CRESCENT_PIECES_PER_STRAND,
  FRAY_STRIDE,
  type HologramPictureScene,
  LIMB_STREAK_STRIDE,
  type PathBuilder,
  RING_TICK_STRIDE,
  STREAK_ARC_STRIDE,
  type StaticPaths,
  TRUSS_PIECE_STRIDE,
} from '../hologram-drawing';
import { glslFloat } from './glsl';
import { PICTURE_VERTEX_PRELUDE } from './picture-glsl';

/**
 * Every layer of the picture as a vertex shader and the table it reads: what was Skia's picture of
 * him, each layer's arithmetic — where its arcs and runs are this frame — moved from the drawing's
 * path builders into GLSL, line for line, so that a frame's JavaScript only says which layer to
 * draw with which paint.
 *
 * A layer is one quad per shape it can draw, its table the numbers each shape is made from (a row of
 * the scene's, and which part of it the shape is), laid out once when the picture is made; the
 * shader hides a shape it does not draw this frame, as a path builder skipped it. The tables come
 * from the scene, and the shaders from the drawing as it was, so the two are the same picture.
 */

/** One of a layer's per-shape numbers: its name in the shader, how many a shape has, and every shape's. */
export interface LayerAttribute {
  name: string;
  size: number;
  values: number[];
}

/** A layer as it is laid out: its vertex shader, the uniforms beyond the shared ones, and its shapes. */
export interface PictureLayerSource {
  vertexShader: string;
  uniforms: string[];
  attributes: LayerAttribute[];
  shapes: number;
}

/** The core's place, which the lines and the core are drawn round. */
const CORE_GLSL = `vec2(${glslFloat(CORE_X)}, ${glslFloat(CORE_Y)})`;

function shader(declarations: string, main: string): string {
  return `${PICTURE_VERTEX_PRELUDE}\n${declarations}\nvoid main() {\n${main}\n}\n`;
}

/** A table of `size`-number rows, one a shape, made by calling `row` for each. */
function attribute(name: string, size: number, rows: number[][]): LayerAttribute {
  return { name, size, values: rows.flat() };
}

// ---- the paths that never change -------------------------------------------------------------

/**
 * A path's runs, as one layer's shapes: where each starts and ends, and which of its ends it shares
 * with the run before or after it on its path (1 the start, 2 the end, 3 both).
 */
export interface PathSegments {
  ends: number[][];
  joins: number[][];
}

/** How finely a conic is flattened into runs: fine enough that no run is longer than a pixel or two. */
const CONIC_STEPS = 8;

/** A conic from `start` through its control point to its end, as CONIC_STEPS points after `start`. */
function conicPoints(start: number[], command: number[]): number[][] {
  const [, controlX, controlY, endX, endY, weight] = command;
  const [startX, startY] = start;
  const points: number[][] = [];
  for (let step = 1; step <= CONIC_STEPS; step++) {
    const share = step / CONIC_STEPS;
    const before = (1 - share) * (1 - share);
    const middle = 2 * weight * share * (1 - share);
    const after = share * share;
    const total = before + middle + after;
    points.push([
      (before * startX + middle * controlX + after * endX) / total,
      (before * startY + middle * controlY + after * endY) / total,
    ]);
  }
  return points;
}

/** A path's subpaths, each as the points its runs go through: a move starts one. */
function subpathsOf(builder: PathBuilder): number[][][] {
  const subpaths: number[][][] = [];
  let current: number[][] = [];
  for (let index = 0; index < builder.count; index++) {
    const command = builder.commands[index];
    const verb = command[0];
    if (verb === 0) {
      if (current.length > 1) subpaths.push(current);
      current = [[command[1], command[2]]];
    } else if (verb === 1) {
      current.push([command[1], command[2]]);
    } else if (verb === 3) {
      current.push(...conicPoints(current[current.length - 1] ?? [0, 0], command));
    }
  }
  if (current.length > 1) subpaths.push(current);
  return subpaths;
}

/** A path's commands flattened into straight runs, each knowing which of its ends are joins. */
export function flattenPath(builder: PathBuilder): PathSegments {
  const ends: number[][] = [];
  const joins: number[][] = [];
  for (const run of subpathsOf(builder)) {
    const last = run.length - 1;
    const closed = last > 1 && run[0][0] === run[last][0] && run[0][1] === run[last][1];
    for (let point = 1; point <= last; point++) {
      const hasBefore = point > 1 || closed;
      const hasAfter = point < last || closed;
      ends.push([...run[point - 1], ...run[point]]);
      joins.push([(hasBefore ? 1 : 0) + (hasAfter ? 2 : 0)]);
    }
  }
  return { ends, joins };
}

/** The static paths' names, in the order their runs are laid out. */
export const STATIC_PATH_NAMES = [
  'whorl',
  'whorlOuter',
  'whorlTicks',
  'loop',
  'edgeOn',
  'bracket',
  'dataStreaks',
  'coreRing',
  'coreBar',
  'strandFan',
] as const satisfies readonly (keyof StaticPaths)[];

export type StaticPathName = (typeof STATIC_PATH_NAMES)[number];

/** Where a path's runs are among a layer's shapes. */
export interface ShapeRange {
  first: number;
  count: number;
}

/**
 * Runs from anywhere — the static paths, and the satellites' glyphs — each its two ends and which
 * of them it shares with the runs either side. A run joins them round, as Skia's round join does and
 * indistinguishably from its mitre on curves as gentle as these, and an end that is its path's own
 * takes the paint's cap.
 */
export const SEGMENTS_VERTEX_SHADER = shader(
  `
in vec4 ends;
in float joins;
uniform float halfWidth;
uniform float roundCaps;
`,
  `
  emitRun(ends.xy, ends.zw, halfWidth, joins, roundCaps, roundCaps);
`,
);

export function staticSegmentsLayer(paths: StaticPaths): {
  layer: PictureLayerSource;
  ranges: Record<StaticPathName, ShapeRange>;
} {
  const ends: number[][] = [];
  const joins: number[][] = [];
  const ranges: Partial<Record<StaticPathName, ShapeRange>> = {};
  for (const name of STATIC_PATH_NAMES) {
    const flattened = flattenPath(paths[name]);
    ranges[name] = { first: ends.length, count: flattened.ends.length };
    ends.push(...flattened.ends);
    joins.push(...flattened.joins);
  }
  return {
    layer: {
      vertexShader: SEGMENTS_VERTEX_SHADER,
      uniforms: ['halfWidth', 'roundCaps'],
      attributes: [attribute('ends', 4, ends), attribute('joins', 1, joins)],
      shapes: ends.length,
    },
    // Every name was given a range in the loop above.
    ranges: ranges as Record<StaticPathName, ShapeRange>,
  };
}

// ---- shapes set wholly by uniforms ------------------------------------------------------------

/** The most pieces a whole circle is drawn in. */
export const ARC_PIECES = 32;

/** One arc whose every number is a uniform — the limb's bands, the thin ring, the thinking pulse, a satellite's flare. */
export function arcLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float piece;
uniform vec4 arc;
uniform vec4 arcEnds;
`,
      `
  // arc: centre, radius, half width; arcEnds: start, sweep, pieces, caps (round = 1).
  if (piece >= arcEnds.z) {
    hide();
    return;
  }
  emitArcPiece(arc.xy, arc.z, arc.w, arcEnds.x, arcEnds.y, piece, arcEnds.z, arcEnds.w, arcEnds.w);
`,
    ),
    uniforms: ['arc', 'arcEnds'],
    attributes: [
      attribute(
        'piece',
        1,
        Array.from({ length: ARC_PIECES }, (_, piece) => [piece]),
      ),
    ],
    shapes: ARC_PIECES,
  };
}

/** One disc whose centre and radius are a uniform — the core's bloom, a satellite's halo and dot. */
export function discLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float shape;
uniform vec3 disc;
`,
      `
  emitDisc(disc.xy, disc.z);
`,
    ),
    uniforms: ['disc'],
    attributes: [attribute('shape', 1, [[0]])],
    shapes: 1,
  };
}

/** One run whose ends are a uniform — the rare red segment. */
export function segmentLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float shape;
uniform vec4 segment;
uniform float halfWidth;
uniform float roundCaps;
`,
      `
  emitSegment(segment.xy, segment.zw, halfWidth, roundCaps, roundCaps);
`,
    ),
    uniforms: ['segment', 'halfWidth', 'roundCaps'],
    attributes: [attribute('shape', 1, [[0]])],
    shapes: 1,
  };
}

// ---- the lines: comets, spokes, the swoosh -----------------------------------------------------

const COMET_PIECES = 5;

/** Comet arcs from the core to the lower right, each on its own slow clock (`appendComets`). */
export function cometsLayer(scene: HologramPictureScene): PictureLayerSource {
  const comets: number[][] = [];
  const sweeps: number[][] = [];
  for (let offset = 0; offset < scene.comets.length; offset += COMET_STRIDE) {
    for (let piece = 0; piece < COMET_PIECES; piece++) {
      comets.push(scene.comets.slice(offset, offset + 4));
      sweeps.push([scene.comets[offset + 4], piece]);
    }
  }
  return {
    vertexShader: shader(
      `
in vec4 comet;
in vec2 cometSweep;
uniform float time;
uniform float halfWidth;
uniform float roundCaps;
`,
      `
  // comet: period, phase, base angle, radius; cometSweep: sweep, which piece.
  float life = fraction(time / comet.x + comet.y);
  if (life > 0.85) {
    hide();
    return;
  }
  float grow = smooth01(life / 0.15);
  float fade = 1.0 - smooth01((life - 0.7) / 0.15);
  float sweep = cometSweep.x * grow;
  float tail = cometSweep.x * (1.0 - fade);
  float base = comet.z + life * 0.35;
  float radius = comet.w;
  if (sweep - tail < 0.05) {
    hide();
    return;
  }
  vec2 centre = ${CORE_GLSL} + vec2(cos(base), sin(base)) * radius;
  emitArcPiece(centre, radius, halfWidth, base + PI + tail, sweep - tail, cometSweep.y, ${glslFloat(COMET_PIECES)}, roundCaps, roundCaps);
`,
    ),
    uniforms: ['time', 'halfWidth', 'roundCaps'],
    attributes: [attribute('comet', 4, comets), attribute('cometSweep', 2, sweeps)],
    shapes: comets.length,
  };
}

/** Faint radial spokes from the core's rim, fanning over the lower half or toward 9-10 o'clock (`appendSpokes`). */
export function spokesLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float spoke;
uniform float lineSeed;
uniform float envelope;
uniform float halfWidth;
uniform float roundCaps;
`,
      `
  bool towardNine = hashInteger(lineSeed) < 0.4;
  float clock = towardNine ? 270.0 + (spoke - 2.5) * 9.0 : 130.0 + spoke * 20.0;
  float angle = clockRadians(clock + (hashInteger(lineSeed * 7.0 + spoke) - 0.5) * 8.0);
  float reach = (0.31 + 0.4 * hashInteger(lineSeed * 13.0 + spoke)) * envelope;
  if (reach < 0.01) {
    hide();
    return;
  }
  vec2 direction = vec2(cos(angle), sin(angle));
  emitSegment(${CORE_GLSL} + direction * 0.14, ${CORE_GLSL} + direction * (0.14 + reach), halfWidth, roundCaps, roundCaps);
`,
    ),
    uniforms: ['lineSeed', 'envelope', 'halfWidth', 'roundCaps'],
    attributes: [
      attribute(
        'spoke',
        1,
        Array.from({ length: 6 }, (_, spoke) => [spoke]),
      ),
    ],
    shapes: 6,
  };
}

/** A fan of hairlines arcing over the core, rising to the right, line by line (`appendSwoosh`). */
export function swooshLayer(): PictureLayerSource {
  const lines: number[][] = [];
  for (let line = 0; line < 24; line++) for (let piece = 0; piece < 2; piece++) lines.push([line, piece]);
  return {
    vertexShader: shader(
      `
in vec2 swooshLine;
uniform float lines;
uniform float halfWidth;
`,
      `
  float line = swooshLine.x;
  if (line >= lines) {
    hide();
    return;
  }
  float tilt = -0.52;
  float radius = 1.2 + line * 0.013;
  vec2 offset = vec2(0.05, radius - 0.12 - line * 0.013);
  vec2 centre = ${CORE_GLSL} + vec2(offset.x * cos(tilt) - offset.y * sin(tilt), offset.x * sin(tilt) + offset.y * cos(tilt));
  emitArcPiece(centre, radius, halfWidth, -PI / 2.0 + tilt - 0.42, 0.84, swooshLine.y, 2.0, 0.0, 0.0);
`,
    ),
    uniforms: ['lines', 'halfWidth'],
    attributes: [attribute('swooshLine', 2, lines)],
    shapes: lines.length,
  };
}

// ---- the core -----------------------------------------------------------------------------------

/** The furry knot of spikes on the core ring's upper left, re-drawn six times a second (`drawCore`). */
export function knotLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float spike;
uniform float knotStep;
uniform float halfWidth;
uniform float roundCaps;
`,
      `
  float angle = (spike / 11.0) * TAU + hashInteger(knotStep * 11.0 + spike) * 0.6;
  float spikeLength = 0.03 + 0.05 * hashInteger(knotStep * 17.0 + spike);
  vec2 root = vec2(-0.075, -0.07);
  emitSegment(root, root + vec2(cos(angle), sin(angle)) * spikeLength, halfWidth, roundCaps, roundCaps);
`,
    ),
    uniforms: ['knotStep', 'halfWidth', 'roundCaps'],
    attributes: [
      attribute(
        'spike',
        1,
        Array.from({ length: 11 }, (_, spike) => [spike]),
      ),
    ],
    shapes: 11,
  };
}

// ---- the rim ------------------------------------------------------------------------------------

/** The parts of a truss piece, in the order they are laid out: one range a part. */
export const TRUSS_PARTS = ['outer', 'inner', 'haze', 'rung', 'detail'] as const;

export type TrussPart = (typeof TRUSS_PARTS)[number];

/** How many runs a piece's circuit trace and struts take at most. */
const TRUSS_DETAIL_RUNS = 5;

/**
 * The segmented ladder ring, in the rolling frame: each piece's outer and inner rails, the haze
 * between them, its rung, and its circuit trace and hanging struts (`appendTruss`).
 */
export function trussLayer(scene: HologramPictureScene): {
  layer: PictureLayerSource;
  ranges: Record<TrussPart, ShapeRange>;
} {
  const pieces: number[][] = [];
  const more: number[][] = [];
  const parts: number[][] = [];
  const ranges: Partial<Record<TrussPart, ShapeRange>> = {};
  TRUSS_PARTS.forEach((part, partIndex) => {
    const first = pieces.length;
    for (let offset = 0; offset < scene.truss.length; offset += TRUSS_PIECE_STRIDE) {
      const runs = part === 'detail' ? TRUSS_DETAIL_RUNS : 1;
      for (let run = 0; run < runs; run++) {
        pieces.push(scene.truss.slice(offset, offset + 4));
        more.push([scene.truss[offset + 4], scene.truss[offset + 5]]);
        parts.push([partIndex, run]);
      }
    }
    ranges[part] = { first, count: pieces.length - first };
  });
  return {
    layer: {
      vertexShader: shader(
        `
in vec4 trussPiece;
in vec2 trussMore;
in vec2 trussPart;
uniform float weight;
uniform float halfWidth;
`,
        `
  // trussPiece: start (clock degrees), sweep (degrees), trace, strut; trussMore: hash, which arc.
  float visible = clamp01((weight * 1.15 - trussMore.x * 0.55 - (trussMore.y == 2.0 ? 0.2 : 0.0)) / 0.35);
  float part = trussPart.x;
  float needs = part < 1.5 ? 0.08 : part < 3.5 ? 0.5 : 0.9;
  if (visible < 0.08 || visible < needs) {
    hide();
    return;
  }
  float start = clockRadians(trussPiece.x);
  float sweep = trussPiece.y * DEGREES * visible;
  if (part < 0.5) {
    emitArcPiece(vec2(0.0), 1.035, halfWidth, start, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  if (part < 1.5) {
    emitArcPiece(vec2(0.0), 0.935, halfWidth, start, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  if (part < 2.5) {
    emitArcPiece(vec2(0.0), 0.985, halfWidth, start, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  vec2 startDirection = vec2(cos(start), sin(start));
  if (part < 3.5) {
    emitSegment(startDirection * 0.935, startDirection * 1.035, halfWidth, 0.0, 0.0);
    return;
  }
  // The circuit trace and the struts (appendTrussDetail): a run of the trace's polyline, or a strut.
  vec2 early = vec2(cos(start + 0.045), sin(start + 0.045));
  vec2 late = vec2(cos(start + 0.11), sin(start + 0.11));
  float trace = trussPiece.z;
  float strut = trussPiece.w;
  float run = trussPart.y;
  if (run < 2.5) {
    if (trace == 1.0 && run < 0.5) emitRun(early * 0.955, early * 1.005, halfWidth, 2.0, 0.0, 0.0);
    else if (trace == 1.0 && run < 1.5) emitRun(early * 1.005, late * 1.005, halfWidth, 1.0, 0.0, 0.0);
    else if (trace == 2.0 && run < 0.5) emitRun(early * 0.95, early * 0.99, halfWidth, 2.0, 0.0, 0.0);
    else if (trace == 2.0 && run < 1.5) emitRun(early * 0.99, late * 0.99, halfWidth, 3.0, 0.0, 0.0);
    else if (trace == 2.0) emitRun(late * 0.99, late * 1.03, halfWidth, 1.0, 0.0, 0.0);
    else if (trace == 3.0 && run < 0.5) emitSegment(early * 1.02, late * 1.02, halfWidth, 0.0, 0.0);
    else if (trace == 3.0 && run < 1.5) emitSegment((early + late) * 0.4725, (early + late) * 0.5, halfWidth, 0.0, 0.0);
    else hide();
    return;
  }
  if (strut <= 0.0) {
    hide();
    return;
  }
  // A pair of struts 0.02R apart hanging from the inner rail toward the centre.
  vec2 tangent = vec2(-early.y, early.x) * (run < 3.5 ? 0.0 : 0.02);
  float inner = 0.935 - strut;
  emitSegment(early * 0.935 + tangent, early * inner + tangent, halfWidth, 0.0, 0.0);
`,
      ),
      uniforms: ['weight', 'halfWidth'],
      attributes: [
        attribute('trussPiece', 4, pieces),
        attribute('trussMore', 2, more),
        attribute('trussPart', 2, parts),
      ],
      shapes: pieces.length,
    },
    ranges: ranges as Record<TrussPart, ShapeRange>,
  };
}

/** The thin ring's ticks, rolling with the rim but showing only from 1 to 5 o'clock (`drawTruss`). */
export function ticksLayer(scene: HologramPictureScene): PictureLayerSource {
  const ticks: number[][] = [];
  for (let offset = 0; offset < scene.ringTicks.length; offset += RING_TICK_STRIDE)
    ticks.push(scene.ringTicks.slice(offset, offset + 2));
  return {
    vertexShader: shader(
      `
in vec2 tick;
uniform float roll;
uniform float halfWidth;
`,
      `
  float onScreen = fraction((tick.x + roll) / 360.0) * 360.0;
  if (onScreen < 30.0 || onScreen > 150.0) {
    hide();
    return;
  }
  float angle = clockRadians(tick.x);
  float halfTick = tick.y * 0.5 * smooth01((onScreen - 30.0) / 20.0) * smooth01((150.0 - onScreen) / 20.0);
  if (halfTick < 0.004) {
    hide();
    return;
  }
  vec2 direction = vec2(cos(angle), sin(angle));
  emitSegment(direction * (1.0 - halfTick), direction * (1.0 + halfTick), halfWidth, 0.0, 0.0);
`,
    ),
    uniforms: ['roll', 'halfWidth'],
    attributes: [attribute('tick', 2, ticks)],
    shapes: ticks.length,
  };
}

/** The crescent's width tiers, thin to core: one range a tier. */
export const CRESCENT_TIERS = 4;

/**
 * The bright crescent on the left limb: four strands of pieces rolling through a window pinned in
 * screen space, each piece drawn in every width tier whose window it falls inside.
 * A shape is one piece of one strand, tried at its angle or a turn earlier, in one tier, as one of
 * the two quads its arc is drawn in.
 */
export function crescentLayer(scene: HologramPictureScene): { layer: PictureLayerSource; tiers: ShapeRange[] } {
  const pieces: number[][] = [];
  const slots: number[][] = [];
  const tiers: ShapeRange[] = [];
  for (let tier = 0; tier < CRESCENT_TIERS; tier++) {
    const first = pieces.length;
    for (let strand = 0; strand < 4; strand++) {
      for (let piece = 0; piece < CRESCENT_PIECES_PER_STRAND; piece++) {
        const offset = (strand * CRESCENT_PIECES_PER_STRAND + piece) * CRESCENT_PIECE_STRIDE;
        for (let turn = 0; turn < 2; turn++) {
          for (let arcPiece = 0; arcPiece < 2; arcPiece++) {
            pieces.push(scene.crescentPieces.slice(offset, offset + CRESCENT_PIECE_STRIDE));
            slots.push([strand, turn, tier, arcPiece]);
          }
        }
      }
    }
    tiers.push({ first, count: pieces.length - first });
  }
  return {
    layer: {
      vertexShader: shader(
        `
in vec3 crescentPiece;
in vec4 crescentSlot;
uniform float spread;
uniform float time;
uniform float roll;
uniform vec2 shatter;
uniform float halfWidth;
`,
        `
  // crescentPiece: start (degrees), sweep (degrees), hash; crescentSlot: strand, turn, tier, arc piece.
  float strand = crescentSlot.x;
  float tier = crescentSlot.z;
  // The strand's radius calm and split, the deepest tier it reaches and the clock it is centred on.
  float calm = 0.965;
  float split = 0.94;
  float deepestTier = 2.0;
  if (strand == 1.0) {
    calm = 0.99;
    split = 1.02;
    deepestTier = 3.0;
  } else if (strand == 2.0) {
    calm = 1.012;
    split = 1.1;
    deepestTier = 1.0;
  } else if (strand == 3.0) {
    calm = 1.03;
    split = 1.19;
    deepestTier = 0.0;
  }
  if (tier > deepestTier) {
    hide();
    return;
  }
  float outerShare = strand >= 2.0 ? spread : 0.0;
  float radius = calm + spread * (split - calm);
  float strandCentre = 262.0 + 28.0 * outerShare;
  float narrowing = 1.0 - 0.4 * outerShare;
  float drift = spread * (strand < 2.0 ? 0.025 : 0.06);
  float sweep = crescentPiece.y;
  float hash = crescentPiece.z;
  float shrink = spread * sweep * (strand < 2.0 ? 0.1 + 0.45 * hash : 0.25 + 0.6 * hash) * 0.5;
  float from = crescentPiece.x + roll + shrink;
  from -= 360.0 * floor(from / 360.0);
  float span = sweep - 2.0 * shrink;
  float ragged = 14.0 * fraction(hash * 7.3 + strand * 0.37);
  float turned = from - 360.0 * crescentSlot.y;
  float halfWindow = (tier == 0.0 ? 70.0 : 72.0 - tier * 16.0) * narrowing;
  float start = max(turned, strandCentre - halfWindow + ragged);
  float end = min(turned + span, strandCentre + halfWindow - ragged);
  // shatter: how much of the strands a fresh burst knocks out, and the clock it leaves from.
  if (end - start < 0.6 || (shatter.x > hash && abs((start + end) * 0.5 - shatter.y) < 16.0)) {
    hide();
    return;
  }
  float along = drift == 0.0 ? radius : radius + drift * sin((time * 0.45 + hash) * TAU);
  emitArcPiece(vec2(0.0), along, halfWidth, clockRadians(start), (end - start) * DEGREES, crescentSlot.w, 2.0, 0.0, 0.0);
`,
      ),
      uniforms: ['spread', 'time', 'roll', 'shatter', 'halfWidth'],
      attributes: [attribute('crescentPiece', 3, pieces), attribute('crescentSlot', 4, slots)],
      shapes: pieces.length,
    },
    tiers,
  };
}

/**
 * While he talks: strands fraying off the upper-left limb, thin streak arcs further out, and
 * streaks slipping out of the right limb, each on its own clock (`drawFray`).
 */
export function frayLayer(scene: HologramPictureScene): PictureLayerSource {
  const rows: number[][] = [];
  const more: number[][] = [];
  const kinds: number[][] = [];
  for (let offset = 0; offset < scene.fray.length; offset += FRAY_STRIDE) {
    rows.push(scene.fray.slice(offset, offset + 4));
    more.push([scene.fray[offset + 4], 0]);
    kinds.push([0]);
  }
  for (let offset = 0; offset < scene.streakArcs.length; offset += STREAK_ARC_STRIDE) {
    rows.push(scene.streakArcs.slice(offset, offset + 4));
    more.push(scene.streakArcs.slice(offset + 4, offset + 6));
    kinds.push([1]);
  }
  for (let offset = 0; offset < scene.limbStreaks.length; offset += LIMB_STREAK_STRIDE) {
    rows.push(scene.limbStreaks.slice(offset, offset + 4));
    more.push([scene.limbStreaks[offset + 4], 0]);
    kinds.push([2]);
  }
  return {
    vertexShader: shader(
      `
in vec4 frayRow;
in vec2 frayMore;
in float frayKind;
uniform float drive;
uniform float time;
uniform float halfWidth;
`,
      `
  if (frayKind < 0.5) {
    // A strand: clock angle, sweep (degrees), rate, phase; frayMore.x its threshold.
    float gate = clamp01((drive - frayMore.x) * 5.0);
    float life = fraction(time * frayRow.z + frayRow.w);
    float visible = gate * (1.0 - smooth01((life - 0.55) / 0.35)) * smooth01(life / 0.1);
    if (visible < 0.08) {
      hide();
      return;
    }
    float sweep = frayRow.y * visible * DEGREES;
    float centre = clockRadians(frayRow.x);
    emitArcPiece(vec2(0.0), 1.0 + 0.17 * life, halfWidth, centre - sweep / 2.0, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  if (frayKind < 1.5) {
    // A streak arc: clock centre, radius, sweep, rate; frayMore: phase, threshold.
    float gate = clamp01((drive - frayMore.y) * 4.0);
    float life = fraction(time * frayRow.w + frayMore.x);
    float visible = gate * smooth01(life / 0.2) * (1.0 - smooth01((life - 0.65) / 0.25));
    if (visible < 0.08) {
      hide();
      return;
    }
    float sweep = frayRow.z * visible * DEGREES;
    emitArcPiece(vec2(0.0), frayRow.y, halfWidth, clockRadians(frayRow.x) - sweep / 2.0, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  // A limb streak: height, length, rate, phase; frayMore.x its threshold. Leaving the limb at about
  // 0.3 R/s, bright head first.
  float gate = clamp01((drive - frayMore.x) * 4.0);
  float life = fraction(time * frayRow.z + frayRow.w);
  float visible = gate * smooth01(life / 0.15) * (1.0 - smooth01((life - 0.6) / 0.3));
  if (visible < 0.08) {
    hide();
    return;
  }
  float y = frayRow.x;
  float head = sqrt(1.0 - y * y) * 0.96 + 0.3 * life;
  emitSegment(vec2(head - frayRow.y * visible, y), vec2(head, y), halfWidth, 0.0, 0.0);
`,
    ),
    uniforms: ['drive', 'time', 'halfWidth'],
    attributes: [attribute('frayRow', 4, rows), attribute('frayMore', 2, more), attribute('frayKind', 1, kinds)],
    shapes: rows.length,
  };
}

// ---- chip bursts ------------------------------------------------------------------------------

/** The chips' slabs, then their hot middles: one range each. */
export const CHIP_PARTS = ['slab', 'middle'] as const;

/**
 * The latest burst's chips: up to five slabs thrown off the left limb, each snapping in two as it
 * breaks up (`drawChips`, `appendBurstChip`, `appendChip`), a slab and its hot middle apiece.
 */
export function chipsLayer(): { layer: PictureLayerSource; ranges: Record<(typeof CHIP_PARTS)[number], ShapeRange> } {
  const shapes: number[][] = [];
  const ranges: Partial<Record<(typeof CHIP_PARTS)[number], ShapeRange>> = {};
  CHIP_PARTS.forEach((part, partIndex) => {
    const first = shapes.length;
    for (let chip = 0; chip < 5; chip++) for (let piece = 0; piece < 2; piece++) shapes.push([chip, piece, partIndex]);
    ranges[part] = { first, count: shapes.length - first };
  });
  return {
    layer: {
      vertexShader: shader(
        `
in vec3 chipShape;
uniform float strokeHalf;
`,
        `
  // chipShape: which chip, which of its two pieces, and whether this is its slab or its hot middle.
  vec2 middle;
  vec2 axis;
  vec2 halfSize;
  if (!chipSlab(chipShape.x, chipShape.y, chipShape.z, middle, axis, halfSize)) {
    hide();
    return;
  }
  emitBox(middle, axis, halfSize, strokeHalf);
  // Drawn as the union of the part's slabs: see chipsCoverage.
  shapeKind = 5.0;
  shapeC = vec4(chipShape, 0.0);
`,
      ),
      uniforms: ['burst', 'strokeHalf'],
      attributes: [attribute('chipShape', 3, shapes)],
      shapes: shapes.length,
    },
    ranges: ranges as Record<(typeof CHIP_PARTS)[number], ShapeRange>,
  };
}

// ---- rare accents -----------------------------------------------------------------------------

/** The jagged lightning filament, re-jagged every film frame (`drawAccents`): eight runs of one polyline. */
export function lightningLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float joint;
uniform float lineSeed;
uniform float filmFrame;
uniform float halfWidth;

// The filament's joint \`index\`, 0 its start: along it, jagged across it but for the start.
vec2 jointPoint(vec2 start, vec2 direction, vec2 normal, float filamentLength, float index) {
  float jag = index > 0.5 ? (hashInteger(filmFrame * 29.0 + index) - 0.5) * 0.07 : 0.0;
  return start + direction * (index / 8.0) * filamentLength + normal * jag;
}
`,
      `
  float anchor = clockRadians(40.0 + 70.0 * hashInteger(lineSeed * 3.0));
  vec2 direction = vec2(cos(anchor), sin(anchor));
  vec2 normal = vec2(-direction.y, direction.x);
  // it runs out toward the limb from inside and stops short of it
  vec2 start = direction * 0.42;
  float filamentLength = 0.35 + 0.3 * hashInteger(lineSeed * 5.0);
  vec2 from = jointPoint(start, direction, normal, filamentLength, joint - 1.0);
  vec2 to = jointPoint(start, direction, normal, filamentLength, joint);
  emitRun(from, to, halfWidth, (joint > 1.5 ? 1.0 : 0.0) + (joint < 7.5 ? 2.0 : 0.0), 0.0, 0.0);
`,
    ),
    uniforms: ['lineSeed', 'filmFrame', 'halfWidth'],
    attributes: [
      attribute(
        'joint',
        1,
        Array.from({ length: 8 }, (_, joint) => [joint + 1]),
      ),
    ],
    shapes: 8,
  };
}
