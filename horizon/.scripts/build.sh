#!/bin/bash
# Build the headset app into dist/horizon.
#
# A static site and nothing else: Vite bundles the TypeScript, and copies
# `public/` — the wake-word models, their licence, and the WebAssembly that
# `turbo initialize` put in `public/vendor/` — next to it as-is. `turbo build`
# runs `initialize`, `lint` and `typecheck` first, so a build that got this far
# has all three behind it.
#
# The output lives beside the other apps' builds, where Turbo caches it and where
# the Pages workflow copies it into the published site under /horizon/.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f public/vendor/canvaskit.wasm ]; then
  echo "public/vendor/ is empty. Run: bunx turbo initialize --filter=horizon" >&2
  exit 1
fi

exec bunx vite build
