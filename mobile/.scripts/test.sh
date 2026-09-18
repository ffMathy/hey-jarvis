#!/bin/bash
# Run mobile tests.
#
# Everything here is offline by design. The suite covers the pure TypeScript
# this app owns — the assist deep link, the audio tap, the sample moods, and the
# handover contract it shares with the watch — and none of it needs a device, an
# emulator or a credential, so it runs on every push alongside the rest of the
# mocked suite.
#
# What is *not* here is anything the watch also has: the sphere, the voice
# tracker, the ElevenLabs credentials and the token client all moved to the
# `hologram` package as the watch grew into a second Jarvis, and they are tested
# there (`bunx turbo test --filter=hologram`).
#
# Usage:
#   ./mobile/.scripts/test.sh                              # all mobile tests
#   ./mobile/.scripts/test.sh mobile/src/assist-link.spec.ts   # specific file(s)
set -euo pipefail

# An explicit file list wins over the default set.
if [ $# -gt 0 ]; then
  exec bun test "$@"
fi

# mobile/tests/e2e holds Playwright specs, which are driven by `turbo e2e`, not
# here — they import `@playwright/test` and would fail outright under `bun test`.
mapfile -t files < <(
  find mobile \
    -type d -name node_modules -prune -o \
    \( -name '*.spec.ts' -o -name '*.test.ts' \) -not -path '*/e2e/*' -print | sort
)

if [ ${#files[@]} -eq 0 ]; then
  echo "No mobile tests found."
  exit 0
fi

exec bun test "${files[@]}"
