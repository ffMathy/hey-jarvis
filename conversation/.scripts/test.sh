#!/bin/bash
# Run the conversation package's tests.
#
# Everything here is offline by design. The token request is driven through an
# injected `fetch`, so every failure ElevenLabs can answer with is exercised
# without an account, a credential or a device.
#
# Usage:
#   ./conversation/.scripts/test.sh                                        # all of them
#   ./conversation/.scripts/test.sh conversation/src/conversation-token.spec.ts   # specific file(s)
set -euo pipefail

if [ $# -gt 0 ]; then
  exec bun test "$@"
fi

mapfile -t files < <(
  find conversation \
    -type d -name node_modules -prune -o \
    \( -name '*.spec.ts' -o -name '*.test.ts' \) -print | sort
)

if [ ${#files[@]} -eq 0 ]; then
  echo "No conversation tests found."
  exit 0
fi

exec bun test "${files[@]}"
