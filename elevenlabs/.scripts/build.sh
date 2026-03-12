#!/bin/bash
set -e

# Navigate to workspace root (script lives in elevenlabs/.scripts/)
cd "$(dirname "$0")/../.."

SOURCEMAP="${SOURCEMAP:-false}"

bunx esbuild elevenlabs/src/main.ts \
  --platform=node \
  --format=esm \
  --bundle=false \
  --outdir=dist/elevenlabs \
  --sourcemap="${SOURCEMAP}"
