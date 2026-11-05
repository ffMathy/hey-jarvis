import { describe, expect, it } from 'bun:test';
import { CASCADE_NUMBERS } from '../cage-cascade';
import { CAGE_SWAY, CAGE_SWAY_WAVES, cageSwayOf, staticPathsOf } from '../hologram-drawing';
import { glslFloat } from './glsl';
import {
  CASCADE_VECTORS,
  cascadeLayer,
  flattenPath,
  STATIC_PATH_NAMES,
  staticSegmentsLayer,
  TURNED_NODE_GLSL,
} from './picture-layers';

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

describe("the cage's nodes, where the picture and the cascades place them", () => {
  it('sway by the one table: the shader is written from it, and the cascades place their nodes by it', () => {
    const axes = ['x', 'y', 'z'];
    const node = [0.31, -0.84, 0.47];
    expect(CAGE_SWAY_WAVES).toHaveLength(3);
    CAGE_SWAY_WAVES.forEach(([radiansPerSecond, firstAxis, secondAxis], axis) => {
      const first = (axis + 1) % 3;
      const second = (axis + 2) % 3;
      expect(TURNED_NODE_GLSL).toContain(
        `sin(time * ${glslFloat(radiansPerSecond)} + node.${axes[first]} * ${glslFloat(firstAxis)} + node.${axes[second]} * ${glslFloat(secondAxis)})`,
      );
      for (const time of [0, 7.25, 1234.5]) {
        const wave = time * radiansPerSecond + (node[first] ?? 0) * firstAxis + (node[second] ?? 0) * secondAxis;
        expect(cageSwayOf(axis, node[0] ?? 0, node[1] ?? 0, node[2] ?? 0, time)).toBe(CAGE_SWAY * Math.sin(wave));
      }
    });
    expect(TURNED_NODE_GLSL).toContain(`* ${glslFloat(CAGE_SWAY)};`);
  });
});

describe("the cascades' layer", () => {
  /** How many uniform vectors a shader's declarations take, as GLSL ES 3.00 counts them at the most: a vector or a scalar one each, a matrix one a column. */
  function uniformVectorsOf(source: string) {
    const sizes: Record<string, number> = {
      float: 1,
      int: 1,
      bool: 1,
      vec2: 1,
      vec3: 1,
      vec4: 1,
      mat2: 2,
      mat3: 3,
      mat4: 4,
    };
    let vectors = 0;
    for (const [, type = '', , length] of source.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?\s*;/gm)) {
      const size = sizes[type];
      if (size === undefined) throw new Error(`a uniform of a type this count does not know: ${type}`);
      vectors += size * Number(length ?? 1);
    }
    return vectors;
  }

  it("reads the cascades' numbers whole, and fits a phone's vertex shader with room to spare", () => {
    const { vertexShader } = cascadeLayer();

    expect(CASCADE_NUMBERS % 4).toBe(0);
    expect(vertexShader).toContain(`uniform vec4 cascade[${CASCADE_NUMBERS / 4}];`);
    expect(CASCADE_VECTORS).toBe(CASCADE_NUMBERS / 4);
    // GLSL ES 3.00 guarantees a vertex shader 256 uniform vectors (MAX_VERTEX_UNIFORM_VECTORS); keep a
    // quarter of them free for whatever a driver packs less tightly than this count
    expect(uniformVectorsOf(vertexShader)).toBeLessThanOrEqual(192);
    expect(uniformVectorsOf(vertexShader)).toBeGreaterThan(CASCADE_VECTORS);
  });
});
