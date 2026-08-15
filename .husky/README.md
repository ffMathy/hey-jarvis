# Git Hooks

This repository uses plain git hooks in this directory plus [commitlint](https://commitlint.js.org/) to enforce commit message standards locally.

Dependency install scripts are disabled repo-wide (see [Supply Chain Security](../AGENTS.md#supply-chain-security)), so nothing installs these hooks automatically. Point git at them once per clone:

```bash
bun run prepare   # git config core.hooksPath .husky
```

The DevContainer does this for you during initialization.

## What's Configured

`pre-commit` rejects foreign package-manager lockfiles and runs lint-staged; `commit-msg` runs commitlint.

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>
```

**Valid types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`

**Examples**:
- ✅ `feat(mcp): add calendar agent`
- ✅ `fix(elevenlabs): correct voice synthesis`
- ❌ `Update files` (will be rejected)

## Testing

```bash
# Test invalid message
echo "Test commit" | bunx commitlint
# Output: ✖ found 2 problems

# Test valid message
echo "feat(mcp): add new feature" | bunx commitlint
# Output: (no errors)
```

## Troubleshooting

**Hooks not running?**
```bash
bun run prepare
git config core.hooksPath   # should print .husky
```

**Bypass validation?** (not recommended)
```bash
git commit --no-verify -m "emergency fix"
```
