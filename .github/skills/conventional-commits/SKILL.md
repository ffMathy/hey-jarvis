---
name: conventional-commits
description: Commit message standards following Conventional Commits specification. Use this when writing commit messages for the Hey Jarvis project.
---

# Conventional Commits Standards

**CRITICAL: ALWAYS follow Conventional Commits format**

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

**Root level:**
- `deps`, `config`, `ci`, `build`

**MCP project:**
- `mcp`, `agents`, `workflows`, `tools`
- `weather`, `shopping`, `cooking`, `coding`

**Other projects:**
- `addon`, `firmware`, `elevenlabs`

## Examples

```bash
feat(mcp): add calendar agent for scheduling
fix(shopping): correct product quantity calculation
docs(agents): update workflow examples
feat(api)!: change authentication method

BREAKING CHANGE: Auth now requires API key
```

## Subject Line Rules

- Keep under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter
- No period at end
- Reference issues in footer: `Closes #123`

## Breaking Changes

Add `!` before colon for breaking changes:

```bash
feat(api)!: change authentication method

BREAKING CHANGE: Auth now requires API key instead of username/password
```

## Pull Request Titles

PR titles must also follow Conventional Commits format:

```bash
feat(mcp): add calendar agent for scheduling
fix(shopping): correct product quantity calculation
```

## Multi-line Commits

For commits with multiple changes:

```bash
feat(mcp): add calendar agent

- Implement Google Calendar integration
- Add recurring event support
- Include timezone handling

Closes #123
```

## Scopes by Project

**MCP:**
```bash
feat(agents): add new agent
feat(weather): add forecast tool
fix(workflows): correct state handling
```

**Home Assistant Addon:**
```bash
feat(addon): add configuration option
fix(config): correct port mapping
```

**ElevenLabs:**
```bash
feat(voice): add new personality trait
test(elevenlabs): add conversation tests
```

## What NOT to Do

❌ Don't use vague subjects like "fix bug" or "update code"
❌ Don't capitalize subject line
❌ Don't end subject with period
❌ Don't mix multiple types in one commit
❌ Don't forget scope when applicable
❌ Don't exceed 72 characters in subject

## Why This Matters

- **Automated changelog generation**: Tools parse commits for releases
- **Clear history**: Easy to understand what changed
- **Semantic versioning**: Types indicate version bumps
- **Searchability**: Easy to find specific changes
