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

## Pull Request Bodies Become Commit Bodies

Merges are squashes, so the pull request description becomes the body of the
commit on `main`. Release Please parses that whole message, and one line it
cannot parse drops the commit from the release entirely — no release pull
request, no `deploy`, no changelog entry, and no error anywhere that fails a
check.

It breaks on a line that **begins** with an identifier and an open parenthesis
containing another parenthesis before it closes, because that is the shape of a
conventional-commit header. Code samples hit it constantly.

Keep such a line off column zero — one space of indentation, a list bullet, or
any prose in front of it is enough:

| | Example |
| --- | --- |
| ❌ Breaks | a line starting `fs.rmSync(path.join(dir, "ios"));` |
| ❌ Breaks | the same line wrapped in backticks, still starting the line |
| ✅ Fine | the same line indented by one space |
| ✅ Fine | `- fs.rmSync(path.join(dir, "ios"));` as a list item |
| ✅ Fine | `It calls fs.rmSync(path.join(dir, "ios")) first.` |

`commitlint` cannot catch this: it runs in the `commit-msg` hook, and GitHub
builds the squash commit server-side where no hook runs. See the Releases
section of the root `AGENTS.md` for the failure this caused.

## What NOT to Do

❌ Don't put a line starting `identifier((` in a pull request body — it breaks the release
❌ Don't use vague subjects like "fix bug" or "update code"
❌ Don't capitalize the subject line
❌ Don't end the subject with a period
❌ Don't mix multiple types in one commit
❌ Don't forget the scope when one applies
❌ Don't exceed 72 characters in the subject
❌ Don't bypass the hook with `git commit --no-verify`
