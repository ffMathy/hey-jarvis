# Conventional Commits

**CRITICAL: ALWAYS follow Conventional Commits format** for commit messages *and* pull request titles. `commitlint` runs in the `commit-msg` Git hook and rejects anything else.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Formatting (no code change)
- **refactor**: Code change (no bug fix or feature)
- **perf**: Performance improvement
- **test**: Adding/refactoring tests
- **chore**: Maintenance tasks
- **build**: Build system changes
- **ci**: CI configuration changes

## Scopes

Use project-specific scopes:

**Root level:** `deps`, `config`, `ci`, `build`

**MCP project:** `mcp`, `agents`, `workflows`, `tools`, `weather`, `shopping`, `cooking`, `coding`

**Other projects:** `firmware`, `elevenlabs`

## Subject Line Rules

- Keep under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter
- No period at end
- Reference issues in the footer: `Closes #123`

## Breaking Changes

Add `!` before the colon:

```
feat(api)!: change authentication method

BREAKING CHANGE: Auth now requires an API key instead of username/password
```

## Examples

```
feat(mcp): add calendar agent for scheduling
fix(shopping): correct product quantity calculation
docs(agents): update workflow examples
```

## What NOT to Do

❌ Don't use vague subjects like "fix bug" or "update code"
❌ Don't capitalize the subject line
❌ Don't end the subject with a period
❌ Don't mix multiple types in one commit
❌ Don't forget the scope when one applies
❌ Don't exceed 72 characters in the subject
❌ Don't bypass the hook with `git commit --no-verify`
