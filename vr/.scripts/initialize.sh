#!/bin/bash
# Put the WebAssembly the headset app loads at runtime into public/vendor/.
#
# Two engines run in the page and neither can be bundled: CanvasKit draws Jarvis
# (the same Skia the phone's web build uses), and onnxruntime-web runs the wake
# word. Each fetches its .wasm at runtime from a URL the app gives it, and the
# app points both at `./vendor/`, so the files have to sit there, next to the
# page, whether it is served by Vite, by the e2e server or by GitHub Pages. A
# browser never reaches for a CDN.
#
# Nothing is downloaded: every file comes out of a package `bun install` already
# fetched and locked. They are gitignored rather than committed because they are
# 20 MB that the lockfile already pins exactly.
#
# The paths are resolved the way the bundler resolves the packages, from this
# folder, rather than spelled out: Bun's isolated store puts each package under a
# hashed directory whose name changes with its dependency closure.
#
#   canvaskit.wasm                  CanvasKit's full build — the one React Native
#                                   Skia's web API expects, and the one the phone's
#                                   web build ships.
#   ort-wasm-simd-threaded.wasm     What `onnxruntime-web/wasm` instantiates.
#   ort-wasm-simd-threaded.mjs      Its Emscripten glue, which the wasm-only entry
#                                   imports from the same folder when it is built
#                                   with the `onnxruntime-web-use-extern-wasm`
#                                   condition instead of carrying it inline.
set -euo pipefail

cd "$(dirname "$0")/.."

vendor=public/vendor
mkdir -p "$vendor"

files=(
  canvaskit-wasm/bin/full/canvaskit.wasm
  onnxruntime-web/ort-wasm-simd-threaded.wasm
  onnxruntime-web/ort-wasm-simd-threaded.mjs
)

for specifier in "${files[@]}"; do
  resolved=$(bun -e 'console.log(Bun.resolveSync(process.argv[1], process.cwd()))' "$specifier")
  cp "$resolved" "$vendor/"
done
