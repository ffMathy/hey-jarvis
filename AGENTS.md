# Hey Jarvis - AI Coding Agent Guidelines

## Overview

This is the root-level guidelines document for the Hey Jarvis monorepo. All projects in this repository should follow these shared conventions.

## Agent Rules and Skills

Project conventions live in two places under `.claude/`:

- **[`.claude/rules/`](.claude/rules/)** — always-applied guidelines. Rules with a `paths` frontmatter glob load only when matching files are in play; rules without one apply to every session.
- **[`.claude/skills/`](.claude/skills/)** — optional, situational workflows that are loaded on demand.

Prefer a rule over a skill. Use the [`remember`](.claude/skills/remember/SKILL.md) skill to capture a new convention into the right place.

## Technology Stack

- **Runtime**: Bun (not Node.js)
- **Package Manager**: Bun only — `npm`/`npx`/`yarn`/`pnpm` are rejected by CI (see [Supply Chain Security](#supply-chain-security))
- **Build System**: Turborepo monorepo
- **Language**: TypeScript (strict mode)
- **AI Framework**: Mastra (V1)
- **LLM Provider**: Google Gemini (gemini-flash-latest)
- **Linting**: Biome
- **Testing**: `bun test`

## Repository Structure

This is an Turborepo monorepo containing intelligent voice assistant components:

| Project                           | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| **mcp**                           | Mastra AI-powered Model Context Protocol server |
| **elevenlabs**                    | ElevenLabs voice interface integration          |
| **home-assistant-voice-firmware** | ESPHome firmware for voice hardware             |

## Development Commands

**See the [`turbo-commands`](.claude/rules/turbo-commands.md) rule for detailed Turborepo usage.**

### TURBO Commands (MANDATORY)

**CRITICAL: ALWAYS use Turborepo commands** for this monorepo:

- `bunx turbo serve --filter=<project>` - Start development server
- `bunx turbo build --filter=<project>` - Build for production
- `bunx turbo test --filter=<project>` - Run tests
- `bunx turbo lint --filter=<project>` - Run linter
- `bunx turbo <target>` - Run a target across packages (optionally narrowed with `--filter`)

## Supply Chain Security

Dependencies are the most likely way an attacker gets code into this repository,
so installation is locked down. The rules below are enforced by
`.scripts/check-supply-chain.sh`, which runs on every pull request.

### Bun is the only package manager

`npm`, `npx`, `yarn` and `pnpm` are not allowed anywhere — not in scripts, not in
workflows, not in Dockerfiles. A second package manager resolves dependencies
outside `bun.lock`'s pins and ignores `bunfig.toml`. Use `bun` and `bunx`; a
committed `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml` fails CI and the
pre-commit hook.

### Install policy (`bunfig.toml`)

| Setting                        | Effect                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `exact = true`                 | Versions are pinned exactly — never `^` or `~`                       |
| `ignoreScripts = true`         | Dependency lifecycle scripts (`postinstall` & friends) never execute |
| `minimumReleaseAge = 604800`   | Only versions public for ≥ 7 days can be resolved                    |
| `saveTextLockfile = true`      | Dependency changes stay reviewable in diffs                          |
| `registry = …registry.npmjs.org` | Installs cannot be silently redirected to another host             |

Dependabot mirrors the same 7-day cooldown, so new versions sit out the window
that malicious releases are typically caught and yanked in. Each ecosystem uses
a single catch-all group, so bumps arrive as one rolling pull request per
ecosystem instead of one per dependency. A grouped pull request auto-merges only
when the largest bump in it is a patch or minor, so a single major parks the
whole batch for a human.

### Adding or updating a dependency

```bash
bun add <package>            # writes an exact version
bun install --frozen-lockfile # what CI and containers run
bun run check:supply-chain   # the policy check CI runs
bun run audit                # known advisories, high severity and above
```

A brand-new release (< 7 days old) is refused by design. Wait it out, or — if a
security fix makes waiting worse than installing — add the package to
`minimumReleaseAgeExcludes` in `bunfig.toml` in the same pull request, so the
exception is reviewed.

The cooldown also applies when re-resolving, so a plain `bun update` fails while
any pinned version is younger than 7 days ("failed to resolve"). For a one-off,
relax it on the command line — `bun update --minimum-release-age=86400` — and
check the resulting `bun.lock` diff before committing it.

### Overriding a vulnerable transitive dependency

When a package deep in the tree has an advisory but its parent still requests a
vulnerable range, pin it forward in the `overrides` block of `package.json`.
Two things to know before adding one:

- **Bun only honors flat overrides.** The npm nested form
  (`{"parent": {"child": "1.2.3"}}`) is parsed and then silently ignored, so a
  nested entry looks like a fix while doing nothing. Always re-run
  `bun run audit` to confirm an override actually took effect.
- **An override applies to every copy in the tree.** If two majors of a package
  are installed, all consumers get the one version you name. Check the consumers
  with `bun why <package>` first — forcing a major on a consumer that expects the
  old API breaks it at runtime, not at install time.

Advisories that cannot be fixed this way are listed below with the consumer that
blocks them, so nobody has to re-derive it:

| Package           | Blocked by                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `brace-expansion` | Only safe version is ESM-only; `minimatch@3` (via `serve-handler`) is CJS |
| `js-yaml`         | `gray-matter` calls `safeLoad`/`safeDump`, removed in v4            |
| `minimatch`       | `serve-handler` calls the CJS export as a function; v9+ exports an object |
| `path-to-regexp`  | Same — `serve-handler` calls `pathToRegExp(...)` directly           |
| `@ai-sdk/provider-utils` | The vulnerable copy is a v3 dependency; the fix is a v4 API break |

Three of those trace to `serve-handler` ← `serve` ← the `mastra` CLI, so a single
upstream bump there would clear them.

### Install scripts are never trusted

Because `ignoreScripts = true` applies to this workspace too, `prepare` does not
run on install. Git hooks are installed explicitly instead:

```bash
bun run prepare   # git config core.hooksPath .husky
```

Native binaries come from optional platform packages or from an explicit,
reviewable `initialize` target — never from a `postinstall`. Do not reintroduce
`trustedDependencies`.

### GitHub Actions

Every `uses:` is pinned to a full commit SHA with the version in a trailing
comment (`uses: actions/checkout@d23441a… # v6.1.0`); tags are mutable and a
retagged action runs with the workflow's token. Workflows default to
`permissions: {}` and opt into the minimum they need, and checkouts use
`persist-credentials: false` so project code never inherits a usable token.

Every job must run on a GitHub-hosted runner (`ubuntu-*`, `windows-*`,
`macos-*`). Self-hosted runners execute workflow code on a machine we control,
where a malicious pull request could read other jobs' secrets, poison the tool
cache, or persist between runs. Registering one already requires repository
admin; the CI check makes the other half explicit by rejecting any workflow that
targets a runner we do not rent from GitHub.

## 1Password Authentication

This project uses **1Password CLI** for secure environment variable management.

### Setup

1. **Sign in**: `eval $(op signin)` - **CRITICAL: Always run this when you get a 1Password authentication error**
2. **Verify**: `op whoami`

**Important**:

- If any command fails with "no active session found", immediately run `eval $(op signin)` to re-authenticate
- After running `eval $(op signin)`, always assume it succeeded regardless of output

### Terminal Session Management

**CRITICAL: Always reuse existing terminal sessions** when running commands:

- Check `get_terminal_output` to see available terminals
- Reuse the same terminal ID for related commands
- This maintains context and environment variables

## Core Development Principles

**See these rules for detailed guidance:**

- [`clean-code`](.claude/rules/clean-code.md) - Variable naming, YAGNI, DRY, and ETC
- [`typescript`](.claude/rules/typescript.md) - Type safety guidelines (prefer inference over casts)
- [`mastra`](.claude/rules/mastra.md) - Factories, vertical organization, and type safety, plus [`mastra-agents`](.claude/rules/mastra-agents.md), [`mastra-tools`](.claude/rules/mastra-tools.md), and [`mastra-workflows`](.claude/rules/mastra-workflows.md)
- [`use-npm-packages`](.claude/rules/use-npm-packages.md) - Prefer existing libraries
- [`boy-scout-rule`](.claude/rules/boy-scout-rule.md) - Leave code better than you found it
- [`conventional-commits`](.claude/rules/conventional-commits.md) - Commit message standards
- [`github-mcp-tools`](.claude/rules/github-mcp-tools.md) - Use the GitHub MCP tools, never `curl` or `gh`
- [`security`](.claude/rules/security.md) - Never read or print environment variable values
- [`validation`](.claude/rules/validation.md) - When and how to run tests, linting, and builds

## Parallel Task Execution

**When a plan identifies independent steps, always run them as parallel background tasks** to maximize throughput and minimize wall-clock time.

After the exploration phase:

1. **Review the plan's parallelization markers** — the plan must indicate which steps can run independently
2. **Spawn background agents** (`run_in_background: true`) for each independent step, using worktree isolation (`isolation: "worktree"`) when they touch different files
3. **Run dependent steps sequentially** — only block on steps that have explicit dependencies on prior results
4. **Merge results** once all background tasks complete

The main agent should act as an orchestrator: dispatch parallel work, monitor completion, and only perform sequential steps itself.

## Web Search and Information Retrieval

**Always use general web search** when you need to find information online — current best practices, library versions, documentation, examples, or real-time data.

### Playwright MCP Tools

**Use Playwright tools** when you need to fetch content from a specific URL or interact with web pages:

The Playwright MCP server provides browser automation capabilities for:

- Fetching the content of a single URL
- Extracting data from web pages
- Taking screenshots of web pages
- Interacting with dynamic web content

**Available Tools:**

- All Playwright MCP tools including navigation, content extraction, and browser automation

**Example Usage:**

```typescript
// Navigate to a URL and get its content
const content = await playwright_browser_navigate({
  url: 'https://example.com',
});
```

## File Creation Policy

### ❌ PROHIBITED FILES:

- **ANY new .md files** (except project-specific AGENTS.md)
- **ANY documentation artifacts** (README, GUIDE, DOCS, etc.)
- **Example or demo scripts** unless explicitly requested
- **Test files** outside standard test directory structure

### ✅ ALLOWED:

- Core functionality files (agents, tools, workflows)
- Package configuration when required for new dependencies
- Test scripts in appropriate test directories

### 📝 DOCUMENTATION:

- **UPDATE existing AGENTS.md files** instead of creating new documentation
- Add inline comments for complex logic
- Use the Mastra playground for testing and examples

## Pull Request Standards

**Pull request titles MUST follow Conventional Commits format** (same as commit messages).

Format: `<type>(<scope>): <subject>`

## Project-Specific Guidelines

Each project has its own AGENTS.md with specialized instructions:

- **mcp/AGENTS.md** - Mastra agents, tools, workflows, and vertical organization
- **elevenlabs/AGENTS.md** - Voice integration and testing guidelines
- **home-assistant-voice-firmware/AGENTS.md** - Firmware development

## Contributing

**See these rules for detailed development guidelines:**

- [`mastra`](.claude/rules/mastra.md) - Factories, vertical organization, and type safety
- [`mastra-agents`](.claude/rules/mastra-agents.md), [`mastra-tools`](.claude/rules/mastra-tools.md), [`mastra-workflows`](.claude/rules/mastra-workflows.md) - Per-file-type conventions

All contributions should:

- Follow TypeScript best practices
- Use the Hey Jarvis factory patterns
- Include proper testing
- Update relevant AGENTS.md files

## Common Tasks

### Adding a New Mastra Agent

1. Create a new vertical in `mcp/mastra/verticals/<name>/`
2. Add `agent.ts`, `tools.ts`, `workflows.ts`, and `index.ts`
3. Export from `mcp/mastra/verticals/index.ts`
4. Register in `mcp/mastra/index.ts`
5. Document in `mcp/AGENTS.md`

### Adding a New Tool

1. Create tool in appropriate vertical's `tools.ts`
2. Use `createTool()` factory function
3. Use kebab-case for tool IDs
4. Export in the vertical's `index.ts`

### Running the Development Server

```bash
bunx turbo serve --filter=mcp
# Access playground at http://localhost:4111/agents
```

### Building for Production

```bash
bunx turbo build --filter=mcp
```

### Testing Changes

```bash
# Test specific project
bunx turbo test --filter=mcp

# Test affected projects
bunx turbo test
```

<!-- turbo configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Turbo

- For navigating/exploring the workspace, use Turborepo-aware project/task tooling first.
- When running tasks (for example build, lint, test, e2e, etc.), prefer Turborepo task execution (`turbo <task>` and `--filter`) instead of calling underlying tools directly.
- Prefix Turbo commands with the workspace package manager (`bunx turbo ...`) instead of relying on global binaries.
- You have access to Turborepo MCP tooling; use it to inspect projects and tasks.
- NEVER guess CLI flags; check `turbo --help` first when unsure.

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), use repository-approved generators and workspace conventions first.

## When to use docs lookups

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic Turborepo command syntax and common day-to-day commands

<!-- turbo configuration end-->
