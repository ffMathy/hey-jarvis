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

# Bun gives every test five seconds unless it says otherwise, which is a fine default for a mocked
# test and a bad one for a test that waits on a real server, a real API or a model.
#
# It is worse than slow here. **When a test times out, Bun kills every process it spawned** — the
# "killed N dangling process" line — and several of these files spawn the MCP server in `beforeAll`
# and share it across the file. So one test running over does not fail by itself; it takes the
# server down and every later test in that file with it. That is how `mcp-client-connection`
# failed in CI: its first test wanted longer than five seconds to reach a server that had only just
# started, and the two that followed then had no server to reach.
#
# Tests that know they are slow still say so themselves. This is only the floor, so that forgetting
# costs a slow test rather than a whole file.
bun_arguments=()
if [ "$mode" = 'integration' ]; then
  bun_arguments+=(--timeout 60000)
fi

# An explicit file list wins over either default set.
if [ $# -gt 0 ]; then
  exec bun test "${bun_arguments[@]}" "$@"
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

exec bun test "${bun_arguments[@]}" "${files[@]}"
