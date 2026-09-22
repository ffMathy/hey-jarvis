import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The line between what a browser may import at startup and what it may not.
 *
 * `@shopify/react-native-skia` is only usable in a browser once CanvasKit's WebAssembly has
 * loaded, and it captures what it finds the first time it is evaluated. Import it before then —
 * even indirectly, even for a constant — and `Skia` is undefined for the life of the page, and the
 * first call on it throws. The app's whole arrangement for avoiding that is a lazy `import()` in
 * `jarvis-hologram.web.tsx`, and one eager import from the wrong entry defeats it.
 *
 * That is not a hypothetical. It turned the published site black: a screen reached into
 * `hologram/react` for a number, which pulled the view in with it, and the hologram never drew
 * again. Nothing about it failed loudly — the error was in the browser's console, on a phone.
 *
 * So the rule is a rule, and this is what holds it: `lifecycle.ts` and `sample.ts`, and everything
 * they import, are Skia-free — and so is the `hologram/conversation` entry, for the same reason.
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

/** Whether a module names Skia in an import that survives into the bundle. */
function importsSkia(path: string): boolean {
  const source = readFileSync(path, 'utf8');
  return /^import (?!type )[^;]*from '@shopify\/react-native-skia'/m.test(source);
}

describe('what a browser may import before CanvasKit has loaded', () => {
  it('keeps the lifecycle entry, and everything it reaches, clear of Skia', () => {
    const reachable = [...reachableFrom(REACT_DIR, 'lifecycle.ts')];

    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable.filter(importsSkia)).toEqual([]);
  });

  it('keeps the sample entry, and everything it reaches, clear of Skia', () => {
    const reachable = [...reachableFrom(REACT_DIR, 'sample.ts')];

    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable.filter(importsSkia)).toEqual([]);
  });

  it('keeps the conversation entry, and everything it reaches, clear of Skia', () => {
    // A screen holds the conversation — and plays the greeting it opens with — before CanvasKit has
    // loaded in a browser, which is the whole reason this entry is not part of `hologram/react`.
    const reachable = [...reachableFrom(CONVERSATION_DIR, 'index.ts')];

    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable.filter(importsSkia)).toEqual([]);
  });

  it('still has something to protect: the view itself does import Skia', () => {
    // If this ever stops being true the test above has become a tautology, and the real rule —
    // that the view is only ever reached lazily on web — would be going unchecked.
    expect(importsSkia(join(REACT_DIR, 'hologram-view.tsx'))).toBe(true);
  });
});
