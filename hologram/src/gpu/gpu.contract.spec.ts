import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What lets `hologram/gpu` run in four places — under `bun test`, in the headset's browser beside
 * three.js, in the phone's web build beside CanvasKit, and in a Reanimated worklet beside expo-gl —
 * is that it reaches for none of them: every value it imports is the package's own, and the context
 * it draws with is handed in. One `import { … } from 'three'` here would put three.js in the phone's
 * bundle and break the worklet; this is what keeps it out.
 */

const GPU_DIR = import.meta.dir;

function sources() {
  return readdirSync(GPU_DIR).filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'));
}

/** Every module a source imports a value from: `import type` is erased, and is allowed from anywhere. */
function valueImports(name: string): string[] {
  const source = readFileSync(join(GPU_DIR, name), 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+'([^']+)'/gms)) {
    found.push(match[1] ?? '');
  }
  return found;
}

describe('the gpu entry', () => {
  it('imports values only from inside the package', () => {
    const outside = sources().flatMap((name) =>
      valueImports(name)
        .filter((module) => !module.startsWith('./') && !module.startsWith('../'))
        .map((module) => `${name}: ${module}`),
    );
    expect(sources().length).toBeGreaterThan(5);
    expect(outside).toEqual([]);
  });

  it('never reaches back into the main entry’s barrel, which would make a cycle a worklet captures as undefined', () => {
    const throughIndex = sources().flatMap((name) =>
      valueImports(name)
        .filter((module) => module === '..' || module === '../index' || module === 'hologram')
        .map((module) => `${name}: ${module}`),
    );
    expect(throughIndex).toEqual([]);
  });
});
