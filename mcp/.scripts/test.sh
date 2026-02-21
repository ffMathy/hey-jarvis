#!/bin/bash
# Run mcp tests. If specific files are passed as arguments, run only those.
# Otherwise, run the full default test suite.
#
# Usage:
#   ./mcp/.scripts/test.sh                          # all tests
#   ./mcp/.scripts/test.sh mcp/mastra/utils/providers/ollama-provider.spec.ts  # specific file

if [ $# -gt 0 ]; then
  exec bun test "$@"
else
  exec bun test mcp/tests/*.spec.ts mcp/tests/*.test.ts mcp/mastra
fi
