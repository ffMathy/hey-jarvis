/**
 * Serves the built headset app the way GitHub Pages does, for the browser tests and for the
 * scripts that draw on its pages (`render-picture-goldens.ts` serves it with {@link serveBuild}).
 *
 * Under its real sub-path, /hey-jarvis/vr/, and nowhere else. A page that asks for any
 * of its files from the domain root — an absolute asset URL, a wasm fetched from `/` — gets
 * a 404 here exactly as it would on Pages, so the tests fail on the mistake instead of the
 * published site. That is also why this is the build and not the dev server: Vite's dev
 * server rewrites paths the published site never sees.
 *
 * Usage: bun .scripts/serve-dist.ts [port]   (from vr/; the port defaults to 8098)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Where Pages publishes the app: the project site's prefix, then the folder the workflow copies it into. */
export const SITE_PREFIX = '/hey-jarvis/vr/';

const DEFAULT_PORT = 8098;

const root = path.resolve(import.meta.dir, '../../dist/vr');

/**
 * The file a request path names inside the build, or undefined when it names nothing there.
 *
 * Paths that climb out of the build with `..` name nothing: this server only ever hands out
 * what `vite build` wrote.
 */
export function resolveBuiltFile(buildRoot: string, pathname: string): string | undefined {
  if (!pathname.startsWith(SITE_PREFIX)) return undefined;
  const relative = decodeURIComponent(pathname.slice(SITE_PREFIX.length)) || 'index.html';
  const resolved = path.resolve(buildRoot, relative);
  if (!resolved.startsWith(buildRoot + path.sep)) return undefined;
  return resolved;
}

/** Whether `vite build` has written the app where this serves it from. */
export function isBuilt() {
  return existsSync(path.join(root, 'index.html'));
}

/**
 * Serves the build on `port` until the server is stopped; 0 takes any free port, and the server
 * says which. It is listening once this returns, so a script can serve the build in its own process
 * and open a page on it straight away.
 */
export function serveBuild(port: number) {
  return Bun.serve({
    port,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      // Pages answers the folder without its slash with a redirect to it, and the page's
      // relative URLs only resolve against the slashed form.
      if (`${pathname}/` === SITE_PREFIX) {
        return Response.redirect(SITE_PREFIX, 301);
      }
      const file = resolveBuiltFile(root, pathname);
      if (file === undefined || !(await Bun.file(file).exists())) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(Bun.file(file));
    },
  });
}

if (import.meta.main) {
  if (!isBuilt()) {
    console.error(`${root} has no build in it. Run: bunx turbo build --filter=vr`);
    process.exit(1);
  }

  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  serveBuild(port);
  console.log(`Serving ${root} at http://localhost:${port}${SITE_PREFIX}`);
}
