#!/bin/bash
# Run the hologram package's tests.
#
# Everything here is pure TypeScript with no device in it: the drawing is put
# through a headless CanvasKit surface and the voice tracker is stepped by hand,
# so the whole suite runs on any machine with no emulator and no credential.
#
# Usage:
#   ./hologram/.scripts/test.sh                                 # all of them
#   ./hologram/.scripts/test.sh hologram/src/voice-levels.spec.ts   # specific file(s)
set -euo pipefail

if [ $# -gt 0 ]; then
  exec bun test "$@"
fi

mapfile -t files < <(
  find hologram \
    -type d -name node_modules -prune -o \
    \( -name '*.spec.ts' -o -name '*.test.ts' \) -print | sort
)

if [ ${#files[@]} -eq 0 ]; then
  echo "No hologram tests found."
  exit 0
fi

exec bun test "${files[@]}"
