import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the main entry may import: its own siblings, and nothing else as a value.
 *
 * That rule is what lets the one scene, the one frame clock and the one conversation run in four
 * places — a Reanimated worklet on a phone and a watch, a browser, these tests, and the headset,
 * which has no React at all (`.claude/rules/hologram-the-rule-that-makes-this-package-work.md`, "The
 * rule that makes this package work"). A value imported from anywhere else is a module every one of
 * them has to load: React Native's root under `bun test`, React on the headset. It loads fine
 * wherever it was written, and fails in the other three — on a device, the worklets have captured it
 * by then.
 *
 * So the rule is checked rather than remembered. Every module directly in this folder is parsed by
 * Bun's own transpiler, and every import and re-export it keeps is listed — static, dynamic or by
 * `require`. What it erases is not: `import type`, `export type`, braces whose every specifier is
 * marked `type`, and anything in a comment or a string. An import not marked `type` is counted even
 * where only types are used from it, because whether a bundler drops it then is the bundler's
 * setting to decide, not this package's; the way to say it is a type is to mark it one. A sibling
 * here is in the main entry, so it may be imported freely; `./react`, `./conversation` and `./gpu`
 * are folders, other entries, and may not be, and nor may the `./index` barrel, which a sibling
 * would import itself through.
 */

const MAIN_ENTRY_DIR = import.meta.dir;

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Every module `source` imports or re-exports from, in an import not marked as a type: see above. */
function valueImportsOf(source: string): string[] {
  return transpiler.scanImports(source).map((entry) => entry.path);
}

/** The main entry's modules: everything directly in this folder that is not a test. */
function mainEntryModules(): string[] {
  return readdirSync(MAIN_ENTRY_DIR).filter((name) => /\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name));
}

/** How the main entry's modules are imported, but for its barrel: `./tilt` for `tilt.ts`. */
const SIBLINGS = new Set(
  mainEntryModules()
    .map((name) => `./${name.replace(/\.tsx?$/, '')}`)
    .filter((path) => path !== './index'),
);

/** Whether a value may come from `path`: a module directly in this folder. */
function mayImportValueFrom(path: string): boolean {
  return SIBLINGS.has(path);
}

describe('the main entry', () => {
  it('takes values from nothing but its own modules', () => {
    const modules = mainEntryModules();
    const forbidden = modules.flatMap((name) =>
      valueImportsOf(readFileSync(join(MAIN_ENTRY_DIR, name), 'utf8'))
        .filter((path) => !mayImportValueFrom(path))
        .map((path) => `${name} imports a value from '${path}'`),
    );

    expect(modules).toContain('hologram-drawing.ts');
    expect(modules).toContain('index.ts');
    expect(forbidden).toEqual([]);
  });

  it('tells a module of its own from another entry, a barrel or anything outside', () => {
    for (const path of ['./tilt', './hologram-drawing']) {
      expect({ path, allowed: mayImportValueFrom(path) }).toEqual({ path, allowed: true });
    }
    for (const path of [
      './react',
      './conversation',
      './gpu',
      './react/hologram-view',
      './index',
      '.',
      '../x',
      'react-native',
      'hologram',
    ]) {
      expect({ path, allowed: mayImportValueFrom(path) }).toEqual({ path, allowed: false });
    }
  });

  it('still has something to protect: a module takes a sibling as a value, and another one only as types', () => {
    // If the scan stopped seeing value imports, or started counting type-only ones, the test above
    // would pass or fail for the wrong reason.
    const satellites = readFileSync(join(MAIN_ENTRY_DIR, 'satellite-drawing.ts'), 'utf8');
    const dropped = readFileSync(join(MAIN_ENTRY_DIR, 'connection-drop.ts'), 'utf8');

    expect(valueImportsOf(satellites)).toEqual(['./agent-work']);
    expect(dropped).toContain("import type { SessionEnding } from './session-contract';");
    expect(valueImportsOf(dropped)).toEqual([]);
  });

  it('counts every import not marked as a type, and nothing that is', () => {
    const examples: Array<[source: string, survives: string[]]> = [
      ["import type { A } from 'erased';", []],
      ["import { type A, type B } from 'erased';", []],
      ["export type { A } from 'erased';", []],
      ["export { type A } from 'erased';", []],
      ["export type * from 'erased';", []],
      ["// import { A } from 'erased';\nconst text = \"import { B } from 'erased'\";", []],
      ["import { type A, B } from 'kept';", ['kept']],
      ["import { A } from 'kept';\nexport const typed: A = 1;", ['kept']],
      ["import A from 'kept';", ['kept']],
      ["import * as A from 'kept';", ['kept']],
      ["import 'kept';", ['kept']],
      ["export { A } from 'kept';", ['kept']],
      ["export * from 'kept';", ['kept']],
      ["export async function load() { return import('kept'); }", ['kept']],
      ["export const loaded = require('kept');", ['kept']],
    ];
    for (const [source, survives] of examples) {
      expect({ source, imports: valueImportsOf(source) }).toEqual({ source, imports: survives });
    }
  });
});
