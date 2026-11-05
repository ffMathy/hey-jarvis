import { describe, expect, it } from 'bun:test';
import {
  buildCageNet,
  CASCADE_BOX_NUMBERS,
  CASCADE_BOXES_AT,
  CASCADE_EDGE_NUMBERS,
  CASCADE_EDGES,
  CASCADE_FADE_SECONDS,
  CASCADE_HOP_SECONDS,
  CASCADE_NUMBERS,
  CASCADE_PERIOD,
  type CageNet,
  type CascadeFrame,
  cascadeScratchSize,
  writeCageCascade,
} from './cage-cascade';
import { SCENE_SEED } from './frame-timing';
import { bodyTurnRadians, CAGE_EDGE_STRIDE, createHologramScene, TRUSS_ARCS } from './hologram-drawing';

const scene = createHologramScene(SCENE_SEED);
const net = buildCageNet(scene.cage);

/** The few fields of a frame the cascades read. */
function stateAt(time: number, busy = 0, swirl = 1): CascadeFrame {
  return { time, talk: busy, thinking: 0, swirl };
}

function freshScratch(cage: CageNet) {
  return new Array(cascadeScratchSize(cage)).fill(0);
}

/** The lit edges of a frame: each as its numbers. */
function litEdges(out: number[]) {
  const edges: number[][] = [];
  for (let edge = 0; edge < CASCADE_EDGES; edge++) {
    const numbers = out.slice(edge * CASCADE_EDGE_NUMBERS, (edge + 1) * CASCADE_EDGE_NUMBERS);
    if ((numbers[10] ?? 0) > 0) edges.push(numbers);
  }
  return edges;
}

/** Every chance's lit edges over `seconds`, a frame in the middle of each. */
function chances(seconds: number, busy: number) {
  const scratch = freshScratch(net);
  const out = new Array(CASCADE_NUMBERS).fill(0);
  const found: { chance: number; edges: number[][] }[] = [];
  for (let chance = 2; chance < seconds / CASCADE_PERIOD; chance++) {
    writeCageCascade(net, stateAt(chance * CASCADE_PERIOD + 1, busy), scratch, out);
    found.push({ chance, edges: litEdges(out) });
  }
  return found;
}

/**
 * Every edge chance `chance` lights at any moment of its period, as its numbers when first lit, and
 * its boxes' numbers: the plan whole, frame by frame, as the picture is handed it.
 */
function wholeChance(chance: number, busy: number) {
  const scratch = freshScratch(net);
  const out = new Array(CASCADE_NUMBERS).fill(0);
  const edges = new Map<string, number[]>();
  let boxes: number[] = [];
  for (let time = chance * CASCADE_PERIOD; time < (chance + 1) * CASCADE_PERIOD; time += 0.02) {
    writeCageCascade(net, stateAt(time, busy), scratch, out);
    for (const edge of litEdges(out)) {
      const key = `${edge.slice(0, 3).join(',')}|${edge.slice(4, 7).join(',')}`;
      if (!edges.has(key)) edges.set(key, edge);
    }
    if ((out[CASCADE_BOXES_AT + 3] ?? 0) > 0)
      boxes = out.slice(CASCADE_BOXES_AT, CASCADE_BOXES_AT + 2 * CASCADE_BOX_NUMBERS);
  }
  return { edges: [...edges.values()], boxes };
}

/** Where a node at rest is seen at `time`, without its sway: x and y (down), in R. */
function seenAt(x: number, z: number, time: number) {
  const yaw = bodyTurnRadians(time);
  return x * Math.cos(yaw) + z * Math.sin(yaw);
}

/** A lit edge's from node (0) or to node (1) at rest, as a key. */
function endOf(edge: number[], end: number) {
  return edge.slice(end * 4, end * 4 + 3).join(',');
}

/**
 * The outer node of a lit edge, as a key, when it is a clear spoke at `fires` — running within 25° of
 * straight out from his middle with an end past 1.12R, well past the thresholds the plan uses so the
 * sway cannot tip one either way — and undefined otherwise.
 */
function outerEndOfSpoke(edge: number[], fires: number) {
  const fromX = seenAt(edge[0] ?? 0, edge[2] ?? 0, fires);
  const fromY = edge[1] ?? 0;
  const toX = seenAt(edge[4] ?? 0, edge[6] ?? 0, fires);
  const toY = edge[5] ?? 0;
  const middleX = (fromX + toX) / 2;
  const middleY = (fromY + toY) / 2;
  const run = Math.hypot(toX - fromX, toY - fromY) * Math.hypot(middleX, middleY);
  const outward = Math.abs((toX - fromX) * middleX + (toY - fromY) * middleY) / run;
  const toReach = Math.hypot(toX, toY);
  const fromReach = Math.hypot(fromX, fromY);
  if (outward < 0.9 || Math.max(toReach, fromReach) < 1.12) return undefined;
  return endOf(edge, toReach > fromReach ? 1 : 0);
}

/** For each clear spoke among a chance's lit edges ({@link outerEndOfSpoke}), how many of them reach its outer node, itself among them. */
function spokesOf(edges: number[][]) {
  if (edges.length === 0) return [];
  const fires = Math.min(...edges.map((edge) => edge[3] ?? 0));
  const ends = new Map<string, number>();
  for (const edge of edges) for (const end of [endOf(edge, 0), endOf(edge, 1)]) ends.set(end, (ends.get(end) ?? 0) + 1);
  return edges.flatMap((edge) => {
    const outer = outerEndOfSpoke(edge, fires);
    return outer === undefined ? [] : [ends.get(outer) ?? 0];
  });
}

describe('the cage net the cascades run over', () => {
  it('joins only nodes of the cage both ways, along its own evenly lit edges out past the specks', () => {
    const count = net.firstLink.length - 1;
    expect(count).toBeGreaterThan(50);
    expect(net.nodes).toHaveLength(count * 3);
    const edges = new Set<string>();
    for (let offset = 0; offset < scene.cage.length; offset += CAGE_EDGE_STRIDE) {
      const from = scene.cage.slice(offset, offset + 3).join(',');
      const to = scene.cage.slice(offset + 3, offset + 6).join(',');
      edges.add(`${from}|${to}`);
      edges.add(`${to}|${from}`);
    }
    for (let node = 0; node < count; node++) {
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
  it('fire now and then: about one every five seconds in silence, and more often while he is busy', () => {
    const seconds = 600;
    const inSilence = chances(seconds, 0).filter(({ edges }) => edges.length > 0).length;
    const whileBusy = chances(seconds, 1).filter(({ edges }) => edges.length > 0).length;

    expect(seconds / inSilence).toBeGreaterThan(4);
    expect(seconds / inSilence).toBeLessThan(7);
    expect(whileBusy).toBeGreaterThan(inSilence * 1.5);
  });

  it('never leave him dark for long: in silence no two are more than two chances apart', () => {
    const lit = chances(1200, 0).filter(({ edges }) => edges.length > 0);
    const fired = lit.map(({ edges }) => Math.min(...edges.map((edge) => edge[3] ?? 0)));
    const gaps = fired.slice(1).map((fires, place) => fires - (fired[place] ?? 0));

    expect(Math.max(...gaps)).toBeLessThan(2 * CASCADE_PERIOD + 0.5);
  });

  it('never light a spoke standing out into the dark on its own, only one leading on to more lit edges', () => {
    let spokes = 0;
    for (let chance = 2; chance < 120; chance++) {
      for (const touching of spokesOf(wholeChance(chance, 1).edges)) {
        spokes++;
        expect(touching).toBeGreaterThan(1);
      }
    }
    expect(spokes).toBeGreaterThan(0);
  });

  it('flare the box the pulse fires from as it fires, and the box the return lands on as it lands', () => {
    let returns = 0;
    for (let chance = 2; chance < 120; chance++) {
      const { edges, boxes } = wholeChance(chance, 1);
      if (edges.length === 0) continue;
      const out = edges.filter((edge) => edge[11] === 0);
      const back = edges.filter((edge) => edge[11] === 1);
      const [sourceFirst = 0, sourceSweep = 0, sourceFlares = 0] = boxes;
      const [targetFirst = 0, targetSweep = 0, targetFlares = 0, targetLight = 0] = boxes.slice(CASCADE_BOX_NUMBERS);
      // a box of the truss: the first degree of one of its stretches' boxes, and that box's width
      const isBox = (first: number, sweep: number) =>
        TRUSS_ARCS.some(([from, stretch, count]) => {
          const step = stretch / count;
          const place = (first - from) / step;
          return (
            Math.abs(sweep - step) < 1e-9 &&
            place > -1e-9 &&
            place < count &&
            Math.abs(place - Math.round(place)) < 1e-9
          );
        });

      expect(isBox(sourceFirst, sourceSweep)).toBe(true);
      expect(sourceFlares).toBeCloseTo(Math.min(...out.map((edge) => edge[3] ?? 0)), 9);
      if (back.length === 0) continue;
      returns++;
      expect(targetLight).toBeGreaterThan(0);
      expect(isBox(targetFirst, targetSweep)).toBe(true);
      expect(targetFirst).not.toBe(sourceFirst);
      expect(targetFlares).toBeCloseTo(Math.max(...back.map((edge) => (edge[3] ?? 0) + (edge[7] ?? 0))), 9);
    }
    expect(returns).toBeGreaterThan(30);
  });

  it('spread out hop by hop from one node, and gather back onto another', () => {
    for (const { edges } of chances(300, 1)) {
      if (edges.length === 0) continue;
      const out = edges.filter((edge) => edge[11] === 0);
      const back = edges.filter((edge) => edge[11] === 1);
      const fires = Math.min(...out.map((edge) => edge[3] ?? 0));
      // every spark leaves a whole number of hops after the pulse fired, from a node an earlier spark lit
      const lit = new Set([
        out
          .find((edge) => edge[3] === fires)
          ?.slice(0, 3)
          .join(','),
      ]);
      for (const edge of [...out].sort((first, second) => (first[3] ?? 0) - (second[3] ?? 0))) {
        const hops = ((edge[3] ?? 0) - fires) / CASCADE_HOP_SECONDS;
        expect(Math.abs(hops - Math.round(hops))).toBeLessThan(1e-9);
        expect(lit.has(edge.slice(0, 3).join(','))).toBe(true);
        lit.add(edge.slice(4, 7).join(','));
      }
      expect(out.length).toBeGreaterThanOrEqual(5);
      if (back.length === 0) continue;
      // the return's sparks all converge on one node, landing together, after the pulse out spread
      const lands = back.map((edge) => (edge[3] ?? 0) + (edge[7] ?? 0));
      const target = back.find((edge) => (edge[3] ?? 0) + (edge[7] ?? 0) === Math.max(...lands));
      expect(Math.min(...back.map((edge) => edge[3] ?? 0))).toBeGreaterThan(fires);
      expect(lit.has(target?.slice(4, 7).join(','))).toBe(false);
    }
  });

  it('are over before the next chance, so two never overlap and none is cut off', () => {
    for (const { chance, edges } of chances(600, 1)) {
      for (const edge of edges) {
        expect((edge[8] ?? 0) + CASCADE_FADE_SECONDS).toBeLessThanOrEqual((chance + 1) * CASCADE_PERIOD + 1e-9);
        expect(edge[3] ?? 0).toBeGreaterThanOrEqual(chance * CASCADE_PERIOD);
      }
    }
  });

  it('light edges out past his limb, where the cage stands against the dark, not across his face', () => {
    for (const { edges } of chances(300, 1)) {
      if (edges.length === 0) continue;
      // where the cage was when the pulse fired, which is when it was planned: the cage turns on
      const fires = Math.min(...edges.map((edge) => edge[3] ?? 0));
      for (const edge of edges) {
        for (const [x, y, z] of [edge.slice(0, 3), edge.slice(4, 7)]) {
          // past the limb (0.9R) and the truss's feet (0.91R), give or take a node's sway
          expect(Math.hypot(seenAt(x ?? 0, z ?? 0, fires), y ?? 0)).toBeGreaterThan(0.88);
        }
      }
    }
  });

  it('are the same frame at a time from a fresh scratch as from one kept frame to frame', () => {
    const kept = freshScratch(net);
    const keptOut = new Array(CASCADE_NUMBERS).fill(0);
    for (let time = 20; time < 40; time += 1 / 30) {
      writeCageCascade(net, stateAt(time, 1), kept, keptOut);
      const freshOut = new Array(CASCADE_NUMBERS).fill(0);
      writeCageCascade(net, stateAt(time, 1), freshScratch(net), freshOut);
      expect(litEdges(freshOut)).toEqual(litEdges(keptOut));
    }
  });

  it('light nothing before he has formed', () => {
    const out = new Array(CASCADE_NUMBERS).fill(0);
    for (let chance = 2; chance < 60; chance++) {
      writeCageCascade(net, stateAt(chance * CASCADE_PERIOD + 1, 1, 0.5), freshScratch(net), out);
      expect(litEdges(out)).toHaveLength(0);
    }
  });
});
