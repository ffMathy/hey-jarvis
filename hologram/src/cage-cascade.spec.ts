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
 * the picture's shader turns and sways them (`turnedNode`, from `CAGE_SWAY_WAVES` by `cageSwayOf`).
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
    const numbers = Array.from(out.slice(edge * CASCADE_EDGE_NUMBERS, (edge + 1) * CASCADE_EDGE_NUMBERS));
    if ((numbers[SLOTS.light] ?? 0) > 0) edges.push(numbers);
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

/** Where a node at rest is seen at `time`: swayed, then turned with his body, as the picture's shader does. */
function seenAt(node: number[], time: number) {
  const [x = 0, y = 0, z = 0] = node;
  const swayed = [0, 1, 2].map((axis) => (node[axis] ?? 0) + cageSwayOf(axis, x, y, z, time));
  const [swayedX = 0, swayedY = 0, swayedZ = 0] = swayed;
  const yaw = bodyTurnRadians(time);
  return {
    x: swayedX * Math.cos(yaw) + swayedZ * Math.sin(yaw),
    y: swayedY,
    z: swayedZ * Math.cos(yaw) - swayedX * Math.sin(yaw),
  };
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
}

function chanceFrames(chance: number, overrides: Partial<HologramFrame>, scratch = freshScratch(net)): ChanceFrames {
  const out = freshOut();
  const frames: ChanceFrames['frames'] = [];
  const edges = new Map<string, number[]>();
  for (let step = 0; step * FRAME < CASCADE_PERIOD; step++) {
    const time = chance * CASCADE_PERIOD + step * FRAME;
    writeCageCascade(net, stateAt(time, overrides), scratch, out);
    const lit = litEdges(out);
    frames.push({ time, edges: lit, boxes: [litBox(out, 0), litBox(out, 1)] });
    for (const edge of lit) edges.set(`${keyOf(endOf(edge, 0))}|${keyOf(endOf(edge, 1))}`, edge);
  }
  return { chance, frames, edges: [...edges.values()] };
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

/**
 * Every spoke a chance lights, at every frame it is one, by the plan's own thresholds: whether its
 * outer node then is reached by no other edge of the chance's whole plan.
 */
function spokesOf({ frames, edges }: ChanceFrames) {
  const ends = new Map<string, number>();
  for (const edge of edges)
    for (const end of [0, 1]) ends.set(keyOf(endOf(edge, end)), (ends.get(keyOf(endOf(edge, end))) ?? 0) + 1);
  return frames.flatMap(({ time, edges: lit }) =>
    lit.flatMap((edge) => {
      const from = seenAt(endOf(edge, 0), time);
      const to = seenAt(endOf(edge, 1), time);
      if (!isSpoke(from, to)) return [];
      const outer = Math.hypot(to.x, to.y) > Math.hypot(from.x, from.y) ? 1 : 0;
      return [{ time, alone: (ends.get(keyOf(endOf(edge, outer))) ?? 0) <= 1 }];
    }),
  );
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
  const out = chance.edges.filter((edge) => edge[SLOTS.kind] === 0);
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
  const back = chance.edges.filter((edge) => edge[SLOTS.kind] === 1);
  const target = boxOf(chance, 1);
  const first = target[CASCADE_BOX_SLOTS.first] ?? 0;
  const sweep = target[CASCADE_BOX_SLOTS.sweep] ?? 0;
  const lands = target[CASCADE_BOX_SLOTS.flares] ?? 0;
  const landsAt = (edge: number[]) => (edge[SLOTS.leaves] ?? 0) + CASCADE_HOP_SECONDS;
  const landing = back.filter((edge) => Math.abs(landsAt(edge) - lands) < 1e-4);

  expect(back.length).toBeGreaterThanOrEqual(CASCADE_FEWEST_RETURN_EDGES);
  expect(isBox(first, sweep)).toBe(true);
  expect(first).not.toBe(source[CASCADE_BOX_SLOTS.first]);
  expect(Math.max(...back.map(landsAt))).toBeCloseTo(lands, 4);
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

  it('fire now and then: about one every five seconds in silence, more often while he talks, and as often while he thinks', () => {
    const seconds = 600;
    const inSilence = firedChances(seconds, {}).filter(Boolean).length;
    const whileTalking = firedChances(seconds, BUSY).filter(Boolean).length;
    const whileThinking = firedChances(seconds, { thinking: 1 });

    expect(seconds / inSilence).toBeGreaterThan(4);
    expect(seconds / inSilence).toBeLessThan(7);
    expect(whileTalking).toBeGreaterThan(inSilence * 1.4);
    expect(whileThinking).toEqual(firedChances(seconds, BUSY));
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
    expect(whileBusy.filter((fired) => !fired).length).toBeLessThan(whileBusy.length * 0.15);
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

    // another edge of the plan reaches each one's outer node, so it leads on to the lit net
    expect(spokes.filter(({ alone }) => alone)).toEqual([]);
    expect(spokes.length).toBeGreaterThan(0);
  });

  it('flare the box the pulse fires from as it fires, under its node, and the box the return lands on as it lands, under the node it lands on', () => {
    let returns = 0;
    for (const chance of busyChances) {
      if (chance.edges.length === 0) continue;
      const source = expectFlaredUnderTheSource(chance);
      if (chance.edges.some((edge) => edge[SLOTS.kind] === 1)) {
        expectFlaredUnderTheTarget(chance, source);
        returns++;
      } else {
        expect(chance.frames.some(({ boxes }) => boxes[1] !== undefined)).toBe(false);
      }
    }
    expect(returns).toBeGreaterThan(30);
  });

  it('spread out hop by hop from one node, and gather back onto another', () => {
    for (const { edges } of busyChances) {
      if (edges.length === 0) continue;
      const out = edges.filter((edge) => edge[SLOTS.kind] === 0);
      const back = edges.filter((edge) => edge[SLOTS.kind] === 1);
      const fires = Math.min(...out.map((edge) => edge[SLOTS.leaves] ?? 0));
      // every spark leaves a whole number of hops after the pulse fired, from a node an earlier spark lit
      const lit = new Set(out.filter((edge) => edge[SLOTS.leaves] === fires).map((edge) => keyOf(endOf(edge, 0))));
      expect(lit.size).toBe(1);
      for (const edge of [...out].sort((first, second) => (first[SLOTS.leaves] ?? 0) - (second[SLOTS.leaves] ?? 0))) {
        const hops = ((edge[SLOTS.leaves] ?? 0) - fires) / CASCADE_HOP_SECONDS;
        expect(Math.abs(hops - Math.round(hops))).toBeLessThan(1e-3);
        expect(lit.has(keyOf(endOf(edge, 0)))).toBe(true);
        lit.add(keyOf(endOf(edge, 1)));
      }
      expect(out.length).toBeGreaterThanOrEqual(4);
      if (back.length === 0) continue;
      // the return's sparks all converge on one node, landing together, after the pulse out spread
      const lands = Math.max(...back.map((edge) => (edge[SLOTS.leaves] ?? 0) + CASCADE_HOP_SECONDS));
      const targets = new Set(
        back
          .filter((edge) => Math.abs((edge[SLOTS.leaves] ?? 0) + CASCADE_HOP_SECONDS - lands) < 1e-4)
          .map((edge) => keyOf(endOf(edge, 1))),
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
