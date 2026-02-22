#!/bin/bash
# Blocks git and gh commands from being run via the Bash tool.
# All git/GitHub operations should go through hooks or manual action.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Check if the command contains git or gh as a standalone command.
# Matches: git ..., gh ..., && git ..., ; git ..., | git ..., $(git ..., `git ...
# Does NOT match: .git, gitignore, github, etc.
if echo "$COMMAND" | grep -qE '(^|[;&|`(]|&&|\|\|)\s*(git|gh)\b'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Git and GitHub CLI commands are blocked. All git operations are managed by hooks or must be run manually by the user."
    }
  }'
  exit 0
fi

exit 0
