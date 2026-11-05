import {
  BODY_RADIANS_PER_SECOND,
  bodyTurnRadians,
  CAGE_EDGE_STRIDE,
  CAGE_SWAY,
  cageSwayOf,
  type HologramFrameState,
  RIM_ROLL_DEGREES_PER_SECOND,
  TRUSS_ARCS,
} from './hologram-drawing';

/**
 * The cage's cascades: now and then a box of the truss fires — its square flares — and a pulse
 * spreads out through the cage from the node over it, hop by hop over the cage's own edges, as a
 * neuron fires down its branches: each edge it reaches lit as a glowing line with a bright spark
 * racing along it, flashing the node it lands on. It runs round his edge rather than out from it,
 * lighting a stretch of the cage's triangles along his silhouette, which then fades back from where
 * it started outward. As it reaches its tips a return gathers beside it down other edges and
 * converges onto a different box of the truss, whose square flares as it lands: the data coming back.
 *
 * It lights the cage's existing edges and nothing else, out past his limb where the cage is seen
 * against the dark, and never a spoke standing out into the dark, so nothing grows out past where
 * the cage already reaches. Each edge is judged where its nodes will be for as long as it is lit, not
 * only as the pulse fires: his body turns about a degree for every 70 ms of it, and an edge planned
 * where it stood at the start could have drifted over his bright body, behind him, or out on its own
 * by the time it went out. The picture draws it (`cascadeLayer` in `gpu/picture-layers.ts`) from
 * what {@link writeCageCascade} hands it each frame.
 *
 * Now and then: one chance a {@link CASCADE_PERIOD}. Every other one fires whatever he is doing, a
 * share ({@link CASCADE_IN_SILENCE}) of the ones between as well, and while he talks or thinks all of
 * them; so in silence no two are more than two periods apart. Each is over before the next chance
 * comes ({@link CASCADE_LONGEST_SECONDS}), so two never overlap. Which chance fires, when, from which
 * node and down which edges all come from the clock by a hash, so a frame at a time is always the
 * same frame whatever was drawn before it; the frame's scratch only keeps the current chance's plan,
 * and where its neighbours fire from, so each is worked out once rather than every frame.
 *
 * Every worklet here is declared after the worklets it calls, so the file reads from the smallest
 * helpers up to {@link writeCageCascade} at its foot: Reanimated makes each worklet a `const` where it
 * stands, and one that called a worklet further down would throw as the module loaded on a device
 * (`worklets.contract.spec.ts`).
 */
export const CASCADE_PERIOD = 3;
/** How far into its period a chance may fire, in seconds, from the hash: so they are not a metronome. */
const CASCADE_JITTER = 0.08;
/**
 * How much later a chance that finds no node to fire from tries again, in seconds, and how many
 * times: the cage turns on in the meantime, and one a moment later usually has, so a chance is
 * rarely lost to where the cage happened to be.
 */
const CASCADE_RETRY_SECONDS = 0.1;
const CASCADE_RETRIES = 2;
/** The latest a chance's pulse fires after its period starts, in seconds: its jitter and every retry. */
export const CASCADE_LATEST_FIRE = CASCADE_JITTER + CASCADE_RETRIES * CASCADE_RETRY_SECONDS;
/** The share of the chances between the ones that always fire that fire in silence too. */
const CASCADE_IN_SILENCE = 0.15;
/** How long a pulse takes over one edge of the cage, in seconds: slow enough to follow its spark. */
export const CASCADE_HOP_SECONDS = 0.24;
/** How many hops out from the box that fired the pulse spreads, and how many the return gathers over. */
const CASCADE_OUT_HOPS = 5;
const CASCADE_RETURN_HOPS = 3;
/**
 * How many edges each node lights onward, at most: the first node up to three, every later one up to
 * two, so the patch branches like a tree rather than flooding the mesh. And how many edges a pulse
 * lights at most, out and back.
 */
const CASCADE_FIRST_BRANCHES = 3;
const CASCADE_BRANCHES = 2;
/** How much the hash may add to an edge's score, when a spread picks which to light next ({@link nextAlongHisEdge}). */
const CASCADE_CHOICE_JITTER = 0.3;
/**
 * How much an edge scores for every share of its far node seen out where it shows
 * ({@link seenShare}), and for running round his edge rather than out from it: mostly where it
 * shows, as the cage out in the dark is a thin ring of triangles; a little round him, so the patch
 * runs along his silhouette rather than straight out.
 */
const CASCADE_OUT_WHERE_SEEN = 1;
const CASCADE_ROUND_HIM = 0.35;
/**
 * A spoke: an edge seen running more nearly out from his middle than this (the cosine of its angle
 * to the way out) with an end past {@link CASCADE_SPOKE_REACH} ({@link isSpokeBetween}). Lit on its
 * own, with nothing lit beyond it, one stood out into the dark past the truss for a second and read
 * as a stick growing out of him, so a plan never keeps one whose outer node no other edge of it
 * reaches ({@link dropLoneSpokes}); one that leads on to a lit triangle reads as part of it.
 */
export const CASCADE_SPOKE = 0.8;
export const CASCADE_SPOKE_REACH = 1.08;
/**
 * How often, in seconds, a planned edge is looked at over the time it is lit to see whether it is a
 * spoke anywhere along it: well inside a frame at 30 a second, so an edge turning into a spoke
 * between two looks is one on for less than a frame.
 */
const CASCADE_SPOKE_LOOKS = 1 / 20;
/** The fewest edges a return must light to be planned: fewer read as a stray flicker, not an answer. */
export const CASCADE_FEWEST_RETURN_EDGES = 3;
const CASCADE_OUT_EDGES = 18;
/** And how many more edges the pulse out may light closing the triangles of its patch ({@link planClosingEdges}). */
const CASCADE_CLOSING_EDGES = 8;
const CASCADE_RETURN_EDGES = 10;
export const CASCADE_EDGES = CASCADE_OUT_EDGES + CASCADE_CLOSING_EDGES + CASCADE_RETURN_EDGES;
/** The fewest edges a pulse out must light, and the fewest hops it must reach, to be fired at all. */
const CASCADE_FEWEST_EDGES = 5;
const CASCADE_FEWEST_HOPS = 3;
/**
 * How long the lit patch holds once the pulse has spread as far as it goes, how much later each hop
 * out starts to fade than the one before it — so it fades from where it started outward — and how
 * long each takes to go out, in seconds.
 */
const CASCADE_HOLD_SECONDS = 0.3;
const CASCADE_FADE_STEP = 0.1;
export const CASCADE_FADE_SECONDS = 0.3;
/**
 * How long a box of the truss flares when a pulse leaves it or a return lands on it, in seconds:
 * up quickly, and down over the rest.
 */
export const CASCADE_BOX_FLARE_SECONDS = 0.6;
/**
 * The latest, in seconds after it fires, that a pulse out has spread as far as it goes — every hop
 * it may take and the hop its triangles close in — and, after its return starts gathering, that the
 * return lands: the bounds every edge's time lit is judged over ({@link litUntil}).
 */
const CASCADE_LATEST_SPREAD = (CASCADE_OUT_HOPS + 1) * CASCADE_HOP_SECONDS;
const CASCADE_LATEST_LANDING = CASCADE_RETURN_HOPS * CASCADE_HOP_SECONDS;
/**
 * The longest a cascade lasts from the moment it fires to its last light going out, in seconds: the
 * longer of the closing edges of its farthest hop fading, the deepest return's edges fading, and the
 * flares of its boxes. With {@link CASCADE_LATEST_FIRE}, it fits in a {@link CASCADE_PERIOD}, so
 * nothing of one is cut off by the next being planned, and none overlaps the next.
 */
export const CASCADE_LONGEST_SECONDS = Math.max(
  CASCADE_LATEST_SPREAD + CASCADE_HOLD_SECONDS + CASCADE_OUT_HOPS * CASCADE_FADE_STEP + CASCADE_FADE_SECONDS,
  CASCADE_LATEST_SPREAD -
    CASCADE_HOP_SECONDS +
    CASCADE_LATEST_LANDING +
    Math.max(
      CASCADE_HOLD_SECONDS + (CASCADE_RETURN_HOPS - 1) * CASCADE_FADE_STEP + CASCADE_FADE_SECONDS,
      CASCADE_BOX_FLARE_SECONDS,
    ),
  CASCADE_BOX_FLARE_SECONDS,
);
/**
 * How far out, in R, both nodes of an edge must be seen for as long as it is lit — out past his
 * limb, where the cage is against the dark — and how far behind him they may be, as a share of R
 * towards his back ({@link clearOver}). And how far out both ends of a cage edge must lie at rest for
 * it to be walked at all: on the cage's shell and weave, not an anchor down into the specks.
 */
export const CASCADE_LIMB = 0.9;
export const CASCADE_DEEPEST = -0.45;
const CASCADE_NODE_REACH = 0.95;
/** How far out, in R, a node a pulse leaves from or lands on must be seen: over the truss, from just inside its inner rail to just past its outer one. */
export const CASCADE_FOOT_INNER = 0.91;
export const CASCADE_FOOT_OUTER = 1.06;
/**
 * Where a lit edge shows, in R: not at all inside {@link CASCADE_SEEN_FROM}, over his bright body,
 * and wholly from {@link CASCADE_SEEN_FROM} + {@link CASCADE_SEEN_EDGE} out, past the truss's outer
 * rail. In how many pieces each edge is weighed, and the least of a pulse out that must show for it
 * to fire at all, in R: a pulse that ran round under the bright truss could not be seen.
 */
const CASCADE_SEEN_FROM = 0.96;
const CASCADE_SEEN_EDGE = 0.1;
const CASCADE_SEEN_STEPS = 4;
const CASCADE_FEWEST_SEEN = 0.45;
/**
 * How much the hash may make of a node's pulse out, either way, as a share, when a chance weighs
 * which to fire from: enough that the best seen is not always the one, never enough to fire one
 * that would be half lost.
 */
const CASCADE_SOURCE_CHOICE = 0.1;
/** How much less a return answers for each R its box is seen from the box that fired. */
const CASCADE_NEARBY = 2;
/** The least of a return that must show for it to gather at all, in R. */
const CASCADE_FEWEST_RETURN_SEEN = 0.15;
/** How much, in R of lit edge that shows, a return gains for each of its nodes beside the patch the pulse out lit. */
const CASCADE_BESIDE = 0.12;
/**
 * How busy he must be for a chance that fires only while he is busy to be lit at all, and over how
 * much more it comes up to all of it ({@link chanceLight}); and how far his vortex must have formed
 * him for any of it to be lit, and over how much more.
 */
const CASCADE_BUSY_FROM = 0.15;
const CASCADE_BUSY_EASE = 0.35;
const CASCADE_FORMED_FROM = 0.9;
const CASCADE_FORMED_EASE = 0.1;
/**
 * What the hash is salted with for each of a chance's choices: when it fires, whether it fires in
 * silence, the jitter of the node it fires from and of each edge it lights, and its return's.
 */
const SALT_FIRES = 1;
const SALT_IN_SILENCE = 2;
const SALT_RETURN = 7;
const SALT_SOURCE_NODE = 13;
const SALT_NEXT_NODE = 31;

/**
 * How far a swayed node can be from where it is unswayed, seen flat, in R, and how much nearer his
 * back: each of its coordinates sways by at most {@link CAGE_SWAY}, and the turn mixes x and z.
 */
const SWAY_SEEN = Math.sqrt(3) * CAGE_SWAY;
const SWAY_DEEPER = Math.SQRT2 * CAGE_SWAY;
/** How far out a node must be seen unswayed for it to be past his limb however it sways. */
const LIMB_CLEAR_OF_SWAY = CASCADE_LIMB + SWAY_SEEN;

/** What of a frame the cascades read: its clock, how busy he is and whether he has formed. */
export type CascadeFrame = Pick<HologramFrameState, 'time' | 'talk' | 'thinking' | 'swirl'>;

/**
 * The numbers handed to the picture for each lit edge, as three vec4s: its spark's from node at rest
 * (x, y, z) and when it leaves; its to node at rest and when the edge starts to fade; and how lit it
 * is (0 for an edge not lit this frame), with three numbers unused to make up the vec4. A spark takes
 * {@link CASCADE_HOP_SECONDS} over its edge, and an edge {@link CASCADE_FADE_SECONDS} to go out, which
 * the picture's shader is written with.
 */
export const CASCADE_EDGE_SLOTS = { from: 0, leaves: 3, to: 4, fades: 7, light: 8 } as const;
export const CASCADE_EDGE_NUMBERS = 12;
/**
 * And for each of the two boxes, the box the pulse fired from and the box the return lands on, as a
 * vec4: its first clock degree in the truss's own frame (before its roll), its sweep, when it flares
 * and how lit it is (0 when it is not flaring this frame).
 */
export const CASCADE_BOX_SLOTS = { first: 0, sweep: 1, flares: 2, light: 3 } as const;
export const CASCADE_BOX_NUMBERS = 4;
/** Where the boxes' numbers start, after every edge's. */
export const CASCADE_BOXES_AT = CASCADE_EDGES * CASCADE_EDGE_NUMBERS;
/** How many numbers the picture reads in all, a whole number of vec4s. */
export const CASCADE_NUMBERS = CASCADE_BOXES_AT + 2 * CASCADE_BOX_NUMBERS;

const DEGREES = Math.PI / 180;

/** The two pulses of a cascade, as which of them a planned edge is ({@link EDGE_KIND}) and which numbers of a node a spread uses. */
const OUT_PULSE = 0;
const RETURN_PULSE = 1;

/**
 * Where a scratch keeps the current chance's plan: which chance it is (plus one, so a fresh scratch
 * of zeros holds none), when it fires, whether it fires whatever he does (0) or only while he is
 * busy (1), how many edges it lights, when the pulse out has spread as far as it goes, the box it
 * fired from, the box the return lands on (-1 none), when it lands and the node it lands on. Then a
 * spread's working numbers: a count every spread takes the next of, so a node's hops count only
 * when stamped with its own (none need clearing), the latest spread's of each pulse, how many nodes
 * the latest spread reached and how many hops deep; two nodes seen at some moment; the cosines and
 * sines of how far round a node is at the two ends of a stretch ({@link clearBetween}); and for each
 * pulse a count every judgement of where its nodes are clear of him takes the next of, and how far
 * his body had turned at that pulse's start ({@link judgeClearance}). Then, for the chance before,
 * the chance and the chance after it, which chance (plus one), when it fires and from which node (-1
 * none). Then each edge's from node, to node, when its spark leaves, when it
 * starts to fade, which pulse it is, which of its ends are ever its outer one while it is a spoke
 * (1 its from node, 2 its to node), and whether it is dropped. The net's nodes' numbers follow
 * ({@link CascadeSlots}).
 */
const PLANNED = 0;
const FIRES = 1;
const ONLY_WHILE_BUSY = 2;
const EDGE_COUNT = 3;
const SPREAD_OUT = 4;
const SOURCE_BOX = 5;
const TARGET_BOX = 6;
const LANDS = 7;
const TARGET = 8;
const GENERATION = 9;
const PULSE_GENERATION = 10;
const REACHED = 12;
const DEEPEST = 13;
const SEEN_FIRST = 14;
const SEEN_SECOND = 17;
const TURNS = 20;
const JUDGEMENT = 24;
const JUDGED_TURN = 26;
const SOURCES = 28;
const SOURCE_NUMBERS = 3;
const SOURCES_KEPT = 3;
const EDGES = SOURCES + SOURCES_KEPT * SOURCE_NUMBERS;
const EDGE_FROM = 0;
const EDGE_TO = 1;
const EDGE_LEAVES = 2;
const EDGE_FADES = 3;
const EDGE_KIND = 4;
const EDGE_OUTER_ENDS = 5;
const EDGE_DROPPED = 6;
const EDGE_SLOT = 7;
const NODE_SLOTS = EDGES + CASCADE_EDGES * EDGE_SLOT;
/** A node seen at the chance's fire: where (x, y down, z towards the eye), how far out and how much of an edge to it shows. */
const SEEN_NUMBERS = 5;

/**
 * Where in the scratch a planner keeps each node's numbers, for a net of its size: where it is seen
 * at the chance's fire ({@link SEEN_NUMBERS} a node); for each pulse how many hops from its start a
 * spread reached it, the spread that did ({@link GENERATION}), for which of its hops it is clear of
 * him for as long as an edge to it at that hop is lit (a bit a hop: {@link judgeNode}), and the
 * judgement that found it ({@link JUDGEMENT}); which node a spread reached it from; and the spread's
 * queue. And how many numbers the scratch holds in all.
 */
interface CascadeSlots {
  seen: number;
  hops: number[];
  stamps: number[];
  clear: number[];
  judged: number[];
  reachedFrom: number;
  queue: number;
  size: number;
}

/**
 * The cage as a net a pulse can run over: its nodes at rest (x, y down, z towards the eye), and each
 * node's neighbours along the edges lit evenly along them — none of the spikes or trails — between
 * nodes {@link CASCADE_NODE_REACH} out or more. `firstLink[node]` to `firstLink[node + 1]` are its
 * neighbours in `links`. Each node's distance from the axis his body turns about, its angle round it
 * (from x towards z) and how far out it is at rest, which say where his turn can take it; and where a
 * planner keeps its numbers in a scratch.
 */
export interface CageNet {
  nodes: number[];
  firstLink: number[];
  links: number[];
  count: number;
  turnRadius: number[];
  turnPhase: number[];
  reach: number[];
  slots: CascadeSlots;
}

/** The cage's net (see {@link CageNet}) from the scene's cage, once, on the JS thread. */
export function buildCageNet(cage: readonly number[]): CageNet {
  const nodes: number[] = [];
  const keys = new Map<string, number>();
  const neighbours: number[][] = [];
  const nodeAt = (offset: number) => {
    const key = `${cage[offset]},${cage[offset + 1]},${cage[offset + 2]}`;
    const known = keys.get(key);
    if (known !== undefined) return known;
    keys.set(key, neighbours.length);
    nodes.push(cage[offset], cage[offset + 1], cage[offset + 2]);
    neighbours.push([]);
    return neighbours.length - 1;
  };
  const reachAt = (offset: number) => Math.hypot(cage[offset], cage[offset + 1], cage[offset + 2]);
  for (let offset = 0; offset < cage.length; offset += CAGE_EDGE_STRIDE) {
    const evenlyLit = cage[offset + 9] === 1;
    if (!evenlyLit || reachAt(offset) < CASCADE_NODE_REACH || reachAt(offset + 3) < CASCADE_NODE_REACH) continue;
    const from = nodeAt(offset);
    const to = nodeAt(offset + 3);
    if (from === to || neighbours[from].includes(to)) continue;
    neighbours[from].push(to);
    neighbours[to].push(from);
  }
  const firstLink = [0];
  const links: number[] = [];
  for (const around of neighbours) {
    links.push(...around);
    firstLink.push(links.length);
  }
  const count = neighbours.length;
  const turnRadius: number[] = [];
  const turnPhase: number[] = [];
  const reach: number[] = [];
  for (let node = 0; node < count; node++) {
    const [x, y, z] = [nodes[node * 3], nodes[node * 3 + 1], nodes[node * 3 + 2]];
    turnRadius.push(Math.hypot(x, z));
    turnPhase.push(Math.atan2(z, x));
    reach.push(Math.hypot(x, y, z));
  }
  const seen = NODE_SLOTS;
  const hopsAt = seen + count * SEEN_NUMBERS;
  const slots: CascadeSlots = {
    seen,
    hops: [hopsAt, hopsAt + count],
    stamps: [hopsAt + count * 2, hopsAt + count * 3],
    clear: [hopsAt + count * 4, hopsAt + count * 5],
    judged: [hopsAt + count * 6, hopsAt + count * 7],
    reachedFrom: hopsAt + count * 8,
    queue: hopsAt + count * 9,
    size: hopsAt + count * 10,
  };
  return { nodes, firstLink, links, count, turnRadius, turnPhase, reach, slots };
}

/** How many numbers the scratch handed to {@link writeCageCascade} must hold for `net`. */
export function cascadeScratchSize(net: CageNet) {
  return net.slots.size;
}

/** The cascades' integer hash, 0 to 1. */
function cascadeHash(value: number) {
  'worklet';
  let mixed = Math.imul(value | 0, 0x9e3779b1);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85ebca77);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35);
  mixed ^= mixed >>> 16;
  return (mixed >>> 0) / 4294967296;
}

function smoothStep(value: number) {
  'worklet';
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

/** What chance `chance`'s choices are hashed from. */
function chanceSeed(chance: number) {
  'worklet';
  return chance * 7919 + 17;
}

/**
 * How long after its pulse starts (the moment it fires, or its return starts gathering) an edge it
 * lights at `hop` hops from its start may first be lit, and the latest it may still be, in seconds:
 * from when its spark may leave to when it has gone out, however far the pulse turns out to spread.
 */
function litFrom(pulse: number, hop: number) {
  'worklet';
  return pulse === OUT_PULSE ? (hop - 1) * CASCADE_HOP_SECONDS : 0;
}

function litUntil(pulse: number, hop: number) {
  'worklet';
  const spread = pulse === OUT_PULSE ? CASCADE_LATEST_SPREAD : CASCADE_LATEST_LANDING;
  return spread + CASCADE_HOLD_SECONDS + (hop - 1) * CASCADE_FADE_STEP + CASCADE_FADE_SECONDS;
}

/**
 * How many hops from its start the latest spread of `pulse` reached `node`, or -1 if it did not: a
 * node's hops count only when stamped with that spread's number, and no spread's number is 0, which
 * a fresh scratch holds everywhere.
 */
function hopOf(net: CageNet, scratch: number[], pulse: number, node: number) {
  'worklet';
  const slots = net.slots;
  const generation = scratch[PULSE_GENERATION + pulse];
  if (generation === 0 || scratch[slots.stamps[pulse] + node] !== generation) return -1;
  return scratch[slots.hops[pulse] + node];
}

/**
 * Where a node of the net is seen at `time`, into the scratch at `at`, given his body's turn then
 * (`cos`, `sin`): as the picture turns the cage's nodes (`turnedNode` in `gpu/picture-layers.ts`),
 * swayed about its place ({@link cageSwayOf}), then turned with his body.
 */
function seeNode(net: CageNet, node: number, time: number, cos: number, sin: number, scratch: number[], at: number) {
  'worklet';
  const nodes = net.nodes;
  const x = nodes[node * 3];
  const y = nodes[node * 3 + 1];
  const z = nodes[node * 3 + 2];
  const swayedX = x + cageSwayOf(0, x, y, z, time);
  const swayedY = y + cageSwayOf(1, x, y, z, time);
  const swayedZ = z + cageSwayOf(2, x, y, z, time);
  scratch[at] = swayedX * cos + swayedZ * sin;
  scratch[at + 1] = swayedY;
  scratch[at + 2] = swayedZ * cos - swayedX * sin;
}

/** How much of a lit edge shows `reach` out, 0 to 1: none over his bright body, all of it past the truss. */
function seenShare(reach: number) {
  'worklet';
  return smoothStep((reach - CASCADE_SEEN_FROM) / CASCADE_SEEN_EDGE);
}

/** Where every node of the net is seen at `time`, how far out, and how much of an edge to it would show, into the scratch. */
function seeNodes(net: CageNet, scratch: number[], time: number) {
  'worklet';
  const yaw = bodyTurnRadians(time);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const seen = net.slots.seen;
  for (let node = 0; node < net.count; node++) {
    const at = seen + node * SEEN_NUMBERS;
    seeNode(net, node, time, cos, sin, scratch, at);
    const reach = Math.hypot(scratch[at], scratch[at + 1]);
    scratch[at + 3] = reach;
    scratch[at + 4] = seenShare(reach);
  }
}

/**
 * How far his body turns, in radians, from a pulse's start to the first and the last moment an edge
 * it lights at each hop may be lit ({@link litFrom}, {@link litUntil}), and their cosines and sines:
 * {@link LIT_TURN_NUMBERS} a hop, the pulse out's hops first, then the return's.
 */
const LIT_TURN_NUMBERS = 6;
const LIT_TURNS: readonly number[] = [OUT_PULSE, RETURN_PULSE].flatMap((pulse) =>
  Array.from({ length: CASCADE_OUT_HOPS + 1 }, (_, hop) => {
    const first = BODY_RADIANS_PER_SECOND * litFrom(pulse, hop);
    const last = BODY_RADIANS_PER_SECOND * litUntil(pulse, hop);
    return [first, Math.cos(first), Math.sin(first), last, Math.cos(last), Math.sin(last)];
  }).flat(),
);

/**
 * Whether a node is seen out past his limb ({@link CASCADE_LIMB}) and not far behind him
 * ({@link CASCADE_DEEPEST}) at every moment of a stretch his body turns it over, however it sways
 * meanwhile: the cosines and sines of how far round the vertical it is, from straight out to his
 * right, at the start and the end of the stretch are in the scratch at {@link TURNS}.
 *
 * His turn carries it round the vertical: seen flat its x is its distance from the axis times the
 * cosine of how far round it is, and its depth minus the sine. No stretch turns him half a turn
 * (`cage-cascade.spec.ts`), so the nearest it comes to his middle is at an end of the stretch, or
 * nought where the cosine changes sign between them, and the deepest at an end, or all the way back
 * where the cosine goes from positive to negative. Its sway can take it {@link SWAY_SEEN} nearer
 * still, and {@link SWAY_DEEPER} deeper, whatever the moment.
 */
function clearBetween(net: CageNet, node: number, scratch: number[]) {
  'worklet';
  const radius = net.turnRadius[node];
  const height = net.nodes[node * 3 + 1];
  const firstCos = scratch[TURNS];
  const lastCos = scratch[TURNS + 2];
  const nearestCos = firstCos * lastCos <= 0 ? 0 : Math.min(Math.abs(firstCos), Math.abs(lastCos));
  const nearestAside = radius * nearestCos;
  if (nearestAside * nearestAside + height * height < LIMB_CLEAR_OF_SWAY * LIMB_CLEAR_OF_SWAY) return false;
  const passesBehind = firstCos > 0 && lastCos < 0;
  const mostBehind = passesBehind ? 1 : Math.max(scratch[TURNS + 1], scratch[TURNS + 3]);
  return -radius * mostBehind - SWAY_DEEPER >= CASCADE_DEEPEST;
}

/** Whether a node is clear of him from `from` to `until` ({@link clearBetween}). */
function clearOver(net: CageNet, scratch: number[], node: number, from: number, until: number) {
  'worklet';
  const phase = net.turnPhase[node];
  const first = bodyTurnRadians(from) - phase;
  const last = bodyTurnRadians(until) - phase;
  scratch[TURNS] = Math.cos(first);
  scratch[TURNS + 1] = Math.sin(first);
  scratch[TURNS + 2] = Math.cos(last);
  scratch[TURNS + 3] = Math.sin(last);
  return clearBetween(net, node, scratch);
}

/**
 * Starts judging, for a pulse starting at `start`, for which of its hops each node is clear of him
 * ({@link clearAtHop}): no node's judgement so far counts any longer, and each is judged the first
 * time a spread asks, since most of the net never is.
 */
function judgeClearance(scratch: number[], pulse: number, start: number) {
  'worklet';
  scratch[JUDGEMENT + pulse] += 1;
  scratch[JUDGED_TURN + pulse] = bodyTurnRadians(start);
}

/**
 * For which of a pulse's hops a node is clear of him ({@link clearBetween}) for as long as an edge
 * it lights at that hop may be lit ({@link LIT_TURNS}), from the pulse's start that
 * {@link judgeClearance} last took: a bit a hop, into the scratch. His body turns at a steady rate,
 * so how far round the node is at each moment comes from where it is at the start, turned on by the
 * table's angles, rather than from a cosine and a sine of its own at every one.
 */
function judgeNode(net: CageNet, scratch: number[], pulse: number, node: number) {
  'worklet';
  const hops = pulse === OUT_PULSE ? CASCADE_OUT_HOPS : CASCADE_RETURN_HOPS;
  const round = scratch[JUDGED_TURN + pulse] - net.turnPhase[node];
  const cos = Math.cos(round);
  const sin = Math.sin(round);
  let bits = 0;
  for (let hop = 1; hop <= hops; hop++) {
    const at = (pulse * (CASCADE_OUT_HOPS + 1) + hop) * LIT_TURN_NUMBERS;
    scratch[TURNS] = cos * LIT_TURNS[at + 1] - sin * LIT_TURNS[at + 2];
    scratch[TURNS + 1] = sin * LIT_TURNS[at + 1] + cos * LIT_TURNS[at + 2];
    scratch[TURNS + 2] = cos * LIT_TURNS[at + 4] - sin * LIT_TURNS[at + 5];
    scratch[TURNS + 3] = sin * LIT_TURNS[at + 4] + cos * LIT_TURNS[at + 5];
    if (clearBetween(net, node, scratch)) bits += 2 ** hop;
  }
  scratch[net.slots.clear[pulse] + node] = bits;
  scratch[net.slots.judged[pulse] + node] = scratch[JUDGEMENT + pulse];
}

/** Whether a node is clear of him for an edge a pulse lights at `hop` (see {@link judgeNode}). */
function clearAtHop(net: CageNet, scratch: number[], pulse: number, node: number, hop: number) {
  'worklet';
  if (scratch[net.slots.judged[pulse] + node] !== scratch[JUDGEMENT + pulse]) judgeNode(net, scratch, pulse, node);
  return (scratch[net.slots.clear[pulse] + node] & (2 ** hop)) !== 0;
}

/**
 * The box of the truss a node seen at `at` in the scratch is over at `time`, as its first clock
 * degree in the truss's own frame (before its roll), or -1 when it is not over one of its stretches.
 */
function boxAt(scratch: number[], at: number, time: number) {
  'worklet';
  const x = scratch[at];
  const y = scratch[at + 1];
  const radius = Math.hypot(x, y);
  if (radius < CASCADE_FOOT_INNER || radius > CASCADE_FOOT_OUTER) return -1;
  if (scratch[at + 2] < CASCADE_DEEPEST) return -1;
  const clock = (((Math.atan2(x, -y) / DEGREES - time * RIM_ROLL_DEGREES_PER_SECOND) % 360) + 360) % 360;
  for (let stretch = 0; stretch < TRUSS_ARCS.length; stretch++) {
    const from = TRUSS_ARCS[stretch][0];
    const sweep = TRUSS_ARCS[stretch][1];
    if (clock < from || clock > from + sweep) continue;
    const box = sweep / TRUSS_ARCS[stretch][2];
    return from + Math.floor((clock - from) / box) * box;
  }
  return -1;
}

/** How many degrees wide the truss's box starting at clock degree `first` is (see {@link boxAt}). */
function boxSweep(first: number) {
  'worklet';
  for (let stretch = 0; stretch < TRUSS_ARCS.length; stretch++) {
    const from = TRUSS_ARCS[stretch][0];
    if (first >= from - 1e-6 && first <= from + TRUSS_ARCS[stretch][1])
      return TRUSS_ARCS[stretch][1] / TRUSS_ARCS[stretch][2];
  }
  return 0;
}

/** Whether an edge seen from one point to another, x and y down in R, is a spoke ({@link CASCADE_SPOKE}). */
function isSpokeBetween(fromX: number, fromY: number, toX: number, toY: number) {
  'worklet';
  const runX = toX - fromX;
  const runY = toY - fromY;
  const middleX = (fromX + toX) / 2;
  const middleY = (fromY + toY) / 2;
  const scale = Math.hypot(runX, runY) * Math.hypot(middleX, middleY);
  const outward = scale > 0 ? Math.abs(runX * middleX + runY * middleY) / scale : 0;
  return outward > CASCADE_SPOKE && Math.max(Math.hypot(fromX, fromY), Math.hypot(toX, toY)) > CASCADE_SPOKE_REACH;
}

/**
 * Whether the edge a spread of `pulse` reached `node` by from `root` is, seen at the fire, a spoke
 * out to a node it reached nothing else beside: a lit stick standing out into the dark, which does
 * not count towards how much of it shows.
 */
function deadEndSpoke(net: CageNet, scratch: number[], pulse: number, root: number, node: number) {
  'worklet';
  const seen = net.slots.seen;
  const rootAt = seen + root * SEEN_NUMBERS;
  const nodeAt = seen + node * SEEN_NUMBERS;
  if (!isSpokeBetween(scratch[rootAt], scratch[rootAt + 1], scratch[nodeAt], scratch[nodeAt + 1])) return false;
  if (scratch[nodeAt + 3] < scratch[rootAt + 3]) return false;
  let lit = 0;
  for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++)
    if (hopOf(net, scratch, pulse, net.links[link]) >= 0) lit++;
  return lit <= 1;
}

/**
 * The neighbour of `node`, reached at `hop`, that a spread of `pulse` lights next: of those not yet
 * reached, not reached by the pulse out if this is the return, and clear of him with `node` for as
 * long as the edge between them would be lit ({@link judgeClearance}), the one whose edge ends most
 * where it shows ({@link seenShare}) and runs most nearly round his edge, give or take a little from
 * the hash so that two spreads from one node need not branch alike: out among the cage's triangles
 * against the dark, along his silhouette. -1 when none is open.
 */
function nextAlongHisEdge(net: CageNet, scratch: number[], node: number, hop: number, seed: number, pulse: number) {
  'worklet';
  const seen = net.slots.seen;
  if (!clearAtHop(net, scratch, pulse, node, hop + 1)) return -1;
  const fromX = scratch[seen + node * SEEN_NUMBERS];
  const fromY = scratch[seen + node * SEEN_NUMBERS + 1];
  let best = -1;
  let bestScore = -1;
  for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++) {
    const neighbour = net.links[link];
    if (!clearAtHop(net, scratch, pulse, neighbour, hop + 1) || hopOf(net, scratch, pulse, neighbour) >= 0) continue;
    if (pulse === RETURN_PULSE && hopOf(net, scratch, OUT_PULSE, neighbour) >= 0) continue;
    const at = seen + neighbour * SEEN_NUMBERS;
    const toX = scratch[at];
    const toY = scratch[at + 1];
    const runX = toX - fromX;
    const runY = toY - fromY;
    const middleX = (fromX + toX) / 2;
    const middleY = (fromY + toY) / 2;
    const run = Math.hypot(runX, runY);
    const middle = Math.hypot(middleX, middleY);
    if (run <= 0 || middle <= 0) continue;
    const outward = Math.abs(runX * middleX + runY * middleY) / (run * middle);
    const round = Math.sqrt(Math.max(0, 1 - outward * outward));
    const score =
      CASCADE_ROUND_HIM * round +
      CASCADE_OUT_WHERE_SEEN * scratch[at + 4] +
      CASCADE_CHOICE_JITTER * cascadeHash(seed + neighbour * SALT_NEXT_NODE);
    if (score > bestScore) {
      best = neighbour;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A breadth-first spread of `pulse` over the net from `start`, as many hops deep and over as many
 * edges as that pulse goes, each node reached lighting up to {@link CASCADE_BRANCHES} of its
 * neighbours onward ({@link CASCADE_FIRST_BRANCHES} from the start), those running most nearly round
 * his edge first ({@link nextAlongHisEdge}). How many hops each node was reached in, which node it
 * was reached from and the order they were reached in go into the scratch, and how many it reached,
 * the start among them, and how deep.
 */
function spread(net: CageNet, scratch: number[], start: number, seed: number, pulse: number) {
  'worklet';
  const slots = net.slots;
  const hops = slots.hops[pulse];
  const stamps = slots.stamps[pulse];
  const queue = slots.queue;
  const reachedFrom = slots.reachedFrom;
  const generation = scratch[GENERATION] + 1;
  scratch[GENERATION] = generation;
  scratch[PULSE_GENERATION + pulse] = generation;
  const depth = pulse === OUT_PULSE ? CASCADE_OUT_HOPS : CASCADE_RETURN_HOPS;
  const most = pulse === OUT_PULSE ? CASCADE_OUT_EDGES : CASCADE_RETURN_EDGES;
  scratch[hops + start] = 0;
  scratch[stamps + start] = generation;
  scratch[reachedFrom + start] = -1;
  scratch[queue] = start;
  let reached = 1;
  let deepest = 0;
  for (let next = 0; next < reached && reached <= most; next++) {
    const node = scratch[queue + next];
    const hop = scratch[hops + node];
    if (hop >= depth) continue;
    const branches = hop === 0 ? CASCADE_FIRST_BRANCHES : CASCADE_BRANCHES;
    for (let lit = 0; lit < branches && reached <= most; lit++) {
      const neighbour = nextAlongHisEdge(net, scratch, node, hop, seed, pulse);
      if (neighbour < 0) break;
      scratch[hops + neighbour] = hop + 1;
      scratch[stamps + neighbour] = generation;
      scratch[reachedFrom + neighbour] = node;
      scratch[queue + reached] = neighbour;
      deepest = Math.max(deepest, hop + 1);
      reached++;
    }
  }
  scratch[REACHED] = reached;
  scratch[DEEPEST] = deepest;
}

/**
 * How much of the edges the latest spread of `pulse` lit shows, seen at the fire, in R, less the
 * spokes out to nothing ({@link deadEndSpoke}): each piece of each edge counted by how much of it
 * shows where it is seen ({@link seenShare}), as the truss and his bright edge drown what lies over
 * them.
 */
function seenLength(net: CageNet, scratch: number[], pulse: number) {
  'worklet';
  const { seen, queue, reachedFrom } = net.slots;
  const reached = scratch[REACHED];
  let shown = 0;
  for (let place = 1; place < reached; place++) {
    const node = scratch[queue + place];
    const root = scratch[reachedFrom + node];
    if (deadEndSpoke(net, scratch, pulse, root, node)) continue;
    const startX = scratch[seen + root * SEEN_NUMBERS];
    const startY = scratch[seen + root * SEEN_NUMBERS + 1];
    const runX = scratch[seen + node * SEEN_NUMBERS] - startX;
    const runY = scratch[seen + node * SEEN_NUMBERS + 1] - startY;
    const piece = Math.hypot(runX, runY) / CASCADE_SEEN_STEPS;
    for (let step = 0; step < CASCADE_SEEN_STEPS; step++) {
      const share = (step + 0.5) / CASCADE_SEEN_STEPS;
      shown += piece * seenShare(Math.hypot(startX + runX * share, startY + runY * share));
    }
  }
  return shown;
}

/**
 * How much of the latest spread out would show ({@link seenLength}), or -1 when it did not spread
 * wide and far enough ({@link CASCADE_FEWEST_EDGES}, {@link CASCADE_FEWEST_HOPS}).
 */
function measureOut(net: CageNet, scratch: number[]) {
  'worklet';
  if (scratch[REACHED] - 1 < CASCADE_FEWEST_EDGES || scratch[DEEPEST] < CASCADE_FEWEST_HOPS) return -1;
  return seenLength(net, scratch, OUT_PULSE);
}

/** One lit edge into the plan: its spark from node `from` to node `to`, leaving at `leaves`, fading from `fades`. */
function planEdge(scratch: number[], from: number, to: number, leaves: number, fades: number, kind: number) {
  'worklet';
  if (scratch[EDGE_COUNT] >= CASCADE_EDGES) return;
  const at = EDGES + scratch[EDGE_COUNT] * EDGE_SLOT;
  scratch[at + EDGE_FROM] = from;
  scratch[at + EDGE_TO] = to;
  scratch[at + EDGE_LEAVES] = leaves;
  scratch[at + EDGE_FADES] = fades;
  scratch[at + EDGE_KIND] = kind;
  scratch[at + EDGE_OUTER_ENDS] = 0;
  scratch[at + EDGE_DROPPED] = 0;
  scratch[EDGE_COUNT] += 1;
}

/**
 * The edges of the cage between two nodes the pulse out reached that it did not reach either by:
 * each lit a hop after the later of its nodes, its spark from the node reached first, so the pulse
 * lights the patch's triangles whole rather than a bare tree — the net lighting up, not a branch —
 * each only where both its nodes stay clear of him for as long as it is lit ({@link clearOver}).
 */
function planClosingEdges(net: CageNet, scratch: number[], fires: number, spreadOut: number) {
  'worklet';
  const { reachedFrom, queue } = net.slots;
  const reached = scratch[REACHED];
  let closed = 0;
  for (let place = 0; place < reached && closed < CASCADE_CLOSING_EDGES; place++) {
    const node = scratch[queue + place];
    const hop = hopOf(net, scratch, OUT_PULSE, node);
    for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++) {
      const other = net.links[link];
      const otherHop = hopOf(net, scratch, OUT_PULSE, other);
      // each edge once, from its node reached first (or, reached in the same hop, the lower numbered)
      const fromHere = otherHop > hop || (otherHop === hop && other > node);
      const byTheTree = scratch[reachedFrom + other] === node || scratch[reachedFrom + node] === other;
      if (otherHop < 0 || !fromHere || byTheTree || closed >= CASCADE_CLOSING_EDGES) continue;
      const leaves = fires + otherHop * CASCADE_HOP_SECONDS;
      const fades = spreadOut + CASCADE_HOLD_SECONDS + otherHop * CASCADE_FADE_STEP;
      const out = fades + CASCADE_FADE_SECONDS;
      if (!clearOver(net, scratch, node, leaves, out) || !clearOver(net, scratch, other, leaves, out)) continue;
      closed++;
      planEdge(scratch, node, other, leaves, fades, OUT_PULSE);
    }
  }
}

/**
 * The latest spread out into the plan, as firing at `fires`: every node it reached lights the edge
 * it was reached by, its spark leaving as the spark before it lands; then its closing edges.
 */
function planOut(net: CageNet, scratch: number[], fires: number) {
  'worklet';
  const { reachedFrom, queue, hops } = net.slots;
  // the edges closing its triangles land a hop after the later of their nodes is lit
  const spreadOut = fires + (scratch[DEEPEST] + 1) * CASCADE_HOP_SECONDS;
  scratch[SPREAD_OUT] = spreadOut;
  for (let place = 1; place < scratch[REACHED]; place++) {
    const node = scratch[queue + place];
    const hop = scratch[hops[OUT_PULSE] + node];
    const fades = spreadOut + CASCADE_HOLD_SECONDS + (hop - 1) * CASCADE_FADE_STEP;
    planEdge(scratch, scratch[reachedFrom + node], node, fires + (hop - 1) * CASCADE_HOP_SECONDS, fades, OUT_PULSE);
  }
  planClosingEdges(net, scratch, fires, spreadOut);
}

/**
 * How well the latest spread of a return answers the pulse out, or 0 when it lights too few edges
 * ({@link CASCADE_FEWEST_RETURN_EDGES}) or too little of it shows: how much of it shows, and more for
 * each of its nodes beside one the pulse out reached ({@link CASCADE_BESIDE}), so the return gathers
 * from the patch.
 */
function measureReturn(net: CageNet, scratch: number[]) {
  'worklet';
  const reached = scratch[REACHED];
  if (reached - 1 < CASCADE_FEWEST_RETURN_EDGES) return 0;
  const queue = net.slots.queue;
  let beside = 0;
  for (let place = 1; place < reached; place++) {
    const node = scratch[queue + place];
    for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++) {
      if (hopOf(net, scratch, OUT_PULSE, net.links[link]) >= 0) {
        beside++;
        break;
      }
    }
  }
  const shown = seenLength(net, scratch, RETURN_PULSE);
  if (shown < CASCADE_FEWEST_RETURN_SEEN) return 0;
  return shown + CASCADE_BESIDE * beside;
}

/**
 * The latest spread of a return into the plan, gathering from `gathers`, run backwards: its sparks
 * leaving its tips first and converging hop by hop onto its start, every branch landing together,
 * when it lands going into the scratch.
 */
function planReturn(net: CageNet, scratch: number[], gathers: number) {
  'worklet';
  const { reachedFrom, queue, hops } = net.slots;
  const deepest = scratch[DEEPEST];
  const lands = gathers + deepest * CASCADE_HOP_SECONDS;
  scratch[LANDS] = lands;
  for (let place = 1; place < scratch[REACHED]; place++) {
    const node = scratch[queue + place];
    const hop = scratch[hops[RETURN_PULSE] + node];
    const leaves = gathers + (deepest - hop) * CASCADE_HOP_SECONDS;
    const fades = lands + CASCADE_HOLD_SECONDS + (hop - 1) * CASCADE_FADE_STEP;
    planEdge(scratch, node, scratch[reachedFrom + node], leaves, fades, RETURN_PULSE);
  }
}

/**
 * The node over the truss to fire a pulse from at `fires`: the one whose pulse out would show most
 * ({@link measureOut}), give or take the hash ({@link CASCADE_SOURCE_CHOICE}) so that it is not always
 * the same; -1 when none would spread far enough or show for {@link CASCADE_FEWEST_SEEN}.
 */
function bestSource(net: CageNet, scratch: number[], fires: number, seed: number) {
  'worklet';
  const seen = net.slots.seen;
  seeNodes(net, scratch, fires);
  judgeClearance(scratch, OUT_PULSE, fires);
  let best = -1;
  let bestScore = 0;
  for (let node = 0; node < net.count; node++) {
    if (boxAt(scratch, seen + node * SEEN_NUMBERS, fires) < 0) continue;
    spread(net, scratch, node, seed, OUT_PULSE);
    const shown = measureOut(net, scratch);
    if (shown < CASCADE_FEWEST_SEEN) continue;
    const choice = cascadeHash(seed + node * SALT_SOURCE_NODE);
    const score = shown * (1 - CASCADE_SOURCE_CHOICE + 2 * CASCADE_SOURCE_CHOICE * choice);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

/** The box of the truss, other than `sourceBox`, that `target` is over at `lands` (see {@link boxAt}), or -1. */
function landingBox(net: CageNet, scratch: number[], target: number, lands: number, sourceBox: number) {
  'worklet';
  const yaw = bodyTurnRadians(lands);
  seeNode(net, target, lands, Math.cos(yaw), Math.sin(yaw), scratch, SEEN_FIRST);
  const box = boxAt(scratch, SEEN_FIRST, lands);
  return box === sourceBox ? -1 : box;
}

/** Whether a return onto `target`, however deep it turns out, could land over a box of its own ({@link landingBox}). */
function mayLandOn(net: CageNet, scratch: number[], target: number, gathers: number, sourceBox: number) {
  'worklet';
  for (let deepest = 1; deepest <= CASCADE_RETURN_HOPS; deepest++)
    if (landingBox(net, scratch, target, gathers + deepest * CASCADE_HOP_SECONDS, sourceBox) >= 0) return true;
  return false;
}

/**
 * The return, gathering from `gathers`, onto the node never reached by the pulse out that lands
 * over another box of the truss — where the box will be, and the node, as it lands
 * ({@link landingBox}) — whose return answers best ({@link measureReturn}) and lands nearest the box
 * that fired ({@link CASCADE_NEARBY}), so the answer is seen coming back beside the question rather
 * than on his far side; none when none lights enough edges.
 */
function planBestReturn(net: CageNet, scratch: number[], source: number, gathers: number, seed: number) {
  'worklet';
  const seen = net.slots.seen;
  const sourceBox = scratch[SOURCE_BOX];
  const returnSeed = seed + SALT_RETURN;
  let best = -1;
  let bestBox = -1;
  let bestAnswer = 0;
  for (let target = 0; target < net.count; target++) {
    // one the pulse out reached, or where no edge from it could be lit, is no target
    const clearToGather = clearAtHop(net, scratch, RETURN_PULSE, target, 1);
    if (!clearToGather || hopOf(net, scratch, OUT_PULSE, target) >= 0) continue;
    if (!mayLandOn(net, scratch, target, gathers, sourceBox)) continue;
    spread(net, scratch, target, returnSeed, RETURN_PULSE);
    const answer = measureReturn(net, scratch);
    if (answer <= 0) continue;
    const box = landingBox(net, scratch, target, gathers + scratch[DEEPEST] * CASCADE_HOP_SECONDS, sourceBox);
    if (box < 0) continue;
    const apart = Math.hypot(
      scratch[seen + target * SEEN_NUMBERS] - scratch[seen + source * SEEN_NUMBERS],
      scratch[seen + target * SEEN_NUMBERS + 1] - scratch[seen + source * SEEN_NUMBERS + 1],
    );
    const nearby = answer / (1 + CASCADE_NEARBY * apart);
    if (nearby > bestAnswer) {
      best = target;
      bestBox = box;
      bestAnswer = nearby;
    }
  }
  if (best < 0) return;
  spread(net, scratch, best, returnSeed, RETURN_PULSE);
  scratch[TARGET] = best;
  scratch[TARGET_BOX] = bestBox;
  planReturn(net, scratch, gathers);
}

/**
 * Looks at every planned edge every {@link CASCADE_SPOKE_LOOKS} seconds of the time it is lit, its
 * ends at both moments among them, where its nodes are seen then, and marks which of its ends is its
 * outer one at any look that finds it a spoke ({@link isSpokeBetween}). An edge whose nodes are both
 * too near him ever to be seen past {@link CASCADE_SPOKE_REACH}, swayed as they may be, never is one.
 */
function markSpokeEnds(net: CageNet, scratch: number[]) {
  'worklet';
  const count = scratch[EDGE_COUNT];
  for (let edge = 0; edge < count; edge++) {
    const at = EDGES + edge * EDGE_SLOT;
    const from = scratch[at + EDGE_FROM];
    const to = scratch[at + EDGE_TO];
    if (Math.max(net.reach[from], net.reach[to]) + SWAY_SEEN <= CASCADE_SPOKE_REACH) continue;
    const leaves = scratch[at + EDGE_LEAVES];
    const lit = scratch[at + EDGE_FADES] + CASCADE_FADE_SECONDS - leaves;
    const looks = Math.ceil(lit / CASCADE_SPOKE_LOOKS);
    let outerEnds = 0;
    for (let look = 0; look <= looks; look++) {
      const time = leaves + (lit * look) / looks;
      const yaw = bodyTurnRadians(time);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      seeNode(net, from, time, cos, sin, scratch, SEEN_FIRST);
      seeNode(net, to, time, cos, sin, scratch, SEEN_SECOND);
      const fromX = scratch[SEEN_FIRST];
      const fromY = scratch[SEEN_FIRST + 1];
      const toX = scratch[SEEN_SECOND];
      const toY = scratch[SEEN_SECOND + 1];
      if (!isSpokeBetween(fromX, fromY, toX, toY)) continue;
      outerEnds |= Math.hypot(toX, toY) > Math.hypot(fromX, fromY) ? 2 : 1;
    }
    scratch[at + EDGE_OUTER_ENDS] = outerEnds;
  }
}

/** How many of the plan's edges, dropped ones aside, end on `node`. */
function edgesAt(scratch: number[], node: number) {
  'worklet';
  let touching = 0;
  for (let edge = 0; edge < scratch[EDGE_COUNT]; edge++) {
    const at = EDGES + edge * EDGE_SLOT;
    if (scratch[at + EDGE_DROPPED] > 0) continue;
    if (scratch[at + EDGE_FROM] === node || scratch[at + EDGE_TO] === node) touching++;
  }
  return touching;
}

/** Takes the plan's dropped edges out of it, keeping the rest in order. */
function compactEdges(scratch: number[]) {
  'worklet';
  let kept = 0;
  for (let edge = 0; edge < scratch[EDGE_COUNT]; edge++) {
    const at = EDGES + edge * EDGE_SLOT;
    if (scratch[at + EDGE_DROPPED] > 0) continue;
    const keptAt = EDGES + kept * EDGE_SLOT;
    for (let number = 0; number < EDGE_SLOT; number++) scratch[keptAt + number] = scratch[at + number];
    kept++;
  }
  scratch[EDGE_COUNT] = kept;
}

/**
 * Takes out of the plan every edge that is ever a spoke ({@link markSpokeEnds}) whose outer node then
 * no other planned edge reaches: a lit stick standing out into the dark on its own, which read as
 * something growing out of him. Over and over, until a pass takes out none, as taking one out can
 * leave another alone.
 */
function dropLoneSpokes(scratch: number[]) {
  'worklet';
  for (let dropping = true; dropping; ) {
    dropping = false;
    for (let edge = 0; edge < scratch[EDGE_COUNT]; edge++) {
      const at = EDGES + edge * EDGE_SLOT;
      const outerEnds = scratch[at + EDGE_OUTER_ENDS];
      const loneFrom = (outerEnds & 1) !== 0 && edgesAt(scratch, scratch[at + EDGE_FROM]) <= 1;
      const loneTo = (outerEnds & 2) !== 0 && edgesAt(scratch, scratch[at + EDGE_TO]) <= 1;
      if (!loneFrom && !loneTo) continue;
      scratch[at + EDGE_DROPPED] = 1;
      dropping = true;
    }
    compactEdges(scratch);
  }
}

/**
 * Takes the return out of the plan, and its box, when what is left of it after
 * {@link dropLoneSpokes} lights fewer than {@link CASCADE_FEWEST_RETURN_EDGES} edges or none landing
 * on its target: a stray flicker, not an answer.
 */
function dropThinReturn(scratch: number[]) {
  'worklet';
  let edges = 0;
  let landing = 0;
  for (let edge = 0; edge < scratch[EDGE_COUNT]; edge++) {
    const at = EDGES + edge * EDGE_SLOT;
    if (scratch[at + EDGE_KIND] !== RETURN_PULSE) continue;
    edges++;
    if (scratch[at + EDGE_TO] === scratch[TARGET]) landing++;
  }
  if (scratch[TARGET] < 0 || (edges >= CASCADE_FEWEST_RETURN_EDGES && landing > 0)) return;
  for (let edge = 0; edge < scratch[EDGE_COUNT]; edge++) {
    const at = EDGES + edge * EDGE_SLOT;
    if (scratch[at + EDGE_KIND] === RETURN_PULSE) scratch[at + EDGE_DROPPED] = 1;
  }
  compactEdges(scratch);
  scratch[TARGET] = -1;
  scratch[TARGET_BOX] = -1;
  scratch[LANDS] = -1;
}

/** Where the scratch keeps when chance `chance` fires and from which node ({@link findSource}). */
function sourceOf(chance: number) {
  'worklet';
  return SOURCES + (((chance % SOURCES_KEPT) + SOURCES_KEPT) % SOURCES_KEPT) * SOURCE_NUMBERS;
}

/**
 * Whether the pulse out from `source` at `fires` still leaves it once its plan is cut back
 * ({@link dropLoneSpokes}): the source can be the outer node of a spoke out of it that nothing else
 * reaches, and with that spoke dropped its box would flare with nothing leaving it, the pulse
 * starting a hop away. The return never touches a node the pulse out reached, so the pulse out alone
 * says. It plans into the scratch's plan, which {@link planChance} plans afresh after.
 */
function leavesItsSource(net: CageNet, scratch: number[], source: number, fires: number, seed: number) {
  'worklet';
  spread(net, scratch, source, seed, OUT_PULSE);
  scratch[EDGE_COUNT] = 0;
  planOut(net, scratch, fires);
  markSpokeEnds(net, scratch);
  dropLoneSpokes(scratch);
  return edgesAt(scratch, source) > 0;
}

/**
 * Works out when chance `chance` fires and from which node into the scratch ({@link sourceOf}),
 * unless it is already there: the best at its first try ({@link bestSource}), or, where no node
 * would do or the pulse out of it would not leave it ({@link leavesItsSource}), at a try
 * {@link CASCADE_RETRY_SECONDS} later as the cage turns, up to {@link CASCADE_RETRIES} times; -1 for
 * both when none would. A chance between two that always fire asks it of both of them, and they of
 * it in turn, so each chance's is kept for the next to read.
 */
function findSource(net: CageNet, scratch: number[], chance: number) {
  'worklet';
  const at = sourceOf(chance);
  if (scratch[at] === chance + 1) return;
  const seed = chanceSeed(chance);
  const firstTry = chance * CASCADE_PERIOD + cascadeHash(seed + SALT_FIRES) * CASCADE_JITTER;
  scratch[at] = chance + 1;
  scratch[at + 1] = -1;
  scratch[at + 2] = -1;
  for (let attempt = 0; attempt <= CASCADE_RETRIES; attempt++) {
    const fires = firstTry + attempt * CASCADE_RETRY_SECONDS;
    const source = bestSource(net, scratch, fires, seed);
    if (source < 0 || !leavesItsSource(net, scratch, source, fires, seed)) continue;
    scratch[at + 1] = fires;
    scratch[at + 2] = source;
    return;
  }
}

/** Whether chance `chance` finds a node to fire from: what {@link findSource} keeps, worked out first if it is not kept yet. */
function chanceFinds(net: CageNet, scratch: number[], chance: number) {
  'worklet';
  findSource(net, scratch, chance);
  return scratch[sourceOf(chance) + 2] >= 0;
}

/**
 * Works out the plan of chance `chance` into the scratch: when it fires and whether it does, and if
 * so, from which node over the truss and down which edges, then onto which other box the return
 * gathers. Every other chance fires whatever he is doing; of the ones between, the hash's
 * {@link CASCADE_IN_SILENCE} share does too, and so does one beside a chance that finds nothing to
 * fire from ({@link findSource}), and the rest only while he is busy. So in silence no two are
 * further apart than two chances.
 */
function planChance(net: CageNet, scratch: number[], chance: number) {
  'worklet';
  const seed = chanceSeed(chance);
  const chosen = chance % 2 === 0 || cascadeHash(seed + SALT_IN_SILENCE) < CASCADE_IN_SILENCE;
  const neighbourLost = !chosen && (!chanceFinds(net, scratch, chance - 1) || !chanceFinds(net, scratch, chance + 1));
  // found before the plan is cleared, as finding a source plans into it (leavesItsSource)
  const finds = chanceFinds(net, scratch, chance);
  scratch[PLANNED] = chance + 1;
  scratch[ONLY_WHILE_BUSY] = chosen || neighbourLost ? 0 : 1;
  scratch[EDGE_COUNT] = 0;
  scratch[SOURCE_BOX] = -1;
  scratch[TARGET_BOX] = -1;
  scratch[TARGET] = -1;
  scratch[LANDS] = -1;
  if (!finds) return;
  const fires = scratch[sourceOf(chance) + 1];
  const source = scratch[sourceOf(chance) + 2];
  scratch[FIRES] = fires;
  // where the cage is as it fires, which the search for a neighbour's source may have moved on
  seeNodes(net, scratch, fires);
  judgeClearance(scratch, OUT_PULSE, fires);
  scratch[SOURCE_BOX] = boxAt(scratch, net.slots.seen + source * SEEN_NUMBERS, fires);
  spread(net, scratch, source, seed, OUT_PULSE);
  planOut(net, scratch, fires);
  // the return starts gathering as the pulse out reaches its tips, while its triangles close
  const gathers = scratch[SPREAD_OUT] - CASCADE_HOP_SECONDS;
  judgeClearance(scratch, RETURN_PULSE, gathers);
  planBestReturn(net, scratch, source, gathers, seed);
  markSpokeEnds(net, scratch);
  dropLoneSpokes(scratch);
  dropThinReturn(scratch);
}

/**
 * How lit the current chance is: one fired whatever he does is all lit; one fired only while he
 * talks or thinks is as lit as he is busy, eased, so it never vanishes mid-way as it would if whether
 * it fired changed with him. Nothing before he has formed, nor once he has begun to leave.
 */
function chanceLight(onlyWhileBusy: number, state: CascadeFrame) {
  'worklet';
  const busy = Math.max(state.talk, state.thinking);
  const fired = onlyWhileBusy > 0 ? smoothStep((busy - CASCADE_BUSY_FROM) / CASCADE_BUSY_EASE) : 1;
  return fired * smoothStep((state.swirl - CASCADE_FORMED_FROM) / CASCADE_FORMED_EASE);
}

/**
 * One of the two boxes' numbers into `out` (see {@link CASCADE_BOX_SLOTS}): lit only while it flares,
 * from `flares` for {@link CASCADE_BOX_FLARE_SECONDS}, and nothing for a box that is not there (-1).
 */
function writeBox(out: Float32Array, slot: number, first: number, flares: number, light: number, time: number) {
  'worklet';
  const at = CASCADE_BOXES_AT + slot * CASCADE_BOX_NUMBERS;
  const flaring = time >= flares && time <= flares + CASCADE_BOX_FLARE_SECONDS;
  const lit = first >= 0 && flares >= 0 && light > 0 && flaring;
  out[at + CASCADE_BOX_SLOTS.first] = lit ? first : 0;
  out[at + CASCADE_BOX_SLOTS.sweep] = lit ? boxSweep(first) : 0;
  out[at + CASCADE_BOX_SLOTS.flares] = lit ? flares : 0;
  out[at + CASCADE_BOX_SLOTS.light] = lit ? light : 0;
}

/** Whether anything of the cascade {@link writeCageCascade} last wrote into `out` is lit: an edge or a box. */
export function anythingLit(out: Float32Array) {
  'worklet';
  for (let edge = 0; edge < CASCADE_EDGES; edge++)
    if (out[edge * CASCADE_EDGE_NUMBERS + CASCADE_EDGE_SLOTS.light] > 0) return true;
  for (let box = 0; box < 2; box++)
    if (out[CASCADE_BOXES_AT + box * CASCADE_BOX_NUMBERS + CASCADE_BOX_SLOTS.light] > 0) return true;
  return false;
}

/**
 * Where the cascade is this frame, for the picture to draw (`cascadeLayer`): for each of
 * {@link CASCADE_EDGES} edges, {@link CASCADE_EDGE_NUMBERS} numbers ({@link CASCADE_EDGE_SLOTS}) — an
 * edge whose spark has not left yet or that has gone out is not lit this frame, as well as one this
 * chance does not light — then, from {@link CASCADE_BOXES_AT}, the box the pulse fired from and the
 * box the return lands on ({@link CASCADE_BOX_SLOTS}). The picture turns the nodes with the cage and
 * the boxes with the truss, and works out where along its edge each spark is, and how far each flare
 * has got, from the frame's time.
 */
export function writeCageCascade(net: CageNet, state: CascadeFrame, scratch: number[], out: Float32Array) {
  'worklet';
  const time = state.time;
  const chance = Math.floor(time / CASCADE_PERIOD);
  if (scratch[PLANNED] !== chance + 1) planChance(net, scratch, chance);
  const count = scratch[EDGE_COUNT];
  const light = count > 0 ? chanceLight(scratch[ONLY_WHILE_BUSY], state) : 0;
  const slots = CASCADE_EDGE_SLOTS;
  for (let edge = 0; edge < CASCADE_EDGES; edge++) {
    const at = edge * CASCADE_EDGE_NUMBERS;
    const planned = EDGES + edge * EDGE_SLOT;
    const lit =
      edge < count &&
      light > 0 &&
      time >= scratch[planned + EDGE_LEAVES] &&
      time <= scratch[planned + EDGE_FADES] + CASCADE_FADE_SECONDS;
    if (!lit) {
      out[at + slots.light] = 0;
      continue;
    }
    const from = scratch[planned + EDGE_FROM] * 3;
    const to = scratch[planned + EDGE_TO] * 3;
    out[at + slots.from] = net.nodes[from];
    out[at + slots.from + 1] = net.nodes[from + 1];
    out[at + slots.from + 2] = net.nodes[from + 2];
    out[at + slots.leaves] = scratch[planned + EDGE_LEAVES];
    out[at + slots.to] = net.nodes[to];
    out[at + slots.to + 1] = net.nodes[to + 1];
    out[at + slots.to + 2] = net.nodes[to + 2];
    out[at + slots.fades] = scratch[planned + EDGE_FADES];
    out[at + slots.light] = light;
  }
  writeBox(out, 0, scratch[SOURCE_BOX], count > 0 ? scratch[FIRES] : -1, light, time);
  writeBox(out, 1, scratch[TARGET_BOX], scratch[LANDS], light, time);
}
