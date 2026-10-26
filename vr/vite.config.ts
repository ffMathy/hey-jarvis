import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** The Node built-ins CanvasKit's loader asks for, and the module that stands in for them. */
const CANVASKIT_NODE_BUILTINS = new Set(['fs', 'path']);
const CANVASKIT_NODE_STUB = '\0canvaskit-node-stub';

/** Whether a module's path is a file of the `canvaskit-wasm` package, wherever the linker put it. */
const CANVASKIT_FILE = /[\\/]node_modules[\\/]canvaskit-wasm[\\/]/;

/**
 * Gives CanvasKit's loader an empty module for Node's `fs` and `path`, before Vite's resolver
 * externalizes them and warns that it did.
 *
 * It asks for them in the branch its Emscripten glue takes when it finds itself running under Node
 * to read the wasm from disk; in a browser that branch never runs, so the stub is never touched.
 * Only that package's imports are stubbed, so the same import from anything else still reaches
 * Vite's resolver, and its warning still reaches the build log. The importer's path decides it,
 * not the warning: Vite's warning carries nothing but its text and the resolver's name.
 */
function canvasKitNodeStubs(): Plugin {
  return {
    name: 'canvaskit-node-stubs',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && CANVASKIT_FILE.test(importer) && CANVASKIT_NODE_BUILTINS.has(source)) {
        return CANVASKIT_NODE_STUB;
      }
      return null;
    },
    load(id) {
      return id === CANVASKIT_NODE_STUB ? 'module.exports = {};' : null;
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so the one build works wherever it is served from: at the root of
  // the dev server, under /hey-jarvis/vr/ on GitHub Pages, and under a custom domain
  // if the site ever gets one. An absolute base would have to be told the Pages prefix
  // through an environment variable, which Turbo does not hash, so a cached build for one
  // prefix could be replayed for another.
  base: './',
  plugins: [canvasKitNodeStubs()],
  resolve: {
    // One copy of each, whatever the linker does. `@elevenlabs/client` brings its own
    // `livekit-client` range and the conversation code checks `instanceof Room` against
    // the app's copy; two copies of three would be two renderers' worth of state that
    // cannot see each other's objects.
    dedupe: ['livekit-client', 'three'],
    // onnxruntime-web's wasm entry without its 14 MB wasm inlined into the bundle: with this
    // condition it imports its glue from the `wasmPaths` the wake worker gives it — the site's
    // own `vendor/`, where `turbo initialize` copies it — and runs the wasm the worker already
    // downloaded for its progress bar. Setting `conditions` replaces Vite's defaults, so they
    // are listed again after it.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  worker: {
    // The wake word runs in a module worker, which is what a browser that has WebXR
    // supports anyway.
    format: 'es',
  },
  build: {
    // Quest Browser tracks current Chromium, and WebXR needs all of this and more.
    target: 'es2022',
    // Beside the other apps' builds, where Turbo's `build` outputs already look and where
    // the Pages workflow picks it up from.
    outDir: '../dist/vr',
    // Vite refuses to empty a directory outside its root unless told to; without this a
    // file removed from `public/` would linger in the build.
    emptyOutDir: true,
    // three's WebGL renderer is about 520 kB minified on its own and is needed whole the moment
    // the room opens, so there is nothing to gain by cutting it up. The limit sits just above it,
    // so the warning still fires for anything that grows past three's size.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      // Two pages: the app, and the preview that shows Jarvis in 3D on a desktop and walks him
      // through every phase — published beside it, at /hey-jarvis/vr/preview.html.
      input: {
        main: 'index.html',
        preview: 'preview.html',
      },
      output: {
        codeSplitting: {
          // three in a file of its own: it changes far less often than the app does, so a
          // headset that has the site cached keeps it across deploys instead of fetching the
          // renderer again with every change to Jarvis.
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?three[\\/]/ },
          ],
        },
      },
    },
  },
});
