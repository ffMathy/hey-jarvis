#!/bin/bash
set -e

# Navigate to workspace root (script lives in elevenlabs/.scripts/)
cd "$(dirname "$0")/../.."

if [ ! -f "elevenlabs/src/main.ts" ]; then
  echo "❌ Missing entrypoint: elevenlabs/src/main.ts"
  exit 1
fi

echo "✅ No build output required for elevenlabs (executed directly with Bun + TypeScript)."
