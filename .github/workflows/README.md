# CI Workflows

This directory contains GitHub Actions workflows for the Hey Jarvis project.

## Current Workflows

### `ci.yml` - Continuous Integration

**Triggers**: 
- Pull requests to `main` branch  
- PR labeled with `bump-version`

**Jobs**:

#### 1. `build`
- Builds and tests all projects in dev container
- Runs on every PR
- Uses Docker buildx for multi-arch support

#### 2. `version-bump` 
- Only runs when PR has `bump-version` label
- Executes `npm run bump` (which runs `nx run-many --target=bump --all`)
- **Idempotent**: Running multiple times on same branch won't increment further
- Commits version changes back to PR branch
- Removes `bump-version` label when complete

## Version Bump Process

The `npm run bump` command:

1. **🔍 Checks idempotency** - skips if already bumped on this branch
2. **🔢 Increments patch version** (e.g., 1.0.0 → 1.0.1) 
3. **📝 Generates changelog** using `git-cliff` from conventional commits
4. **✅ Updates files**: `config.json` and `CHANGELOG.md`

### Idempotent Behavior

Version bumping is idempotent by:
- Checking git history for recent version bump commits
- Comparing current version against main branch
- Skipping bump if version already ahead of base

## Usage

### Standard Development Flow
1. **Create PR** with your changes
2. **Add `bump-version` label** if you want to increment version
3. **CI runs automatically** - builds and optionally bumps version
4. **Merge PR** when ready

### Version Bumping
```bash
# Local testing (won't bump if already bumped)
npm run bump

# Or run specific project
npx nx bump home-assistant-addon
```

## Changelog Generation

Uses [git-cliff](https://git-cliff.org/) for professional changelogs:

- **⚡ Features**: `feat:` commits
- **🐛 Bug Fixes**: `fix:` commits  
- **📚 Documentation**: `docs:` commits
- **🚜 Refactor**: `refactor:` commits
- **⚙️ Miscellaneous**: `chore:`, `ci:` commits

## Labels

Required GitHub labels:
- `bump-version` - Triggers version bump in CI

## Requirements

- Node.js 20
- `GITHUB_TOKEN` with `contents: write` and `pull-requests: write` permissions  
- Conventional commit messages for best changelog results