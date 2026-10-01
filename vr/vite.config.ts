import { defaultClientConditions, defineConfig } from 'vite';

/**
 * Whether `log` is Vite noting that CanvasKit's loader asks for Node's `fs` and `path`.
 *
 * It does, in the branch its Emscripten glue takes when it finds itself running under Node to
 * read the wasm from disk; in a browser that branch never runs, so the stubs Vite puts in their
 * place are never touched. The note is dropped for that one file only, so the same note about
 * anything else still reaches the build log.
 */
function isCanvasKitNodeBranch(log: { message: string }) {
  return log.message.includes('externalized for browser compatibility') && log.message.includes('canvaskit-wasm');
}

export default defineConfig({
  // Relative asset URLs, so the one build works wherever it is served from: at the root of
  // the dev server, under /hey-jarvis/vr/ on GitHub Pages, and under a custom domain
  // if the site ever gets one. An absolute base would have to be told the Pages prefix
  // through an environment variable, which Turbo does not hash, so a cached build for one
  // prefix could be replayed for another.
  base: './',
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
      onLog(level, log, defaultHandler) {
        if (isCanvasKitNodeBranch(log)) return;
        defaultHandler(level, log);
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
