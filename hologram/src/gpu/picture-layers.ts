import {
  CAGE_EDGE_STRIDE,
  CORE_X,
  CORE_Y,
  EMBER_RISE,
  EMBER_STRIDE,
  FRAY_STRIDE,
  type HologramPictureScene,
  LIMB_STREAK_STRIDE,
  type PathBuilder,
  PICTURE_SHELL_EDGE,
  STREAK_ARC_STRIDE,
  type StaticPaths,
} from '../hologram-drawing';
import { glslFloat } from './glsl';
import { PICTURE_VERTEX_PRELUDE } from './picture-glsl';

/**
 * Every layer of the picture as a vertex shader and the table it reads: each layer's arithmetic —
 * where its arcs and runs are this frame, the cage turned with his body, the embers on their clocks
 * — in GLSL, so that a frame's JavaScript only says which layer to draw with which paint.
 *
 * A layer is one quad per shape it can draw, its table the numbers each shape is made from (a row of
 * the scene's, and which part of it the shape is), laid out once when the picture is made; the
 * shader hides a shape it does not draw this frame. The tables come from the scene, so the same
 * seed always draws the same picture.
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
export const STATIC_PATH_NAMES = ['coreRing', 'coreBar'] as const satisfies readonly (keyof StaticPaths)[];

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

/**
 * One arc whose every number is a uniform — the core's white-hot ring, the aura's band, the thinking
 * pulse, a satellite's flare — lit evenly, or with brighter and dimmer stretches rolling round it.
 */
export function arcLayer(): PictureLayerSource {
  return {
    vertexShader: shader(
      `
in float piece;
uniform vec4 arc;
uniform vec4 arcEnds;
uniform vec2 arcLumps;
`,
      `
  // arc: centre, radius, half width; arcEnds: start, sweep, pieces, caps (round = 1).
  if (piece >= arcEnds.z) {
    hide();
    return;
  }
  emitArcPiece(arc.xy, arc.z, arc.w, arcEnds.x, arcEnds.y, piece, arcEnds.z, arcEnds.w, arcEnds.w);
  // arcLumps: how much dimmer its dimmest stretches are than its brightest (0: lit evenly), and how
  // far round they have rolled, in radians. Worked out at each corner, so a lump is smooth along it.
  if (arcLumps.x > 0.0 && shapeKind > 0.5) {
    vec2 offset = local - arc.xy;
    float angle = atan(offset.y, offset.x) - arcLumps.y;
    shapeLight = 1.0 - arcLumps.x * (0.5 + 0.5 * sin(3.0 * angle + 0.6) * sin(2.0 * angle - 1.3));
  }
`,
    ),
    uniforms: ['arc', 'arcEnds', 'arcLumps'],
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

/** One disc whose centre and radius are a uniform — the core's glow, a satellite's halo and dot. */
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

// ---- round him: the cage and the embers --------------------------------------------------------

/**
 * How far a cage node sways about its place, in R: the film's wireframe shifts a little, and holds
 * its shape. Under a pixel at a phone's size. Twice this suited the cage's wide glowing lines, but
 * it moved the hairlines that replaced them clean off their own pixels, so the cage no longer
 * looked like itself from one moment to the next.
 */
const CAGE_SWAY = 0.006;

/**
 * How near his core, in R, the cage may pass and still be drawn at all, and over how much farther it
 * comes back to its full light: clear of the white-hot ring (`CORE_RING_RADIUS`) and its bloom.
 */
const CAGE_CORE_CLEARANCE = 0.42;
const CAGE_CORE_FADE = 0.15;

/**
 * The cage: straight hairlines between nodes round the shell of specks, in three dimensions, turned
 * with his body about the vertical (`bodyTurn`, his body's cosine and sine, as `placeFragment`
 * turns a fragment) and seen straight on. Every edge twinkles on its own slow clock and is fainter
 * towards his back, and fainter again where it lies across his face rather than round him, so the
 * cage reads as round him rather than over him. Each edge is lit at both ends (`shapeLight`), so
 * an edge running from his front to his back fades along itself, and so does one whose far end the
 * scene lights less than its near one: the lines trailing below him fade away as they leave him.
 *
 * And none of it crosses his core: an edge that passes over it, seen flat, is not drawn, and one that
 * passes near it is faint, so the white-hot ring and the haze inside it are seen clear of the cage,
 * as the film's are. Lines turning with his body across the ring, at their own rate, also hid the
 * ring's own slow roll.
 */
export function cageLayer(scene: HologramPictureScene): PictureLayerSource {
  const froms: number[][] = [];
  const tos: number[][] = [];
  const clocks: number[][] = [];
  for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
    froms.push(scene.cage.slice(offset, offset + 3));
    tos.push(scene.cage.slice(offset + 3, offset + 6));
    clocks.push(scene.cage.slice(offset + 6, offset + 10));
  }
  return {
    vertexShader: shader(
      `
in vec3 edgeFrom;
in vec3 edgeTo;
in vec4 edgeClock;
uniform vec2 bodyTurn;
uniform float time;
uniform float halfWidth;

// A node where his body's turn has taken it, swaying a little about its place by an amount that
// depends only on where it is, so the edges that share a node sway together and stay joined.
vec3 turnedNode(vec3 node) {
  vec3 sway = vec3(
    sin(time * 0.37 + node.y * 5.3 + node.z * 2.1),
    sin(time * 0.29 + node.z * 4.9 + node.x * 3.3),
    sin(time * 0.33 + node.x * 4.1 + node.y * 2.7)
  ) * ${glslFloat(CAGE_SWAY)};
  vec3 at = node + sway;
  return vec3(at.x * bodyTurn.x + at.z * bodyTurn.y, at.y, at.z * bodyTurn.x - at.x * bodyTurn.y);
}

// How lit a turned node is: fainter towards his back, and where it lies across his face.
float nodeLight(vec3 turned) {
  float front = smooth01((turned.z + 1.2) / 2.4);
  float aside = smooth01((length(turned.xy) - 0.3) / 0.55);
  return (0.6 + 0.4 * front) * (0.25 + 0.75 * aside);
}

// How near an edge, seen flat, comes to his core.
float nearestToTheCore(vec2 from, vec2 to) {
  vec2 core = vec2(${glslFloat(CORE_X)}, ${glslFloat(CORE_Y)});
  vec2 run = to - from;
  float share = clamp(dot(core - from, run) / max(dot(run, run), 1e-6), 0.0, 1.0);
  return length(from + run * share - core);
}
`,
      `
  // edgeClock: its twinkle's rate (cycles a second) and phase, the edge's weight, and how lit its
  // far end is as a share of its near one's.
  vec3 from = turnedNode(edgeFrom);
  vec3 to = turnedNode(edgeTo);
  float clearOfTheCore = smooth01((nearestToTheCore(from.xy, to.xy) - ${glslFloat(CAGE_CORE_CLEARANCE)}) / ${glslFloat(CAGE_CORE_FADE)});
  if (clearOfTheCore <= 0.0) {
    hide();
    return;
  }
  float twinkle = 0.55 + 0.45 * smooth01(0.5 + 0.5 * sin((time * edgeClock.x + edgeClock.y) * TAU));
  emitSegment(from.xy, to.xy, halfWidth, 1.0, 1.0);
  shapeLight = clearOfTheCore * edgeClock.z * twinkle * (corner.x < 0.0 ? nodeLight(from) : edgeClock.w * nodeLight(to));
`,
    ),
    uniforms: ['bodyTurn', 'time', 'halfWidth'],
    attributes: [attribute('edgeFrom', 3, froms), attribute('edgeTo', 3, tos), attribute('edgeClock', 4, clocks)],
    shapes: froms.length,
  };
}

/**
 * The embers: tiny flecks drifting out from the shell's edge and a little upward, each on its own
 * clock, fading in and out, some streaked along the way they go. `share` says which show: those
 * whose threshold is under it.
 */
export function embersLayer(scene: HologramPictureScene): PictureLayerSource {
  const paths: number[][] = [];
  const more: number[][] = [];
  for (let offset = 0; offset < scene.embers.length; offset += EMBER_STRIDE) {
    paths.push(scene.embers.slice(offset, offset + 4));
    more.push(scene.embers.slice(offset + 4, offset + 7));
  }
  return {
    vertexShader: shader(
      `
in vec4 emberPath;
in vec3 emberMore;
uniform float time;
uniform float share;
uniform float halfWidth;
`,
      `
  // emberPath: direction (radians), where it starts, how far it drifts, its period; emberMore: its
  // phase, its streak's length and its threshold.
  float gate = clamp01((share - emberMore.z) * 8.0);
  float life = fraction(time / emberPath.w + emberMore.x);
  float shown = gate * smooth01(life / 0.2) * (1.0 - smooth01((life - 0.5) / 0.45));
  if (shown < 0.01) {
    hide();
    return;
  }
  // Out from the shell, and up a little as it goes: y runs down.
  vec2 outward = vec2(cos(emberPath.x), sin(emberPath.x));
  vec2 drifting = outward + vec2(0.0, ${glslFloat(-EMBER_RISE)});
  vec2 at = outward * emberPath.y + drifting * emberPath.z * life;
  emitSegment(at - normalize(drifting) * emberMore.y, at, halfWidth, 1.0, 1.0);
  shapeLight = shown;
`,
    ),
    uniforms: ['time', 'share', 'halfWidth'],
    attributes: [attribute('emberPath', 4, paths), attribute('emberMore', 3, more)],
    shapes: paths.length,
  };
}

/**
 * While he talks: strands fraying off the upper left of the shell's edge, thin streak arcs a little
 * further out, and streaks slipping out of the right of the shell, each on its own clock
 * (`drawFray`).
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
    emitArcPiece(vec2(0.0), ${glslFloat(PICTURE_SHELL_EDGE)} + 0.17 * life, halfWidth, centre - sweep / 2.0, sweep, 0.0, 1.0, 0.0, 0.0);
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
  // A limb streak: height, length, rate, phase; frayMore.x its threshold. Leaving the shell's edge
  // at about 0.3 R/s, bright head first.
  float gate = clamp01((drive - frayMore.x) * 4.0);
  float life = fraction(time * frayRow.z + frayRow.w);
  float visible = gate * smooth01(life / 0.15) * (1.0 - smooth01((life - 0.6) / 0.3));
  if (visible < 0.08) {
    hide();
    return;
  }
  float y = frayRow.x;
  float head = sqrt(max(${glslFloat(PICTURE_SHELL_EDGE * PICTURE_SHELL_EDGE)} - y * y, 0.0)) + 0.3 * life;
  emitSegment(vec2(head - frayRow.y * visible, y), vec2(head, y), halfWidth, 0.0, 0.0);
`,
    ),
    uniforms: ['drive', 'time', 'halfWidth'],
    attributes: [attribute('frayRow', 4, rows), attribute('frayMore', 2, more), attribute('frayKind', 1, kinds)],
    shapes: rows.length,
  };
}

// ---- chip bursts ------------------------------------------------------------------------------

/** The chips' streaks whole, then their white-hot cores: one range each. */
export const CHIP_PARTS = ['streak', 'core'] as const;

/** How many chips a burst throws at most, how many shards each is, and how many pieces a shard breaks into. */
const CHIPS = 5;
const SHARDS_A_CHIP = 3;
const PIECES_A_SHARD = 2;

/** How lit a chip's streak is at its tail, as a share of its head. */
const STREAK_TAIL_LIGHT = 0.5;

/**
 * The latest burst's chips: up to five thrown off the left of the shell's edge, each a few shards of
 * light — a main streak and two splinters — streaking back from their heads the way they came, each
 * snapping in two and thinning away as it breaks up (`drawChips`, `chipShard`), a streak and its
 * white-hot core apiece. They were slabs, and then long thin plates laid along the edge, and read as
 * panels of a screen; the film's light comes off him in shards and streaks.
 */
export function chipsLayer(): { layer: PictureLayerSource; ranges: Record<(typeof CHIP_PARTS)[number], ShapeRange> } {
  const shapes: number[][] = [];
  const ranges: Partial<Record<(typeof CHIP_PARTS)[number], ShapeRange>> = {};
  CHIP_PARTS.forEach((part, partIndex) => {
    const first = shapes.length;
    for (let chip = 0; chip < CHIPS; chip++) {
      for (let shard = 0; shard < SHARDS_A_CHIP; shard++) {
        for (let piece = 0; piece < PIECES_A_SHARD; piece++) shapes.push([chip, shard, piece, partIndex]);
      }
    }
    ranges[part] = { first, count: shapes.length - first };
  });
  return {
    layer: {
      vertexShader: shader(
        `
in vec4 chipShape;
uniform float halfWidth;
`,
        `
  // chipShape: which chip, which of its shards, which of that shard's pieces, and whether this is
  // the whole streak or its white-hot core.
  vec2 tail;
  vec2 head;
  float thinning;
  float light;
  if (!chipShard(chipShape.x, chipShape.y, chipShape.z, chipShape.w, tail, head, thinning, light)) {
    hide();
    return;
  }
  emitSegment(tail, head, halfWidth * thinning, 1.0, 1.0);
  shapeLight = light * (corner.x < 0.0 ? ${glslFloat(STREAK_TAIL_LIGHT)} : 1.0);
`,
      ),
      uniforms: ['burst', 'halfWidth'],
      attributes: [attribute('chipShape', 4, shapes)],
      shapes: shapes.length,
    },
    ranges: ranges as Record<(typeof CHIP_PARTS)[number], ShapeRange>,
  };
}
