/**
 * Serves the built headset app the way GitHub Pages does, for the browser tests.
 *
 * Under its real sub-path, /hey-jarvis/horizon/, and nowhere else. A page that asks for any
 * of its files from the domain root — an absolute asset URL, a wasm fetched from `/` — gets
 * a 404 here exactly as it would on Pages, so the tests fail on the mistake instead of the
 * published site. That is also why this is the build and not the dev server: Vite's dev
 * server rewrites paths the published site never sees.
 *
 * Usage: bun .scripts/serve-dist.ts [port]   (from horizon/; the port defaults to 8098)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Where Pages publishes the app: the project site's prefix, then the folder the workflow copies it into. */
export const SITE_PREFIX = '/hey-jarvis/horizon/';

const DEFAULT_PORT = 8098;

const root = path.resolve(import.meta.dir, '../../dist/horizon');

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

if (import.meta.main) {
  if (!existsSync(path.join(root, 'index.html'))) {
    console.error(`${root} has no build in it. Run: bunx turbo build --filter=horizon`);
    process.exit(1);
  }

  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  Bun.serve({
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
  console.log(`Serving ${root} at http://localhost:${port}${SITE_PREFIX}`);
}
