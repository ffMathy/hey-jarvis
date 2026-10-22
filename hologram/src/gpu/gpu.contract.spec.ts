import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What lets `hologram/gpu` run in four places — under `bun test`, in the headset's browser beside
 * three.js, in the phone's web build beside CanvasKit, and in a Reanimated worklet beside expo-gl —
 * is that it reaches for none of them: every value it imports is the package's own, and the context
 * it draws with is handed in. One `import { … } from 'three'` here would put three.js in the phone's
 * bundle and break the worklet; this is what keeps it out.
 *
 * It holds the same rule as the main entry's contract (`../main-entry.contract.spec.ts`), the same
 * way: every module here is parsed by Bun's own transpiler, and every import and re-export it keeps
 * — static, dynamic, by `require` or for its side effects — has to be a sibling here or one of the
 * main entry's modules. Never a barrel: `..` and `../index` reach back through the main entry's index
 * to everything it exports, and that cycle leaves what a worklet captured undefined. Never another
 * entry either: `../react` and `../conversation` are React and Skia, and the `../gpu` folder is this
 * one's own barrel.
 */

const GPU_DIR = import.meta.dir;
const MAIN_ENTRY_DIR = join(GPU_DIR, '..');

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Every module `source` imports or re-exports from, in an import not marked as a type. */
function valueImportsOf(source: string): string[] {
  return transpiler.scanImports(source).map((entry) => entry.path);
}

/** The modules directly in `directory` that are not tests, as file names. */
function modulesIn(directory: string): string[] {
  return readdirSync(directory).filter((name) => /\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name));
}

/** How the modules in `directory` are imported from here, through `prefix`, but for its barrel. */
function importPaths(directory: string, prefix: string): string[] {
  return modulesIn(directory)
    .map((name) => name.replace(/\.tsx?$/, ''))
    .filter((name) => name !== 'index')
    .map((name) => `${prefix}${name}`);
}

const ALLOWED = new Set([...importPaths(GPU_DIR, './'), ...importPaths(MAIN_ENTRY_DIR, '../')]);

/** Whether a module here may take a value from `path`: a sibling here, or one of the main entry's modules. */
function mayImportValueFrom(path: string): boolean {
  return ALLOWED.has(path);
}

describe('the gpu entry', () => {
  it("takes values from nothing but its own modules and the main entry's", () => {
    const modules = modulesIn(GPU_DIR);
    const forbidden = modules.flatMap((name) =>
      valueImportsOf(readFileSync(join(GPU_DIR, name), 'utf8'))
        .filter((path) => !mayImportValueFrom(path))
        .map((path) => `${name} imports a value from '${path}'`),
    );

    expect(modules).toContain('gpu-body.ts');
    expect(modules).toContain('index.ts');
    expect(forbidden).toEqual([]);
  });

  it("still has something to protect: the renderer takes values from its siblings and from the main entry's drawing", () => {
    const imports = valueImportsOf(readFileSync(join(GPU_DIR, 'gpu-body.ts'), 'utf8'));

    expect(imports).toContain('./body-rows');
    expect(imports).toContain('../hologram-drawing');
  });

  it('tells a module of its own or of the main entry from a barrel, another entry, or anything outside', () => {
    for (const path of ['./glsl', './gpu-body', '../hologram-drawing', '../frame-timing']) {
      expect({ path, allowed: mayImportValueFrom(path) }).toEqual({ path, allowed: true });
    }
    for (const path of [
      'three',
      'react',
      'expo-gl',
      'hologram',
      'hologram/gpu',
      '.',
      './index',
      '..',
      '../index',
      '../gpu',
      '../react',
      '../react/hologram-view',
      '../conversation',
      '../../../vr/src/hologram3d/layer-blending',
    ]) {
      expect({ path, allowed: mayImportValueFrom(path) }).toEqual({ path, allowed: false });
    }
  });

  it('counts an import the way a bundler loads it, whatever its form, and erases one of types alone', () => {
    const examples: Array<[source: string, survives: string[]]> = [
      ["import { type A, type B } from 'three';", []],
      ["import 'three';", ['three']],
      ["export function load() { return import('three'); }", ['three']],
      ["const three = require('three');", ['three']],
      ['import { Matrix4 } from "three";', ['three']],
    ];
    for (const [source, survives] of examples) {
      expect({ source, imports: valueImportsOf(source) }).toEqual({ source, imports: survives });
    }
  });
});
