import { describe, expect, it } from 'bun:test';
import { PLAIN_RING_GLYPH, SAMPLE_AGENTS } from '../agent-work';
import { flattenGlyph, GLYPH_RUN_NUMBERS } from './picture-glyphs';

/** A glyph's runs, one an entry: where each starts and ends, and which of its ends are joins. */
function runsOf(path: string) {
  const numbers = flattenGlyph(path);
  return Array.from({ length: numbers.length / GLYPH_RUN_NUMBERS }, (_, run) => {
    const [fromX, fromY, toX, toY, joins] = numbers.slice(run * GLYPH_RUN_NUMBERS, (run + 1) * GLYPH_RUN_NUMBERS);
    return { from: [fromX, fromY], to: [toX, toY], joins };
  });
}

describe("a satellite's glyph, flattened into runs", () => {
  it('draws a straight path as its own runs, joined between them and cut at its ends', () => {
    expect(runsOf('M 0 0 L 1 0 L 1 1')).toEqual([
      { from: [0, 0], to: [1, 0], joins: 2 },
      { from: [1, 0], to: [1, 1], joins: 1 },
    ]);
  });

  it('joins a closed subpath all the way round, its last run to its first', () => {
    const runs = runsOf('M -0.55 -0.55 L 0.55 -0.55 L 0.55 0.55 L -0.55 0.55 Z');

    expect(runs).toHaveLength(4);
    for (const run of runs) expect(run.joins).toBe(3);
    expect(runs.at(-1)?.to).toEqual([-0.55, -0.55]);
  });

  it('reads relative commands from where the pen is, and further pairs after a move as lines', () => {
    const relative = flattenGlyph('m 0.1 0.1 0.2 0 l 0 0.3 h -0.3 v -0.3');
    const absolute = flattenGlyph('M 0.1 0.1 L 0.3 0.1 L 0.3 0.4 H 0 V 0.1');

    expect(relative).toHaveLength(absolute.length);
    for (const [index, number] of relative.entries()) expect(number).toBeCloseTo(absolute[index] ?? Number.NaN, 12);
  });

  it('reads an arc whose flags are written run together as the same arc written out', () => {
    expect(runsOf('M -0.5 0 a0.5 0.5 0 01 1 0')).toEqual(runsOf('M -0.5 0 A 0.5 0.5 0 0 1 0.5 0'));
  });

  it('follows its curves and arcs, inside the glyph circle and ending where they are told to', () => {
    for (const glyph of [PLAIN_RING_GLYPH, ...SAMPLE_AGENTS.map((agent) => agent.glyph)]) {
      const runs = runsOf(glyph);

      expect(runs.length).toBeGreaterThan(1);
      for (const run of runs) expect(Math.hypot(run.to[0] ?? 0, run.to[1] ?? 0)).toBeLessThanOrEqual(1.0001);
    }
    const curve = runsOf('M 0 0 Q 0.5 -0.5 1 0 C 1 0.5 0.5 0.5 0.5 0.25');
    expect(curve.at(-1)?.to).toEqual([0.5, 0.25]);
    expect(curve.length).toBeGreaterThan(10);
  });

  it('gives nothing for a path it cannot read, which is drawn as the plain ring instead', () => {
    expect(flattenGlyph('M 0 0 L')).toEqual([]);
    expect(flattenGlyph('0 0 L 1 1')).toEqual([]);
    expect(flattenGlyph('M 0 0 L 1e999 0')).toEqual([]);
  });
});
