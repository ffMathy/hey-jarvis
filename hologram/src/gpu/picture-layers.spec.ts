import { describe, expect, it } from 'bun:test';
import { staticPathsOf } from '../hologram-drawing';
import { flattenPath, STATIC_PATH_NAMES, staticSegmentsLayer } from './picture-layers';

describe('the paths that never change, flattened into runs', () => {
  // No longer seeded: since the whorl went, the only paths that never change are the core's marks.
  const paths = staticPathsOf();

  it('flattens every one of them into runs whose joins pair up, each shared by the runs either side', () => {
    for (const name of STATIC_PATH_NAMES) {
      const { ends, joins } = flattenPath(paths[name]);
      const flags = joins.map(([join]) => join ?? 0);

      expect(ends.length).toBeGreaterThan(0);
      expect(joins).toHaveLength(ends.length);
      expect(flags.filter((join) => (join & 2) !== 0)).toHaveLength(flags.filter((join) => (join & 1) !== 0).length);
      for (let run = 1; run < ends.length; run++) {
        // a run joined to the next ends where the next one starts
        if (((flags[run - 1] ?? 0) & 2) === 0) continue;
        expect(ends[run]?.slice(0, 2)).toEqual(ends[run - 1]?.slice(2, 4) ?? []);
        expect((flags[run] ?? 0) & 1).toBe(1);
      }
    }
  });

  it('lays them out one after another in one layer, each with its own range', () => {
    const { layer, ranges } = staticSegmentsLayer(paths);
    let next = 0;
    for (const name of STATIC_PATH_NAMES) {
      expect(ranges[name].first).toBe(next);
      next += ranges[name].count;
    }

    expect(layer.shapes).toBe(next);
    for (const attribute of layer.attributes) expect(attribute.values).toHaveLength(next * attribute.size);
  });
});
