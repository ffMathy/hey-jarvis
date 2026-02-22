#!/bin/bash
# Creates a git worktree on the first user prompt so Claude works in an isolated copy.
# Runs on UserPromptSubmit — uses a state file to ensure it only fires once per session.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [[ -z "$CWD" ]]; then
  CWD="$(pwd)"
fi

# Only create one worktree per session
STATE_FILE="/tmp/claude-worktree-${SESSION_ID}"

if [[ -f "$STATE_FILE" ]]; then
  exit 0
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BRANCH_NAME="session/${TIMESTAMP}"
WORKTREE_DIR="${CWD}/.claude/worktrees/session-${TIMESTAMP}"

mkdir -p "$(dirname "$WORKTREE_DIR")"

git -C "$CWD" worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" HEAD 2>/dev/null

if [[ $? -ne 0 ]]; then
  echo "Failed to create worktree at ${WORKTREE_DIR}" >&2
  exit 0
fi

# Mark as done for this session
echo "$WORKTREE_DIR" > "$STATE_FILE"

echo "Session worktree created at: ${WORKTREE_DIR} (branch: ${BRANCH_NAME})" >&2

# Inject worktree path into Claude's conversation context
jq -n --arg dir "$WORKTREE_DIR" --arg branch "$BRANCH_NAME" '{
  hookSpecificOutput: {
    hookEventName: "WorktreeSetup",
    additionalContext: ("Session worktree created. Work in: " + $dir + " (branch: " + $branch + "). Use this path for all file operations.")
  }
}'

exit 0
