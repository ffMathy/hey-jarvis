import { describe, expect, it } from 'bun:test';
import {
  buildCageNet,
  CASCADE_BOX_FLARE_SECONDS,
  CASCADE_BOX_NUMBERS,
  CASCADE_BOX_SLOTS,
  CASCADE_BOXES_AT,
  CASCADE_DEEPEST,
  CASCADE_EDGE_NUMBERS,
  CASCADE_EDGE_SLOTS,
  CASCADE_EDGES,
  CASCADE_FADE_SECONDS,
  CASCADE_FEWEST_RETURN_EDGES,
  CASCADE_FOOT_INNER,
  CASCADE_FOOT_OUTER,
  CASCADE_HOP_SECONDS,
  CASCADE_LATEST_FIRE,
  CASCADE_LIMB,
  CASCADE_LONGEST_SECONDS,
  CASCADE_NUMBERS,
  CASCADE_PERIOD,
  CASCADE_SPOKE,
  CASCADE_SPOKE_REACH,
  type CageNet,
  type CascadeFrame,
  cascadeScratchSize,
  writeCageCascade,
} from './cage-cascade';
import { SCENE_SEED } from './frame-timing';
import {
  analyseFrame,
  BODY_RADIANS_PER_SECOND,
  bodyTurnedX,
  bodyTurnedZ,
  bodyTurnRadians,
  CAGE_EDGE_STRIDE,
  cageSwayOf,
  createHologramScene,
  type HologramFrame,
  RIM_ROLL_DEGREES_PER_SECOND,
  TRUSS_ARCS,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * The cage's cascades, worked out from frames of him as `analyseFrame` makes them, and judged frame
 * by frame where the picture draws them: each lit edge's nodes turned with his body and swayed as
 * the picture's shader turns and sways them (`turnedNode`, from `CAGE_SWAY_WAVES` by `cageSwayOf`,
 * and by his body's turn, `bodyTurnedX` and `bodyTurnedZ`).
 */

const scene = createHologramScene(SCENE_SEED);
const net = buildCageNet(scene.cage);
const SLOTS = CASCADE_EDGE_SLOTS;
const FRAME = 1 / 60;

/** A frame of him at `time`: here, formed, and quiet unless told otherwise. */
function frameAt(time: number, overrides: Partial<HologramFrame> = {}): HologramFrame {
  return {
    time,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    talk: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    presence: 1,
    thinking: 0,
    ...overrides,
  };
}

const BUSY: Partial<HologramFrame> = { talk: 1, agitation: 1, speaking: true, level: 0.5 };

function stateAt(time: number, overrides: Partial<HologramFrame> = {}): CascadeFrame {
  return analyseFrame(frameAt(time, overrides), 1);
}

function freshScratch(cage: CageNet) {
  return new Array(cascadeScratchSize(cage)).fill(0);
}

function freshOut() {
  return new Float32Array(CASCADE_NUMBERS);
}

/** The lit edges of a frame: each as its numbers. */
function litEdges(out: Float32Array) {
  const edges: number[][] = [];
  for (let edge = 0; edge < CASCADE_EDGES; edge++) {
    const at = edge * CASCADE_EDGE_NUMBERS;
    if ((out[at + SLOTS.light] ?? 0) > 0) edges.push(Array.from(out.slice(at, at + CASCADE_EDGE_NUMBERS)));
  }
  return edges;
}

/** A lit box of a frame (0 the one fired from, 1 the one landed on), as its numbers, or undefined. */
function litBox(out: Float32Array, box: number) {
  const numbers = Array.from(
    out.slice(CASCADE_BOXES_AT + box * CASCADE_BOX_NUMBERS, CASCADE_BOXES_AT + (box + 1) * CASCADE_BOX_NUMBERS),
  );
  return (numbers[CASCADE_BOX_SLOTS.light] ?? 0) > 0 ? numbers : undefined;
}

/** A lit edge's from node (0) or to node (1) at rest. */
function endOf(edge: number[], end: number) {
  const at = end === 0 ? SLOTS.from : SLOTS.to;
  return edge.slice(at, at + 3);
}

function keyOf(node: number[]) {
  return node.join(',');
}

/** Each lit edge's numbers' end keys ({@link endKeyOf}), made once for each array a frame hands over. */
const endKeys = new WeakMap<number[], readonly [string, string]>();

/** A lit edge's from node's (0) or to node's (1) key at rest. */
function endKeyOf(edge: number[], end: number) {
  let keys = endKeys.get(edge);
  if (!keys) {
    keys = [keyOf(endOf(edge, 0)), keyOf(endOf(edge, 1))];
    endKeys.set(edge, keys);
  }
  return keys[end] ?? '';
}

/** How far round his body has turned at `time`, as the cosine and sine the picture's shader turns a node by. */
function bodyTurnAt(time: number) {
  const turn = bodyTurnRadians(time);
  return { cos: Math.cos(turn), sin: Math.sin(turn) };
}

/**
 * Where a node at rest is seen at `time`: swayed, then turned with his body, as the picture's shader
 * does; `turn` is his body's then ({@link bodyTurnAt}), for a frame that sees many nodes to work out once.
 */
function seenAt(node: number[], time: number, { cos, sin } = bodyTurnAt(time)) {
  const [x = 0, y = 0, z = 0] = node;
  const swayedX = x + cageSwayOf(0, x, y, z, time);
  const swayedY = y + cageSwayOf(1, x, y, z, time);
  const swayedZ = z + cageSwayOf(2, x, y, z, time);
  return { x: bodyTurnedX(swayedX, swayedZ, cos, sin), y: swayedY, z: bodyTurnedZ(swayedX, swayedZ, cos, sin) };
}

/** Whether an edge seen from one point to another is a spoke, by the plan's own thresholds. */
function isSpoke(from: { x: number; y: number }, to: { x: number; y: number }) {
  const runX = to.x - from.x;
  const runY = to.y - from.y;
  const middleX = (from.x + to.x) / 2;
  const middleY = (from.y + to.y) / 2;
  const outward = Math.abs(runX * middleX + runY * middleY) / (Math.hypot(runX, runY) * Math.hypot(middleX, middleY));
  return outward > CASCADE_SPOKE && Math.max(Math.hypot(from.x, from.y), Math.hypot(to.x, to.y)) > CASCADE_SPOKE_REACH;
}

/** Whether a node seen at `seen` is over the truss's box `first`, `sweep` wide, at `time`, by the plan's own feet. */
function overBox(seen: { x: number; y: number; z: number }, first: number, sweep: number, time: number) {
  const reach = Math.hypot(seen.x, seen.y);
  const clock =
    ((((Math.atan2(seen.x, -seen.y) * 180) / Math.PI - time * RIM_ROLL_DEGREES_PER_SECOND) % 360) + 360) % 360;
  return (
    reach >= CASCADE_FOOT_INNER &&
    reach <= CASCADE_FOOT_OUTER &&
    seen.z >= CASCADE_DEEPEST &&
    clock >= first - 1e-6 &&
    clock <= first + sweep + 1e-6
  );
}

/** A box of the truss: the first degree of one of its stretches' boxes, and that box's width. */
function isBox(first: number, sweep: number) {
  return TRUSS_ARCS.some(([from, stretch, count]) => {
    const step = stretch / count;
    const place = (first - from) / step;
    return (
      Math.abs(sweep - step) < 1e-4 && place > -1e-4 && place < count && Math.abs(place - Math.round(place)) < 1e-4
    );
  });
}

/** One chance, frame by frame over its period: what each frame lit, its time among them. */
interface ChanceFrames {
  chance: number;
  frames: { time: number; edges: number[][]; boxes: (number[] | undefined)[] }[];
  /** Every edge it lit at any frame, as its numbers, once each. */
  edges: number[][];
  /** Those edges split into the pulse out and the return ({@link pulsesOf}). */
  out: number[][];
  back: number[][];
}

/**
 * A chance's edges split into its pulse out — the first to leave, and every edge joined to it through
 * the nodes they share — and its return, which never touches a node the pulse out reached.
 */
function pulsesOf(edges: number[][]) {
  const fires = Math.min(...edges.map((edge) => edge[SLOTS.leaves] ?? 0));
  const reached = new Set(edges.filter((edge) => edge[SLOTS.leaves] === fires).map((edge) => endKeyOf(edge, 0)));
  const out = new Set<number[]>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const edge of edges) {
      const ends = [endKeyOf(edge, 0), endKeyOf(edge, 1)];
      if (out.has(edge) || !ends.some((end) => reached.has(end))) continue;
      out.add(edge);
      for (const end of ends) reached.add(end);
      grew = true;
    }
  }
  return { out: edges.filter((edge) => out.has(edge)), back: edges.filter((edge) => !out.has(edge)) };
}

/**
 * `out`'s `count` numbers from `at`, as `kept` itself when it holds them already: a chance's edges and
 * boxes are handed over frame after frame in the same numbers, so a chance read at every frame makes
 * an array for each only when they change, and an edge's arrays tell it apart without a key.
 */
function numbersAt(out: Float32Array, at: number, count: number, kept: number[] | undefined) {
  if (kept?.length === count) {
    let same = true;
    for (let place = 0; place < count && same; place++) same = kept[place] === out[at + place];
    if (same) return kept;
  }
  return Array.from(out.subarray(at, at + count));
}

function chanceFrames(
  chance: number,
  overrides: Partial<HologramFrame>,
  scratch = freshScratch(net),
  frame = FRAME,
): ChanceFrames {
  const out = freshOut();
  const frames: ChanceFrames['frames'] = [];
  // the latest numbers each of out's edge slots and boxes was lit with, and every edge's arrays in the order they first appear
  const keptEdges: (number[] | undefined)[] = [];
  const keptBoxes: (number[] | undefined)[] = [];
  const appeared = new Set<number[]>();
  for (let step = 0; step * frame < CASCADE_PERIOD; step++) {
    const time = chance * CASCADE_PERIOD + step * frame;
    writeCageCascade(net, stateAt(time, overrides), scratch, out);
    const lit: number[][] = [];
    for (let edge = 0; edge < CASCADE_EDGES; edge++) {
      const at = edge * CASCADE_EDGE_NUMBERS;
      if (!((out[at + SLOTS.light] ?? 0) > 0)) continue;
      const numbers = numbersAt(out, at, CASCADE_EDGE_NUMBERS, keptEdges[edge]);
      keptEdges[edge] = numbers;
      appeared.add(numbers);
      lit.push(numbers);
    }
    const boxes = [0, 1].map((box) => {
      const at = CASCADE_BOXES_AT + box * CASCADE_BOX_NUMBERS;
      if (!((out[at + CASCADE_BOX_SLOTS.light] ?? 0) > 0)) return undefined;
      keptBoxes[box] = numbersAt(out, at, CASCADE_BOX_NUMBERS, keptBoxes[box]);
      return keptBoxes[box];
    });
    frames.push({ time, edges: lit, boxes });
  }
  // each edge once, by its nodes, as the last numbers it was lit with
  const edges = new Map<string, number[]>();
  for (const edge of appeared) edges.set(edgeKeyOf(edge), edge);
  const everyEdge = [...edges.values()];
  return { chance, frames, edges: everyEdge, ...pulsesOf(everyEdge) };
}

/** Every chance from the third to the one `seconds` in, frame by frame. */
function everyChance(seconds: number, overrides: Partial<HologramFrame>) {
  const scratch = freshScratch(net);
  const found: ChanceFrames[] = [];
  for (let chance = 2; chance < seconds / CASCADE_PERIOD; chance++)
    found.push(chanceFrames(chance, overrides, scratch));
  return found;
}

/** Whether each chance from the third lights anything, a frame in every twentieth of a second. */
function firedChances(seconds: number, overrides: Partial<HologramFrame>) {
  const scratch = freshScratch(net);
  const out = freshOut();
  const fired: boolean[] = [];
  for (let chance = 2; chance < seconds / CASCADE_PERIOD; chance++) {
    let lit = false;
    for (let time = chance * CASCADE_PERIOD; time < (chance + 1) * CASCADE_PERIOD && !lit; time += 0.05) {
      writeCageCascade(net, stateAt(time, overrides), scratch, out);
      lit = litEdges(out).length > 0;
    }
    fired.push(lit);
  }
  return fired;
}

function edgeKeyOf(edge: number[]) {
  return `${endKeyOf(edge, 0)}|${endKeyOf(edge, 1)}`;
}

/**
 * The angle, in degrees, seen from `tip`, between the way back in to `inner` and the way out to
 * `other`: 0 for an edge running back exactly along the one in, 180 for one carrying straight on.
 */
function openingAt(tip: { x: number; y: number }, inner: { x: number; y: number }, other: { x: number; y: number }) {
  const backX = inner.x - tip.x;
  const backY = inner.y - tip.y;
  const awayX = other.x - tip.x;
  const awayY = other.y - tip.y;
  const cosine = (backX * awayX + backY * awayY) / (Math.hypot(backX, backY) * Math.hypot(awayX, awayY));
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/**
 * Below this many degrees from a spoke's own line back in, an edge at its outer node is a sliver
 * running back nearly along it, not company: at 1x the two read as one stick growing out of him, as
 * a spoke alone did (`CASCADE_SPOKE_OPENING` in `cage-cascade.ts`, which the plan holds to at its
 * looks, is a little wider, so a spoke turned between two looks still clears this at every frame).
 */
const SLIVER_DEGREES = 20;

/**
 * A chance's whole plan as a graph, from every edge it lit at any frame: its nodes at rest, each
 * once, every edge at each (as that edge's place in the plan, and its node at the other end), and
 * where in the plan a lit edge's numbers, as a frame hands them over, are: worked out once for each
 * array, not by key at every frame.
 */
function planGraphOf(edges: number[][]) {
  const nodes = new Map<string, number>();
  const restOf: number[][] = [];
  const nodeOf = (edge: number[], end: number) => {
    const key = endKeyOf(edge, end);
    const known = nodes.get(key);
    if (known !== undefined) return known;
    nodes.set(key, restOf.length);
    restOf.push(endOf(edge, end));
    return restOf.length - 1;
  };
  const planned = edges.map((edge, place) => ({ place, from: nodeOf(edge, 0), to: nodeOf(edge, 1) }));
  const places = new Map(edges.map((edge, place) => [edgeKeyOf(edge), place]));
  const atNode = restOf.map(() => [] as { place: number; far: number }[]);
  for (const { place, from, to } of planned) {
    atNode[from]?.push({ place, far: to });
    atNode[to]?.push({ place, far: from });
  }
  const placed = new Map<number[], (typeof planned)[number]>();
  const placeOf = (edge: number[]) => {
    const known = placed.get(edge) ?? planned[places.get(edgeKeyOf(edge)) ?? -1];
    if (!known) throw new Error(`a lit edge ${edgeKeyOf(edge)} missing from its chance's plan`);
    placed.set(edge, known);
    return known;
  };
  return { restOf, atNode, placeOf };
}

/**
 * Every spoke a chance lights, at every frame it is one, by the plan's own thresholds: the widest any
 * other edge of the chance's whole plan leaves its outer node then, from the spoke's own line back in
 * ({@link openingAt}), 0 where none reaches it. The whole plan's, not that frame's: as its spark first
 * leaves, or as it fades after the edge beyond it, a spoke can be the only lit edge at its outer node
 * for up to a hop (`CASCADE_SPOKE` in `cage-cascade.ts`).
 */
function spokesOf({ frames, edges }: ChanceFrames) {
  const { restOf, atNode, placeOf } = planGraphOf(edges);
  // where each node is seen, and at which frame: worked out the first time a frame asks
  const seen = restOf.map((rest) => ({ rest, frame: -1, at: { x: 0, y: 0, z: 0 } }));
  const spokes: { time: number; widest: number }[] = [];
  for (const [frame, { time, edges: lit }] of frames.entries()) {
    const turn = bodyTurnAt(time);
    const seenNode = (node: number) => {
      const known = seen[node];
      if (!known) throw new Error(`no node ${node} in the plan`);
      if (known.frame !== frame) {
        known.frame = frame;
        known.at = seenAt(known.rest, time, turn);
      }
      return known.at;
    };
    /** The widest any other edge at a spoke's tip opens from its way back in. */
    const widestAt = (place: number, tip: number, inner: { x: number; y: number }) => {
      let widest = 0;
      for (const other of atNode[tip] ?? [])
        if (other.place !== place) widest = Math.max(widest, openingAt(seenNode(tip), inner, seenNode(other.far)));
      return widest;
    };
    for (const edge of lit) {
      const { place, from: fromNode, to: toNode } = placeOf(edge);
      const from = seenNode(fromNode);
      const to = seenNode(toNode);
      if (!isSpoke(from, to)) continue;
      const outer = Math.hypot(to.x, to.y) > Math.hypot(from.x, from.y);
      spokes.push({ time, widest: widestAt(place, outer ? toNode : fromNode, outer ? from : to) });
    }
  }
  return spokes;
}

/** The frames a chance lights a spoke with nothing at its tip but slivers, or nothing at all ({@link SLIVER_DEGREES}). */
function loneSpokesOf(chance: ChanceFrames) {
  return spokesOf(chance).filter(({ widest }) => widest < SLIVER_DEGREES);
}

/**
 * Whether two moments a frame hands the picture are the same: its numbers are 32-bit floats, which
 * past the first few minutes hold a moment to a few hundredths of a millisecond at best.
 */
function sameMoment(first: number, second: number) {
  return Math.abs(first - second) <= 1e-4 + Math.abs(second) * 2 ** -22;
}

/** The first frame's numbers of one of a chance's boxes (0 fired from, 1 landed on), lit. */
function boxOf({ frames }: ChanceFrames, box: number) {
  return frames.flatMap(({ boxes }) => (boxes[box] ? [boxes[box]] : []))[0] ?? [];
}

/**
 * That a chance's pulse fires from the box that flares as it fires, from a node over that box then,
 * and lights nothing before it; the box's numbers.
 */
function expectFlaredUnderTheSource(chance: ChanceFrames) {
  const out = chance.out;
  const source = boxOf(chance, 0);
  const first = source[CASCADE_BOX_SLOTS.first] ?? 0;
  const sweep = source[CASCADE_BOX_SLOTS.sweep] ?? 0;
  const fires = source[CASCADE_BOX_SLOTS.flares] ?? 0;
  const fromSource = out.filter((edge) => edge[SLOTS.leaves] === fires);

  expect(isBox(first, sweep)).toBe(true);
  expect(fromSource.length).toBeGreaterThan(0);
  for (const edge of out) expect(edge[SLOTS.leaves] ?? 0).toBeGreaterThanOrEqual(fires);
  for (const edge of fromSource) expect(overBox(seenAt(endOf(edge, 0), fires), first, sweep, fires)).toBe(true);
  return source;
}

/**
 * That a chance's return lights enough edges and lands on a box of its own, which flares as it
 * lands, the node it lands on over that box then, where the truss has rolled it.
 */
function expectFlaredUnderTheTarget(chance: ChanceFrames, source: number[]) {
  const back = chance.back;
  const target = boxOf(chance, 1);
  const first = target[CASCADE_BOX_SLOTS.first] ?? 0;
  const sweep = target[CASCADE_BOX_SLOTS.sweep] ?? 0;
  const lands = target[CASCADE_BOX_SLOTS.flares] ?? 0;
  const landsAt = (edge: number[]) => (edge[SLOTS.leaves] ?? 0) + CASCADE_HOP_SECONDS;
  const landing = back.filter((edge) => sameMoment(landsAt(edge), lands));

  expect(back.length).toBeGreaterThanOrEqual(CASCADE_FEWEST_RETURN_EDGES);
  expect(isBox(first, sweep)).toBe(true);
  expect(first).not.toBe(source[CASCADE_BOX_SLOTS.first]);
  expect(sameMoment(Math.max(...back.map(landsAt)), lands)).toBe(true);
  expect(landing.length).toBeGreaterThan(0);
  for (const edge of landing) expect(overBox(seenAt(endOf(edge, 1), lands), first, sweep, lands)).toBe(true);
}

/** From when to when everything a chance lights at any of its frames is lit: each edge and each box's flare. */
function litSpans({ chance, frames }: ChanceFrames) {
  return frames.flatMap(({ edges, boxes }) => [
    ...edges.map((edge) => ({
      chance,
      what: 'edge',
      from: edge[SLOTS.leaves] ?? 0,
      until: (edge[SLOTS.fades] ?? 0) + CASCADE_FADE_SECONDS,
    })),
    ...boxes.flatMap((box) =>
      box
        ? [
            {
              chance,
              what: 'box',
              from: box[CASCADE_BOX_SLOTS.flares] ?? 0,
              until: (box[CASCADE_BOX_SLOTS.flares] ?? 0) + CASCADE_BOX_FLARE_SECONDS,
            },
          ]
        : [],
    ),
  ]);
}

const busyChances = everyChance(360, BUSY);

describe('the cage net the cascades run over', () => {
  it('joins only nodes of the cage both ways, along its own evenly lit edges out past the specks', () => {
    expect(net.count).toBeGreaterThan(50);
    expect(net.nodes).toHaveLength(net.count * 3);
    const edges = new Set<string>();
    for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
      const from = scene.cage.slice(offset, offset + 3).join(',');
      const to = scene.cage.slice(offset + 3, offset + 6).join(',');
      edges.add(`${from}|${to}`);
      edges.add(`${to}|${from}`);
    }
    for (let node = 0; node < net.count; node++) {
      const at = net.nodes.slice(node * 3, node * 3 + 3);
      expect(Math.hypot(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0)).toBeGreaterThanOrEqual(0.95);
      for (let link = net.firstLink[node] ?? 0; link < (net.firstLink[node + 1] ?? 0); link++) {
        const other = net.links[link] ?? -1;
        const back = net.links.slice(net.firstLink[other], net.firstLink[other + 1]);
        expect(back).toContain(node);
        expect(edges.has(`${at.join(',')}|${net.nodes.slice(other * 3, other * 3 + 3).join(',')}`)).toBe(true);
      }
    }
  });
});

describe('the cage cascades', () => {
  it('last, at their latest and longest, no longer than a chance, and turn him less than half a turn meanwhile', () => {
    expect(CASCADE_LATEST_FIRE + CASCADE_LONGEST_SECONDS).toBeLessThanOrEqual(CASCADE_PERIOD + 1e-9);
    // which is what lets the plan judge where a node is over a stretch from where it is at its ends
    expect(BODY_RADIANS_PER_SECOND * CASCADE_LONGEST_SECONDS).toBeLessThan(Math.PI);
  });

  it('fire now and then: about one every four seconds in silence, more often while he talks, and as often while he thinks', () => {
    // one every five seconds in silence until the user asked for them "a bit bigger and more frequent"
    const seconds = 600;
    const inSilence = firedChances(seconds, {}).filter(Boolean).length;
    const whileTalking = firedChances(seconds, BUSY).filter(Boolean).length;
    const whileThinking = firedChances(seconds, { thinking: 1 });

    expect(seconds / inSilence).toBeGreaterThan(3.5);
    expect(seconds / inSilence).toBeLessThan(4.2);
    expect(whileTalking).toBeGreaterThan(inSilence * 1.2);
    expect(whileThinking).toEqual(firedChances(seconds, BUSY));
  });

  it('are lit three fifths of the time in silence and three quarters of it while he talks, never dark for five seconds', () => {
    // under half the time in silence, and up to 9.5 s dark, before the user asked for them "more frequent"
    for (const [overrides, share] of [
      [{}, 0.6],
      [BUSY, 0.75],
    ] as const) {
      const scratch = freshScratch(net);
      const out = freshOut();
      const step = 1 / 20;
      let lit = 0;
      let frames = 0;
      let dark = 0;
      let longestDark = 0;
      for (let time = 2 * CASCADE_PERIOD; time < 600; time += step) {
        writeCageCascade(net, stateAt(time, overrides), scratch, out);
        frames++;
        if (litEdges(out).length > 0 || litBox(out, 0) || litBox(out, 1)) {
          lit++;
          dark = 0;
        } else {
          dark += step;
          longestDark = Math.max(longestDark, dark);
        }
      }
      expect(lit / frames).toBeGreaterThan(share);
      expect(longestDark).toBeLessThan(5);
    }
  });

  it('light about one and a half times the cage they did: some 24 edges or more a cascade, on average', () => {
    // 17 edges a cascade before the user asked for them "a bit bigger"
    const fired = busyChances.filter(({ edges }) => edges.length > 0);
    const edges = fired.reduce((sum, { edges }) => sum + edges.length, 0);
    expect(edges / fired.length).toBeGreaterThan(24);
  });

  it('never leave him dark for two chances in silence while either could have fired', () => {
    // A chance that finds no node to fire from cannot fire at all, busy or not; any other between two
    // that always fire fires in silence beside it, so two in a row go dark only where neither can.
    const seconds = 1200;
    const inSilence = firedChances(seconds, {});
    const whileBusy = firedChances(seconds, BUSY);

    for (let place = 1; place < inSilence.length; place++) {
      if (inSilence[place] || inSilence[place - 1]) continue;
      expect({ chance: place + 2, couldFire: whileBusy[place] || whileBusy[place - 1] }).toEqual({
        chance: place + 2,
        couldFire: false,
      });
    }
    // and with edges reaching in to CASCADE_LIMB that is hardly ever: under one chance in fifty, and in
    // silence no two in a row (it was one in ten, and runs of three)
    expect(whileBusy.filter((fired) => !fired).length).toBeLessThan(whileBusy.length * 0.02);
    expect(inSilence.some((fired, place) => !fired && place > 0 && !inSilence[place - 1])).toBe(false);
  });

  it('light edges only where both their nodes stay out past his limb and not far behind him, every frame they are lit', () => {
    let judged = 0;
    for (const { frames } of busyChances) {
      for (const { time, edges } of frames) {
        for (const edge of edges) {
          for (const end of [0, 1]) {
            const seen = seenAt(endOf(edge, end), time);
            expect(Math.hypot(seen.x, seen.y)).toBeGreaterThanOrEqual(CASCADE_LIMB);
            expect(seen.z).toBeGreaterThanOrEqual(CASCADE_DEEPEST);
            judged++;
          }
        }
      }
    }
    expect(judged).toBeGreaterThan(10000);
  });

  it('never light a spoke standing out into the dark on its own, at any frame it is lit', () => {
    const spokes = busyChances.flatMap(spokesOf);

    // another edge of the plan leaves each one's outer node at an angle to it, so it leads on to the
    // lit net: never none, and never only a sliver running back nearly along it, which at 1x reads as
    // the same stick (one cascade in two had one for over a second once they were made bigger)
    expect(busyChances.flatMap(loneSpokesOf)).toEqual([]);
    expect(spokes.length).toBeGreaterThan(0);
  });

  it('hold to it over thousands of chances: every pulse leaves its flaring box, every return lands on its own, and no spoke stands alone', () => {
    // A plan is cut back after it is spread (lone spokes dropped until none is left, then a return
    // too thin to answer), which only a few chances in a thousand need; the minute or so above
    // reaches none of them, so this plans chances enough to, a frame every twentieth of a second.
    const scratch = freshScratch(net);
    let fired = 0;
    let returns = 0;
    for (let chance = 2; chance < 2002; chance++) {
      const frames = chanceFrames(chance, BUSY, scratch, 1 / 20);
      if (frames.edges.length === 0) continue;
      fired++;
      const source = expectFlaredUnderTheSource(frames);
      if (frames.back.length > 0) {
        expectFlaredUnderTheTarget(frames, source);
        returns++;
      }
      expect({ chance, alone: loneSpokesOf(frames) }).toEqual({ chance, alone: [] });
    }
    expect(fired).toBeGreaterThan(1500);
    expect(returns).toBeGreaterThan(fired / 2);
  });

  it('flare the box the pulse fires from as it fires, under its node, and the box the return lands on as it lands, under the node it lands on', () => {
    let returns = 0;
    for (const chance of busyChances) {
      if (chance.edges.length === 0) continue;
      const source = expectFlaredUnderTheSource(chance);
      if (chance.back.length > 0) {
        expectFlaredUnderTheTarget(chance, source);
        returns++;
      } else {
        expect(chance.frames.some(({ boxes }) => boxes[1] !== undefined)).toBe(false);
      }
    }
    expect(returns).toBeGreaterThan(30);
  });

  it('spread out hop by hop from one node, and gather back onto another', () => {
    for (const { edges, out, back } of busyChances) {
      if (edges.length === 0) continue;
      const fires = Math.min(...out.map((edge) => edge[SLOTS.leaves] ?? 0));
      // every spark leaves a whole number of hops after the pulse fired, from a node an earlier spark lit
      const lit = new Set(out.filter((edge) => edge[SLOTS.leaves] === fires).map((edge) => endKeyOf(edge, 0)));
      expect(lit.size).toBe(1);
      for (const edge of [...out].sort((first, second) => (first[SLOTS.leaves] ?? 0) - (second[SLOTS.leaves] ?? 0))) {
        const hops = ((edge[SLOTS.leaves] ?? 0) - fires) / CASCADE_HOP_SECONDS;
        expect(Math.abs(hops - Math.round(hops))).toBeLessThan(1e-3);
        expect(lit.has(endKeyOf(edge, 0))).toBe(true);
        lit.add(endKeyOf(edge, 1));
      }
      expect(out.length).toBeGreaterThanOrEqual(4);
      if (back.length === 0) continue;
      // the return's sparks all converge on one node, landing together, after the pulse out spread
      const lands = Math.max(...back.map((edge) => (edge[SLOTS.leaves] ?? 0) + CASCADE_HOP_SECONDS));
      const targets = new Set(
        back
          .filter((edge) => Math.abs((edge[SLOTS.leaves] ?? 0) + CASCADE_HOP_SECONDS - lands) < 1e-4)
          .map((edge) => endKeyOf(edge, 1)),
      );
      expect(targets.size).toBe(1);
      expect(Math.min(...back.map((edge) => edge[SLOTS.leaves] ?? 0))).toBeGreaterThan(fires);
      expect(lit.has([...targets][0] ?? '')).toBe(false);
    }
  });

  it('are over before the next chance at every frame, returns and both flares too, so two never overlap and none is cut off', () => {
    const lit = busyChances.flatMap(litSpans);
    const outside = lit.filter(
      ({ chance, from, until }) =>
        from < chance * CASCADE_PERIOD - 1e-3 || until > (chance + 1) * CASCADE_PERIOD + 1e-3,
    );

    expect(outside).toEqual([]);
    expect(lit.filter(({ what }) => what === 'box').length).toBeGreaterThan(0);
  });

  it('are the same frame at a time from a fresh scratch as from one kept frame to frame', () => {
    const kept = freshScratch(net);
    const keptOut = freshOut();
    for (let time = 20; time < 80; time += 1 / 30) {
      const state = stateAt(time, BUSY);
      writeCageCascade(net, state, kept, keptOut);
      const freshlyOut = freshOut();
      writeCageCascade(net, state, freshScratch(net), freshlyOut);
      expect(litEdges(freshlyOut)).toEqual(litEdges(keptOut));
      expect([litBox(freshlyOut, 0), litBox(freshlyOut, 1)]).toEqual([litBox(keptOut, 0), litBox(keptOut, 1)]);
    }
  });

  it('light nothing, and flare no box, before he has formed, and only partly while he forms', () => {
    const forming = everyChance(120, { ...BUSY, appearance: 0.5 });
    for (const { frames } of forming) {
      for (const { edges, boxes } of frames) {
        expect(edges).toHaveLength(0);
        expect(boxes).toEqual([undefined, undefined]);
      }
    }
    const lights = everyChance(120, { ...BUSY, appearance: 0.95 }).flatMap(({ frames }) =>
      frames.flatMap(({ edges }) => edges.map((edge) => edge[SLOTS.light] ?? 0)),
    );
    expect(lights.length).toBeGreaterThan(0);
    for (const light of lights) {
      expect(light).toBeGreaterThan(0);
      expect(light).toBeLessThan(1);
    }
  });

  it('go out as he leaves: dimmer as his vortex runs back, and dark once it is under way', () => {
    // the frame at presence p is the frame at appearance p, so leaving is forming run backwards
    for (const presence of [0.95, 0.5, 0]) {
      const lights = everyChance(60, { ...BUSY, presence }).flatMap(({ frames }) =>
        frames.flatMap(({ edges }) => edges.map((edge) => edge[SLOTS.light] ?? 0)),
      );
      if (presence < 0.9) expect(lights).toHaveLength(0);
      else for (const light of lights) expect(light).toBeLessThan(1);
    }
  });
});
