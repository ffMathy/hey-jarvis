#!/bin/bash
# Run elevenlabs tests.
#
# The suite is split in two by file name. `*.integration.spec.ts` deploys the
# test agent, brings up a tunnel and holds real conversations, so it needs real
# credentials; everything else is offline detector coverage that runs on every
# push.
#
# Usage:
#   ./elevenlabs/.scripts/test.sh                              # mocked tests only
#   ./elevenlabs/.scripts/test.sh --integration                # integration tests only
#   ./elevenlabs/.scripts/test.sh elevenlabs/tests/specs/routing-loop.spec.ts  # specific file(s)
set -euo pipefail

mode=unit
if [ "${1:-}" = '--integration' ]; then
  mode=integration
  shift
fi

rm -rf dist/elevenlabs-spec

# An explicit file list wins over either default set.
if [ $# -gt 0 ]; then
  exec bun test "$@"
fi

if [ "$mode" = 'integration' ]; then
  mapfile -t files < <(find elevenlabs/tests -name '*.integration.spec.ts' | sort)
else
  mapfile -t files < <(
    find elevenlabs/tests \
      \( -name '*.spec.ts' -o -name '*.test.ts' \) \
      -not -name '*.integration.spec.ts' | sort
  )
fi

if [ ${#files[@]} -eq 0 ]; then
  echo "No elevenlabs ${mode} tests found."
  exit 0
fi

exec bun test "${files[@]}"
