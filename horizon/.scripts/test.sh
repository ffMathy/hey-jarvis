#!/bin/bash
# Run the headset app's tests.
#
# Everything here is offline by design: pure TypeScript with no headset, no
# browser and no credential in it, so it runs on every push alongside the rest
# of the mocked suite. The room itself — WebXR, the passthrough, the hologram on
# screen — is the Playwright suite's (`bunx turbo e2e --filter=horizon`).
#
# Usage:
#   ./horizon/.scripts/test.sh                                  # all of them
#   ./horizon/.scripts/test.sh horizon/src/wake/models.spec.ts  # specific file(s)
set -euo pipefail

# An explicit file list wins over the default set.
if [ $# -gt 0 ]; then
  exec bun test "$@"
fi

# horizon/tests/e2e holds Playwright specs, which import `@playwright/test` and
# would fail outright under `bun test`. Integration specs never belong to
# `turbo test` (see .claude/rules/validation.md); there are none yet, and this
# keeps it that way if one is added.
mapfile -t files < <(
  find horizon \
    -type d -name node_modules -prune -o \
    \( -name '*.spec.ts' -o -name '*.test.ts' \) \
    -not -path '*/e2e/*' -not -name '*.integration.spec.ts' -print | sort
)

if [ ${#files[@]} -eq 0 ]; then
  echo "No horizon tests found."
  exit 0
fi

exec bun test "${files[@]}"
