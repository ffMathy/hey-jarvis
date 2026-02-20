#!/bin/bash
# Runs biome lint on files after Claude edits them

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only lint file types that biome supports
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.jsonc|*.css)
    npx biome check --write "$FILE_PATH" 2>&1
    ;;
esac

exit 0
