#!/bin/bash
# Block Claude from reading files named "op.env.local"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$(basename "$FILE_PATH")" == "op.env.local" ]]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Reading op.env.local files is not allowed — they contain sensitive secrets managed by 1Password."
    }
  }'
  exit 0
fi

exit 0
