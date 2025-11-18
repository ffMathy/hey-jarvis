# Git Hooks with Husky

This repository uses [Husky](https://typicode.github.io/husky/) and [commitlint](https://commitlint.js.org/) to enforce commit message standards locally.

## What's Configured

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
```

**Bypass validation?** (not recommended)
```bash
git commit --no-verify -m "emergency fix"
```
