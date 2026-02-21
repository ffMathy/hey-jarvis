#!/bin/bash
# Run elevenlabs tests. If specific files are passed as arguments, run only those.
# Otherwise, run the full default test suite.
#
# Usage:
#   ./elevenlabs/.scripts/test.sh                              # all tests
#   ./elevenlabs/.scripts/test.sh elevenlabs/tests/my.spec.ts  # specific file

rm -rf dist/elevenlabs-spec

if [ $# -gt 0 ]; then
  exec bun test "$@"
else
  exec bun test elevenlabs/tests
fi
