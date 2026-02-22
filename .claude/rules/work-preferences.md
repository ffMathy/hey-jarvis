# Work Preferences

Enforced preferences for how Claude operates in this project.

## Background Tasks with Worktrees

When spawning Task agents, **always** use both:
- `run_in_background: true` — so the user can continue working in parallel
- `isolation: "worktree"` — so the agent works in an isolated copy of the repo

## Session Worktree

On the first user prompt, a `UserPromptSubmit` hook creates a git worktree and injects the path into the conversation via `hookSpecificOutput`. When the hook reports a worktree path:
- Use the worktree path as the base for all file operations (Read, Edit, Write, Glob, Grep)
- Run Bash commands within the worktree directory

## No Git via Bash

A hook blocks all `git` and `gh` commands from the Bash tool. Git operations are managed by hooks or performed manually by the user. Do not attempt to run git commands through Bash — they will be denied.
