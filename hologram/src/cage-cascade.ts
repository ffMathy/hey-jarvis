import {
  bodyTurnRadians,
  CAGE_EDGE_STRIDE,
  CAGE_SWAY,
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
 * the cage already reaches. The picture draws it (`cascadeLayer` in `gpu/picture-layers.ts`) from
 * what {@link writeCageCascade} hands it each frame.
 *
 * Now and then: one chance a {@link CASCADE_PERIOD}. Every other one fires whatever he is doing, a
 * share ({@link CASCADE_IN_SILENCE}) of the ones between as well, and while he talks or thinks all of
 * them; so in silence no two are more than two periods apart. Each is over before the next chance
 * comes, so two never overlap. Which chance fires, when, from which node and down which edges all
 * come from the clock by a hash, so a frame at a time is always the same frame whatever was drawn
 * before it; the frame's scratch only keeps the current chance's plan, so it is worked out once
 * rather than every frame.
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
/** The share of the chances between the ones that always fire that fire in silence too. */
export const CASCADE_IN_SILENCE = 0.15;
/** How long a pulse takes over one edge of the cage, in seconds: slow enough to follow its spark. */
export const CASCADE_HOP_SECONDS = 0.24;
/** How many hops out from the box that fired the pulse spreads, and how many the return gathers over. */
export const CASCADE_OUT_HOPS = 5;
export const CASCADE_RETURN_HOPS = 3;
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
 * to the way out) with an end past {@link CASCADE_SPOKE_REACH}. Lit on its own, with nothing lit
 * beyond it, one stood out into the dark past the truss for a second and read as a stick growing
 * out of him, so a spread never lights one that ends in a node it lights nothing else from
 * ({@link deadEndSpoke}); one that leads on to a lit triangle reads as part of it.
 */
const CASCADE_SPOKE = 0.8;
const CASCADE_SPOKE_REACH = 1.08;
/** The fewest edges a return must light to be planned: fewer read as a stray flicker, not an answer. */
const CASCADE_FEWEST_RETURN_EDGES = 3;
export const CASCADE_OUT_EDGES = 18;
/** And how many more edges the pulse out may light closing the triangles of its patch ({@link planClosingEdges}). */
export const CASCADE_CLOSING_EDGES = 8;
export const CASCADE_RETURN_EDGES = 10;
export const CASCADE_EDGES = CASCADE_OUT_EDGES + CASCADE_CLOSING_EDGES + CASCADE_RETURN_EDGES;
/** The fewest edges a pulse out must light, and the fewest hops it must reach, to be fired at all. */
const CASCADE_FEWEST_EDGES = 5;
const CASCADE_FEWEST_HOPS = 3;
/**
 * How long the lit patch holds once the pulse has spread as far as it goes, how much later each hop
 * out starts to fade than the one before it — so it fades from where it started outward — and how
 * long each takes to go out, in seconds.
 */
export const CASCADE_HOLD_SECONDS = 0.3;
export const CASCADE_FADE_STEP = 0.1;
export const CASCADE_FADE_SECONDS = 0.3;
/**
 * How long a box of the truss flares when a pulse leaves it or a return lands on it, in seconds:
 * up quickly, and down over the rest.
 */
export const CASCADE_BOX_FLARE_SECONDS = 0.6;
/**
 * How far out, in R, a node must be seen for a pulse to light an edge to it — out past his limb,
 * where the cage is against the dark — and how far behind him it may be, as a share of R towards his
 * back. And how far out both ends of a cage edge must lie at rest for it to be walked at all: on the
 * cage's shell and weave, not an anchor down into the specks.
 */
const CASCADE_LIMB = 0.9;
const CASCADE_DEEPEST = -0.45;
const CASCADE_NODE_REACH = 0.95;
/** How far out, in R, a node a pulse leaves from or lands on must be seen: over the truss, from just inside its inner rail to just past its outer one. */
const CASCADE_FOOT_INNER = 0.91;
const CASCADE_FOOT_OUTER = 1.06;
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
/** What of a frame the cascades read: its clock, how busy he is and whether he has formed. */
export type CascadeFrame = Pick<HologramFrameState, 'time' | 'talk' | 'thinking' | 'swirl'>;
/** The numbers handed to the picture for each lit edge, and for each of the two boxes: see {@link writeCageCascade}. */
export const CASCADE_EDGE_NUMBERS = 12;
export const CASCADE_BOX_NUMBERS = 4;
/** Where the boxes' numbers start, after every edge's. */
export const CASCADE_BOXES_AT = CASCADE_EDGES * CASCADE_EDGE_NUMBERS;
/** How many numbers the picture reads in all, as vec4s. */
export const CASCADE_NUMBERS = CASCADE_BOXES_AT + 2 * CASCADE_BOX_NUMBERS;

const DEGREES = Math.PI / 180;

/**
 * The cage as a net a pulse can run over: its nodes at rest (x, y down, z towards the eye), and each
 * node's neighbours along the edges lit evenly along them — none of the spikes or trails — between
 * nodes {@link CASCADE_NODE_REACH} out or more. `firstLink[node]` to `firstLink[node + 1]` are its
 * neighbours in `links`.
 */
export interface CageNet {
  nodes: number[];
  firstLink: number[];
  links: number[];
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
  const reach = (offset: number) => Math.hypot(cage[offset], cage[offset + 1], cage[offset + 2]);
  for (let offset = 0; offset < cage.length; offset += CAGE_EDGE_STRIDE) {
    const evenlyLit = cage[offset + 9] === 1;
    if (!evenlyLit || reach(offset) < CASCADE_NODE_REACH || reach(offset + 3) < CASCADE_NODE_REACH) continue;
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
  return { nodes, firstLink, links };
}

/**
 * Where a frame's scratch keeps the current chance's plan: which chance it is (plus one, so a fresh
 * scratch of zeros holds none), when it fires, whether it fires whatever he does (0) or only while
 * he is busy (1), how many edges it lights, when the pulse out has spread as far as it goes, the box
 * it fired from, the box the return lands on (-1 none) and when it lands; then each edge's from
 * node, to node, when its spark leaves, when it starts to fade and whether it is the pulse out (0)
 * or the return (1); then, a node each, where it is seen, how many hops from the pulse's start it
 * was reached (-1 never), how many from the return's box, which node the return reached it from,
 * and the search's queue.
 */
const PLANNED = 0;
const FIRES = 1;
const ONLY_WHILE_BUSY = 2;
const EDGE_COUNT = 3;
const SPREAD_OUT = 4;
const SOURCE_BOX = 5;
const TARGET_BOX = 6;
const LANDS = 7;
const EDGES = 8;
const EDGE_SLOT = 5;
const NODE_SLOTS = EDGES + CASCADE_EDGES * EDGE_SLOT;

/** How many numbers the scratch handed to {@link writeCageCascade} must hold for a net of `nodes` nodes. */
export function cascadeScratchSize(net: CageNet) {
  return NODE_SLOTS + (net.firstLink.length - 1) * 7;
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

/**
 * Where every node of the net is seen at `time`, into the scratch: as the picture turns the cage's
 * nodes (`turnedNode` in `gpu/picture-layers.ts`), swayed about its place, then turned with his body.
 */
function seeNodes(net: CageNet, time: number, scratch: number[], seen: number) {
  'worklet';
  const yaw = bodyTurnRadians(time);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const nodes = net.nodes;
  for (let node = 0; node * 3 < nodes.length; node++) {
    const x = nodes[node * 3];
    const y = nodes[node * 3 + 1];
    const z = nodes[node * 3 + 2];
    const swayedX = x + CAGE_SWAY * Math.sin(time * 0.37 + y * 5.3 + z * 2.1);
    const swayedY = y + CAGE_SWAY * Math.sin(time * 0.29 + z * 4.9 + x * 3.3);
    const swayedZ = z + CAGE_SWAY * Math.sin(time * 0.33 + x * 4.1 + y * 2.7);
    scratch[seen + node * 3] = swayedX * cos + swayedZ * sin;
    scratch[seen + node * 3 + 1] = swayedY;
    scratch[seen + node * 3 + 2] = swayedZ * cos - swayedX * sin;
  }
}

/** Where in the scratch each node's numbers of a kind start, for a net of `count` nodes. */
function slotsOf(count: number) {
  'worklet';
  return {
    seen: NODE_SLOTS,
    outHops: NODE_SLOTS + count * 3,
    returnHops: NODE_SLOTS + count * 4,
    reachedFrom: NODE_SLOTS + count * 5,
    queue: NODE_SLOTS + count * 6,
  };
}

/** How far out a node is seen, in R. */
function seenReach(scratch: number[], seen: number, node: number) {
  'worklet';
  return Math.hypot(scratch[seen + node * 3], scratch[seen + node * 3 + 1]);
}

/** How much of a lit edge shows `reach` out, 0 to 1: none over his bright body, all of it past the truss. */
function seenShare(reach: number) {
  'worklet';
  return smoothStep((reach - CASCADE_SEEN_FROM) / CASCADE_SEEN_EDGE);
}

/** Whether a pulse may light an edge to a node: seen out past his limb, and not far behind him. */
function clearOfHim(scratch: number[], seen: number, node: number) {
  'worklet';
  return seenReach(scratch, seen, node) >= CASCADE_LIMB && scratch[seen + node * 3 + 2] >= CASCADE_DEEPEST;
}

/**
 * The box of the truss a node is seen over at `time`, as its first clock degree in the truss's own
 * frame (before its roll), or -1 when it is not over one of its stretches.
 */
function boxUnder(scratch: number[], seen: number, node: number, time: number) {
  'worklet';
  const x = scratch[seen + node * 3];
  const y = scratch[seen + node * 3 + 1];
  const radius = Math.hypot(x, y);
  if (radius < CASCADE_FOOT_INNER || radius > CASCADE_FOOT_OUTER) return -1;
  if (scratch[seen + node * 3 + 2] < CASCADE_DEEPEST) return -1;
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

/** How many degrees wide the truss's box starting at clock degree `first` is (see {@link boxUnder}). */
function boxSweep(first: number) {
  'worklet';
  for (let stretch = 0; stretch < TRUSS_ARCS.length; stretch++) {
    const from = TRUSS_ARCS[stretch][0];
    if (first >= from - 1e-6 && first <= from + TRUSS_ARCS[stretch][1])
      return TRUSS_ARCS[stretch][1] / TRUSS_ARCS[stretch][2];
  }
  return 0;
}

/**
 * The neighbour of `node` a spread lights next: of those clear of him, not yet reached (`hops`) and
 * not reached by the spread it avoids, the one whose edge ends most where it shows
 * ({@link seenShare}) and runs most nearly round his edge, give or take a little from the hash so
 * that two spreads from one node need not branch alike: out among the cage's triangles against the
 * dark, along his silhouette. -1 when none is open.
 */
function nextAlongHisEdge(net: CageNet, node: number, seed: number, scratch: number[], hops: number, avoids: number) {
  'worklet';
  const { seen } = slotsOf(net.firstLink.length - 1);
  const fromX = scratch[seen + node * 3];
  const fromY = scratch[seen + node * 3 + 1];
  let best = -1;
  let bestScore = -1;
  for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++) {
    const neighbour = net.links[link];
    if (scratch[hops + neighbour] >= 0 || !clearOfHim(scratch, seen, neighbour)) continue;
    if (avoids >= 0 && scratch[avoids + neighbour] >= 0) continue;
    const toX = scratch[seen + neighbour * 3];
    const toY = scratch[seen + neighbour * 3 + 1];
    const runX = toX - fromX;
    const runY = toY - fromY;
    const middleX = (fromX + toX) / 2;
    const middleY = (fromY + toY) / 2;
    const run = Math.hypot(runX, runY);
    const middle = Math.hypot(middleX, middleY);
    if (run <= 0 || middle <= 0) continue;
    const outward = Math.abs(runX * middleX + runY * middleY) / (run * middle);
    const reach = seenReach(scratch, seen, neighbour);
    const round = Math.sqrt(Math.max(0, 1 - outward * outward));
    const score =
      CASCADE_ROUND_HIM * round +
      CASCADE_OUT_WHERE_SEEN * seenShare(reach) +
      CASCADE_CHOICE_JITTER * cascadeHash(seed + neighbour * 31);
    if (score > bestScore) {
      best = neighbour;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A breadth-first spread over the net from `start`, `depth` hops deep, each node reached lighting up
 * to {@link CASCADE_BRANCHES} of its neighbours onward ({@link CASCADE_FIRST_BRANCHES} from the
 * start), those running most nearly round his edge first ({@link nextAlongHisEdge}), only to nodes
 * clear of him and not yet reached, and never to a node another spread reached (`avoids`, its hops
 * in the scratch; -1 for none), so the return runs over edges of its own beside the patch the pulse
 * out lit. How many hops each node was reached in goes into the scratch at `hops`; which node it was
 * reached from at `from`. How many nodes it reached, the start among them, in the order reached at
 * `queue`.
 */
function spread(
  net: CageNet,
  start: number,
  depth: number,
  most: number,
  seed: number,
  scratch: number[],
  hops: number,
  from: number,
  avoids: number,
) {
  'worklet';
  const count = net.firstLink.length - 1;
  const { queue } = slotsOf(count);
  for (let node = 0; node < count; node++) scratch[hops + node] = -1;
  scratch[hops + start] = 0;
  scratch[from + start] = -1;
  scratch[queue] = start;
  let reached = 1;
  for (let next = 0; next < reached && reached <= most; next++) {
    const node = scratch[queue + next];
    const hop = scratch[hops + node];
    if (hop >= depth) continue;
    const branches = hop === 0 ? CASCADE_FIRST_BRANCHES : CASCADE_BRANCHES;
    for (let lit = 0; lit < branches && reached <= most; lit++) {
      const neighbour = nextAlongHisEdge(net, node, seed, scratch, hops, avoids);
      if (neighbour < 0) break;
      scratch[hops + neighbour] = hop + 1;
      scratch[from + neighbour] = node;
      scratch[queue + reached] = neighbour;
      reached++;
    }
  }
  return reached;
}

/** One lit edge into the plan: its spark from node `from` to node `to`, leaving at `leaves`, fading from `fades`. */
function planEdge(scratch: number[], from: number, to: number, leaves: number, fades: number, kind: number) {
  'worklet';
  if (scratch[EDGE_COUNT] >= CASCADE_EDGES) return;
  const at = EDGES + scratch[EDGE_COUNT] * EDGE_SLOT;
  scratch[at] = from;
  scratch[at + 1] = to;
  scratch[at + 2] = leaves;
  scratch[at + 3] = fades;
  scratch[at + 4] = kind;
  scratch[EDGE_COUNT] += 1;
}

/**
 * How much of the edges a spread lit (`hops`, `from`, its `reached` nodes in the queue, less the
 * spokes it does not light: {@link deadEndSpoke}) shows, in R: each
 * piece of each edge counted by how much of it shows where it is seen ({@link seenShare}), as the
 * truss and his bright edge drown what lies over them.
 */
function seenLength(net: CageNet, scratch: number[], reached: number, hops: number, from: number) {
  'worklet';
  const { seen, queue } = slotsOf(net.firstLink.length - 1);
  let shown = 0;
  for (let place = 1; place < reached; place++) {
    const node = scratch[queue + place];
    const root = scratch[from + node];
    if (deadEndSpoke(net, scratch, hops, root, node)) continue;
    const startX = scratch[seen + root * 3];
    const startY = scratch[seen + root * 3 + 1];
    const runX = scratch[seen + node * 3] - startX;
    const runY = scratch[seen + node * 3 + 1] - startY;
    const piece = Math.hypot(runX, runY) / CASCADE_SEEN_STEPS;
    for (let step = 0; step < CASCADE_SEEN_STEPS; step++) {
      const share = (step + 0.5) / CASCADE_SEEN_STEPS;
      shown += piece * seenShare(Math.hypot(startX + runX * share, startY + runY * share));
    }
  }
  return shown;
}

/**
 * The pulse out from `source`: how much of it would show ({@link seenLength}), or -1 when it would
 * not spread wide and far enough ({@link CASCADE_FEWEST_EDGES}, {@link CASCADE_FEWEST_HOPS}).
 * Planned, when `fires` is not -1, as firing then: every node it reaches lights the edge it was
 * reached by, its spark leaving as the spark before it lands.
 */
function planOut(net: CageNet, source: number, fires: number, seed: number, scratch: number[]) {
  'worklet';
  const { outHops, reachedFrom, queue } = slotsOf(net.firstLink.length - 1);
  const reached = spread(net, source, CASCADE_OUT_HOPS, CASCADE_OUT_EDGES, seed, scratch, outHops, reachedFrom, -1);
  let farthest = 0;
  for (let place = 1; place < reached; place++)
    farthest = Math.max(farthest, scratch[outHops + scratch[queue + place]]);
  if (reached - 1 < CASCADE_FEWEST_EDGES || farthest < CASCADE_FEWEST_HOPS) return -1;
  const shown = seenLength(net, scratch, reached, outHops, reachedFrom);
  if (fires < 0) return shown;
  // the edges closing its triangles land a hop after the later of their nodes is lit
  const spreadOut = fires + (farthest + 1) * CASCADE_HOP_SECONDS;
  scratch[SPREAD_OUT] = spreadOut;
  for (let place = 1; place < reached; place++) {
    const node = scratch[queue + place];
    const hop = scratch[outHops + node];
    const fades = spreadOut + CASCADE_HOLD_SECONDS + (hop - 1) * CASCADE_FADE_STEP;
    planEdge(scratch, scratch[reachedFrom + node], node, fires + (hop - 1) * CASCADE_HOP_SECONDS, fades, 0);
  }
  planClosingEdges(net, reached, fires, spreadOut, scratch);
  return shown;
}

/**
 * The edges of the cage between two nodes the pulse out reached that it did not reach either by:
 * each lit a hop after the later of its nodes, its spark from the node
 * reached first, so the pulse lights the patch's triangles whole rather than a bare tree — the net
 * lighting up, not a branch.
 */
function planClosingEdges(net: CageNet, reached: number, fires: number, spreadOut: number, scratch: number[]) {
  'worklet';
  const { outHops, reachedFrom, queue } = slotsOf(net.firstLink.length - 1);
  let closed = 0;
  for (let place = 0; place < reached && closed < CASCADE_CLOSING_EDGES; place++) {
    const node = scratch[queue + place];
    for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++) {
      const other = net.links[link];
      const otherHop = scratch[outHops + other];
      const hop = scratch[outHops + node];
      // each edge once, from its node reached first (or, reached in the same hop, the lower numbered)
      const fromHere = otherHop > hop || (otherHop === hop && other > node);
      const byTheTree = scratch[reachedFrom + other] === node || scratch[reachedFrom + node] === other;
      if (otherHop < 0 || !fromHere || byTheTree || closed >= CASCADE_CLOSING_EDGES) continue;
      closed++;
      const fades = spreadOut + CASCADE_HOLD_SECONDS + otherHop * CASCADE_FADE_STEP;
      planEdge(scratch, node, other, fires + otherHop * CASCADE_HOP_SECONDS, fades, 0);
    }
  }
}

/**
 * Whether the edge a spread (`hops`) reached `node` by from `root` is a spoke ({@link CASCADE_SPOKE})
 * out to a node it reached nothing else beside: a lit stick standing out into the dark, which it
 * does not light.
 */
function deadEndSpoke(net: CageNet, scratch: number[], hops: number, root: number, node: number) {
  'worklet';
  const { seen } = slotsOf(net.firstLink.length - 1);
  if (!isSpoke(scratch, seen, root, node)) return false;
  if (seenReach(scratch, seen, node) < seenReach(scratch, seen, root)) return false;
  let lit = 0;
  for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++)
    if (scratch[hops + net.links[link]] >= 0) lit++;
  return lit <= 1;
}

/** Whether the edge between two nodes is a spoke ({@link CASCADE_SPOKE}). */
function isSpoke(scratch: number[], seen: number, first: number, second: number) {
  'worklet';
  const fromX = scratch[seen + first * 3];
  const fromY = scratch[seen + first * 3 + 1];
  const toX = scratch[seen + second * 3];
  const toY = scratch[seen + second * 3 + 1];
  const runX = toX - fromX;
  const runY = toY - fromY;
  const middleX = (fromX + toX) / 2;
  const middleY = (fromY + toY) / 2;
  const scale = Math.hypot(runX, runY) * Math.hypot(middleX, middleY);
  const outward = scale > 0 ? Math.abs(runX * middleX + runY * middleY) / scale : 0;
  return outward > CASCADE_SPOKE && Math.max(Math.hypot(fromX, fromY), Math.hypot(toX, toY)) > CASCADE_SPOKE_REACH;
}

/**
 * The return onto `target`: a spread from it, {@link CASCADE_RETURN_HOPS} deep, over none of the
 * nodes the pulse out reached, run backwards — its sparks leaving its tips first and converging hop
 * by hop onto the target, every branch landing together. How well it answers the pulse out, or 0
 * when it lights too few edges ({@link CASCADE_FEWEST_RETURN_EDGES}): how much of it shows, and more
 * for each of its nodes beside one the pulse out reached ({@link CASCADE_BESIDE}), so the return
 * gathers from the patch. Planned when `gathers`, when it starts, is not -1, and then when it lands
 * goes into the scratch.
 */
function planReturn(net: CageNet, target: number, gathers: number, seed: number, scratch: number[]) {
  'worklet';
  const count = net.firstLink.length - 1;
  const { outHops, returnHops, reachedFrom, queue } = slotsOf(count);
  const reached = spread(
    net,
    target,
    CASCADE_RETURN_HOPS,
    CASCADE_RETURN_EDGES,
    seed,
    scratch,
    returnHops,
    reachedFrom,
    outHops,
  );
  if (reached - 1 < CASCADE_FEWEST_RETURN_EDGES) return 0;
  let deepest = 0;
  let beside = 0;
  for (let place = 1; place < reached; place++) {
    const node = scratch[queue + place];
    deepest = Math.max(deepest, scratch[returnHops + node]);
    for (let link = net.firstLink[node]; link < net.firstLink[node + 1]; link++) {
      if (scratch[outHops + net.links[link]] >= 0) {
        beside++;
        break;
      }
    }
  }
  const shown = seenLength(net, scratch, reached, returnHops, reachedFrom);
  if (shown < CASCADE_FEWEST_RETURN_SEEN) return 0;
  const answer = shown + CASCADE_BESIDE * beside;
  if (gathers < 0) return answer;
  const lands = gathers + deepest * CASCADE_HOP_SECONDS;
  scratch[LANDS] = lands;
  for (let place = 1; place < reached; place++) {
    const node = scratch[queue + place];
    const hop = scratch[returnHops + node];
    const leaves = gathers + (deepest - hop) * CASCADE_HOP_SECONDS;
    const fades = lands + CASCADE_HOLD_SECONDS + (hop - 1) * CASCADE_FADE_STEP;
    planEdge(scratch, node, scratch[reachedFrom + node], leaves, fades, 1);
  }
  return answer;
}

/**
 * The node over the truss to fire chance's pulse from at `fires`: the one whose pulse out would show
 * most ({@link seenLength}), give or take the hash ({@link CASCADE_SOURCE_CHOICE}) so that it is not
 * always the same; -1 when none would spread far enough or show for {@link CASCADE_FEWEST_SEEN}.
 */
function bestSource(net: CageNet, fires: number, seed: number, scratch: number[]) {
  'worklet';
  const count = net.firstLink.length - 1;
  const { seen } = slotsOf(count);
  seeNodes(net, fires, scratch, seen);
  let best = -1;
  let bestScore = 0;
  for (let node = 0; node < count; node++) {
    if (boxUnder(scratch, seen, node, fires) < 0) continue;
    const shown = planOut(net, node, -1, seed, scratch);
    if (shown < CASCADE_FEWEST_SEEN) continue;
    const score = shown * (1 - CASCADE_SOURCE_CHOICE + 2 * CASCADE_SOURCE_CHOICE * cascadeHash(seed + node * 13));
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The node chance `chance` fires from, or -1 when it finds none: the best at its first try
 * ({@link bestSource}), or, where no node would do, at a try {@link CASCADE_RETRY_SECONDS} later as
 * the cage turns, up to {@link CASCADE_RETRIES} times. When it fires goes into the scratch, and
 * where the nodes are seen then.
 */
function chanceSource(net: CageNet, chance: number, scratch: number[]) {
  'worklet';
  const seed = chance * 7919 + 17;
  const firstTry = chance * CASCADE_PERIOD + cascadeHash(seed + 1) * CASCADE_JITTER;
  for (let attempt = 0; attempt <= CASCADE_RETRIES; attempt++) {
    const fires = firstTry + attempt * CASCADE_RETRY_SECONDS;
    const source = bestSource(net, fires, seed, scratch);
    if (source < 0) continue;
    scratch[FIRES] = fires;
    return source;
  }
  return -1;
}

/**
 * Works out the plan of chance `chance` into the scratch: when it fires and whether it does, and if
 * so, from which node over the truss and down which edges, then onto which other box the return
 * gathers. Every other chance fires whatever he is doing; of the ones between, the hash's
 * {@link CASCADE_IN_SILENCE} share does too, and so does one beside a chance that finds nothing to
 * fire from ({@link chanceSource}), and the rest only while he is busy. So in silence no two are
 * further apart than two chances.
 */
function planChance(net: CageNet, chance: number, scratch: number[]) {
  'worklet';
  const seed = chance * 7919 + 17;
  const chosen = chance % 2 === 0 || cascadeHash(seed + 2) < CASCADE_IN_SILENCE;
  const neighbourLost =
    !chosen && (chanceSource(net, chance - 1, scratch) < 0 || chanceSource(net, chance + 1, scratch) < 0);
  const onlyWhileBusy = chosen || neighbourLost ? 0 : 1;
  scratch[PLANNED] = chance + 1;
  scratch[ONLY_WHILE_BUSY] = onlyWhileBusy;
  scratch[EDGE_COUNT] = 0;
  scratch[SOURCE_BOX] = -1;
  scratch[TARGET_BOX] = -1;
  scratch[LANDS] = -1;
  const source = chanceSource(net, chance, scratch);
  if (source < 0) return;
  const fires = scratch[FIRES];
  const { seen } = slotsOf(net.firstLink.length - 1);
  scratch[SOURCE_BOX] = boxUnder(scratch, seen, source, fires);
  planOut(net, source, fires, seed, scratch);
  // the return starts gathering as the pulse out reaches its tips, while its triangles close
  planBestReturn(net, source, scratch[SPREAD_OUT] - CASCADE_HOP_SECONDS, fires, seed, scratch);
  dropLoneSpokes(scratch);
  dropLoneSpokes(scratch);
}

/**
 * Takes out of the plan every spoke ({@link isSpoke}) whose outer node no other planned edge
 * reaches: a lit stick standing out into the dark on its own, which read as something growing out
 * of him. Twice over, by its caller, in case dropping one leaves another alone.
 */
function dropLoneSpokes(scratch: number[]) {
  'worklet';
  const seen = NODE_SLOTS;
  let kept = 0;
  const count = scratch[EDGE_COUNT];
  for (let edge = 0; edge < count; edge++) {
    const at = EDGES + edge * EDGE_SLOT;
    const from = scratch[at];
    const to = scratch[at + 1];
    const outer = seenReach(scratch, seen, to) > seenReach(scratch, seen, from) ? to : from;
    let touching = 0;
    for (let other = 0; other < count; other++) {
      const otherAt = EDGES + other * EDGE_SLOT;
      if (scratch[otherAt] === outer || scratch[otherAt + 1] === outer) touching++;
    }
    if (touching <= 1 && isSpoke(scratch, seen, from, to)) continue;
    const keptAt = EDGES + kept * EDGE_SLOT;
    for (let number = 0; number < EDGE_SLOT; number++) scratch[keptAt + number] = scratch[at + number];
    kept++;
  }
  scratch[EDGE_COUNT] = kept;
}

/**
 * The return, onto the node over another box of the truss, never reached by the pulse out, whose
 * return answers it best ({@link planReturn}) and lands nearest the box that fired
 * ({@link CASCADE_NEARBY}), so the answer is seen coming back beside the question rather than on
 * his far side; none when none lights enough edges.
 */
function planBestReturn(net: CageNet, source: number, gathers: number, fires: number, seed: number, scratch: number[]) {
  'worklet';
  const count = net.firstLink.length - 1;
  const { seen, outHops } = slotsOf(count);
  const sourceBox = scratch[SOURCE_BOX];
  let best = -1;
  let bestAnswer = 0;
  for (let target = 0; target < count; target++) {
    // a box of its own, which the pulse out never reached
    if (scratch[outHops + target] >= 0) continue;
    const box = boxUnder(scratch, seen, target, fires);
    if (box < 0 || box === sourceBox) continue;
    const apart = Math.hypot(
      scratch[seen + target * 3] - scratch[seen + source * 3],
      scratch[seen + target * 3 + 1] - scratch[seen + source * 3 + 1],
    );
    const answer = planReturn(net, target, -1, seed + 7, scratch) / (1 + CASCADE_NEARBY * apart);
    if (answer > bestAnswer) {
      best = target;
      bestAnswer = answer;
    }
  }
  if (best < 0) return;
  scratch[TARGET_BOX] = boxUnder(scratch, seen, best, fires);
  planReturn(net, best, gathers, seed + 7, scratch);
}

/**
 * How lit the current chance is: one fired whatever he does is all lit; one fired only while he
 * talks or thinks is as lit as he is busy, eased, so it never vanishes mid-way as it would if whether
 * it fired changed with him. Nothing before he has formed.
 */
function chanceLight(onlyWhileBusy: number, state: CascadeFrame) {
  'worklet';
  const busy = Math.max(state.talk ?? 0, state.thinking);
  const fired = onlyWhileBusy > 0 ? smoothStep((busy - 0.15) / 0.35) : 1;
  return fired * smoothStep((state.swirl - 0.9) / 0.1);
}

/** One of the two boxes' numbers into `out`: its first clock degree, its sweep, when it flares and how lit. */
function writeBox(out: number[], slot: number, first: number, flares: number, light: number) {
  'worklet';
  const at = CASCADE_BOXES_AT + slot * CASCADE_BOX_NUMBERS;
  const lit = first >= 0 && flares >= 0 && light > 0;
  out[at] = lit ? first : 0;
  out[at + 1] = lit ? boxSweep(first) : 0;
  out[at + 2] = lit ? flares : 0;
  out[at + 3] = lit ? light : 0;
}

/**
 * Where the cascade is this frame, for the picture to draw (`cascadeLayer`): for each of
 * {@link CASCADE_EDGES} edges, {@link CASCADE_EDGE_NUMBERS} numbers — its spark's from node at rest
 * (x, y, z) and when it leaves; its to node at rest and how long it takes over the edge; when the
 * edge starts to fade, how long it takes to, how lit it is (0 for an edge not lit this frame: one
 * whose spark has not left yet or that has gone out, as well as one this chance does not light), and
 * whether it is the pulse out (0) or the return (1). Then, from {@link CASCADE_BOXES_AT}, the box the
 * pulse fired from and the box the return lands on, {@link CASCADE_BOX_NUMBERS} each — its first
 * clock degree in the truss's own frame and its sweep, when it flares and how lit (0 none). The
 * picture turns the nodes with the cage and the boxes with the truss, and works out where along its
 * edge each spark is, and how far each flare has got, from the frame's time.
 */
export function writeCageCascade(net: CageNet, state: CascadeFrame, scratch: number[], out: number[]) {
  'worklet';
  const chance = Math.floor(state.time / CASCADE_PERIOD);
  if (scratch[PLANNED] !== chance + 1) planChance(net, chance, scratch);
  const light = scratch[EDGE_COUNT] > 0 ? chanceLight(scratch[ONLY_WHILE_BUSY], state) : 0;
  for (let edge = 0; edge < CASCADE_EDGES; edge++) {
    const at = edge * CASCADE_EDGE_NUMBERS;
    if (edge >= scratch[EDGE_COUNT] || light <= 0) {
      out[at + 10] = 0;
      continue;
    }
    const planned = EDGES + edge * EDGE_SLOT;
    // an edge whose spark has not left yet, or that has gone out, is not lit this frame
    if (state.time < scratch[planned + 2] || state.time > scratch[planned + 3] + CASCADE_FADE_SECONDS) {
      out[at + 10] = 0;
      continue;
    }
    const from = scratch[planned] * 3;
    const to = scratch[planned + 1] * 3;
    out[at] = net.nodes[from];
    out[at + 1] = net.nodes[from + 1];
    out[at + 2] = net.nodes[from + 2];
    out[at + 3] = scratch[planned + 2];
    out[at + 4] = net.nodes[to];
    out[at + 5] = net.nodes[to + 1];
    out[at + 6] = net.nodes[to + 2];
    out[at + 7] = CASCADE_HOP_SECONDS;
    out[at + 8] = scratch[planned + 3];
    out[at + 9] = CASCADE_FADE_SECONDS;
    out[at + 10] = light;
    out[at + 11] = scratch[planned + 4];
  }
  writeBox(out, 0, scratch[SOURCE_BOX], scratch[EDGE_COUNT] > 0 ? scratch[FIRES] : -1, light);
  writeBox(out, 1, scratch[TARGET_BOX], scratch[LANDS], light);
}
