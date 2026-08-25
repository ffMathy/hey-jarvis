#!/bin/bash
# Run mcp tests.
#
# The suite is split in two by file name. `*.integration.spec.ts` needs real
# credentials and talks to real services; everything else is mocked and runs
# offline, so it can go on every push without a single secret in the job.
#
# Usage:
#   ./mcp/.scripts/test.sh                          # mocked tests only
#   ./mcp/.scripts/test.sh --integration            # integration tests only
#   ./mcp/.scripts/test.sh mcp/mastra/utils/retry.spec.ts   # specific file(s)
set -euo pipefail

mode=unit
if [ "${1:-}" = '--integration' ]; then
  mode=integration
  shift
fi

# An explicit file list wins over either default set.
if [ $# -gt 0 ]; then
  exec bun test "$@"
fi

# mcp/tests/e2e holds Playwright specs, which are driven by `turbo e2e`, not here.
if [ "$mode" = 'integration' ]; then
  mapfile -t files < <(
    find mcp/tests mcp/mastra -name '*.integration.spec.ts' -not -path '*/e2e/*' | sort
  )
else
  mapfile -t files < <(
    find mcp/tests mcp/mastra \
      \( -name '*.spec.ts' -o -name '*.test.ts' \) \
      -not -name '*.integration.spec.ts' \
      -not -path '*/e2e/*' | sort
  )
fi

if [ ${#files[@]} -eq 0 ]; then
  echo "No mcp ${mode} tests found."
  exit 0
fi

exec bun test "${files[@]}"
