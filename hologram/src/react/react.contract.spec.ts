import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The line between what a screen may import at startup and what only the view may.
 *
 * Only the view draws with expo-gl, and on a device loading it asks for its native module as it loads
 * and throws in a build without one: the view requires it only once it has found the module
 * (`gl-context.ts`), and a screen that reached it eagerly would skip that check. So `lifecycle.ts` and
 * `sample.ts`, everything they import, and the `hologram/conversation` entry keep clear of it.
 *
 * It began as the same rule for Skia, which in a browser was only usable once CanvasKit's
 * WebAssembly had loaded, and it turned the published site black once: a screen reached into
 * `hologram/react` for a number, which pulled the view in with it. Skia is gone; the entries are
 * still how a screen reaches the parts it needs without the view.
 *
 * What counts as an import is what Bun's own transpiler keeps of a module: an import, a re-export or a
 * `require` that is not erased as types only.
 */

const REACT_DIR = import.meta.dir;
const CONVERSATION_DIR = join(REACT_DIR, '..', 'conversation');

/**
 * Every local module `file` imports, followed as far as it goes — within its own folder, which is
 * where every module these entries reach lives, apart from the main entry's type-only files.
 */
function reachableFrom(directory: string, file: string, seen = new Set<string>()): Set<string> {
  const path = join(directory, file);
  if (seen.has(path)) {
    return seen;
  }
  seen.add(path);
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/from '(\.\/[^']+)'/g)) {
    const relative = match[1] ?? '';
    const candidates = readdirSync(directory).filter(
      (name) => name === `${relative.slice(2)}.ts` || name === `${relative.slice(2)}.tsx`,
    );
    for (const candidate of candidates) {
      reachableFrom(directory, candidate, seen);
    }
  }
  return seen;
}

const EXPO_GL = 'expo-gl';

const transpiler = new Bun.Transpiler({ loader: 'tsx' });

/** Whether a module loads `name`, or a module inside it, in an import that survives into the bundle. */
function loads(path: string, name: string): boolean {
  return transpiler
    .scanImports(readFileSync(path, 'utf8'))
    .some((entry) => entry.path === name || entry.path.startsWith(`${name}/`));
}

/** Whether a module loads expo-gl, which a screen may not reach before the view. */
function loadsGl(path: string): boolean {
  return loads(path, EXPO_GL);
}

describe('what a screen may import before the view', () => {
  it('keeps the lifecycle entry, and everything it reaches, clear of expo-gl', () => {
    const reachable = [...reachableFrom(REACT_DIR, 'lifecycle.ts')];

    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable.filter(loadsGl)).toEqual([]);
  });

  it('keeps the sample entry, and everything it reaches, clear of expo-gl', () => {
    const reachable = [...reachableFrom(REACT_DIR, 'sample.ts')];

    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable.filter(loadsGl)).toEqual([]);
  });

  it('keeps the conversation entry, and everything it reaches, clear of expo-gl', () => {
    // A screen holds the conversation — and plays the greeting it opens with — whether or not the
    // view can draw, and the watch's waiting screen before it is shown.
    const reachable = [...reachableFrom(CONVERSATION_DIR, 'index.ts')];

    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable.filter(loadsGl)).toEqual([]);
  });

  it('still has something to protect: the view itself reaches expo-gl, through gl-context alone', () => {
    // If this ever stops being true the tests above have become tautologies.
    const reachable = [...reachableFrom(REACT_DIR, 'hologram-view.tsx')];
    expect(reachable.filter((path) => loads(path, EXPO_GL)).map((path) => basename(path))).toEqual(['gl-context.ts']);
  });

  it('counts a require as a load, and an import of types only as none', () => {
    expect(transpiler.scanImports("const gl = require('expo-gl');").map((entry) => entry.path)).toEqual([EXPO_GL]);
    expect(transpiler.scanImports("import type { GLView } from 'expo-gl';\nexport {};")).toEqual([]);
  });
});
