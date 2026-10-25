# Hey Jarvis Repository

The shared conventions every project in this monorepo follows.

## Rules, not AGENTS.md

**CRITICAL: NEVER create an `AGENTS.md` or `CLAUDE.md` file, anywhere in the repository.** Everything an agent needs to know lives in [`.claude/`](..):

- **[`.claude/rules/`](.)** — always-applied guidelines. A rule with a `paths` frontmatter glob loads only when matching files are in play; a rule without one applies to every session.
- **[`.claude/skills/`](../skills/)** — optional, situational workflows that are loaded on demand.

**ALWAYS write what would have gone into an `AGENTS.md` as a rule whose `paths` frontmatter scopes it to that directory**, the way an `AGENTS.md` applied to its own folder. A project's notes are `.claude/rules/<project>.md` (`mcp.md`, `hologram.md`, `mobile.md`, …), scoped to `<project>/**`. What the root `AGENTS.md` held applies everywhere, so those rules (this one, `supply-chain-security`, `releases`, `1password`) have no `paths`.

Prefer a rule over a skill. Use the [`remember`](../skills/remember/SKILL.md) skill to capture a new convention into the right place.

## Technology Stack

- **Runtime**: Bun (not Node.js)
- **Package Manager**: Bun only — `npm`/`npx`/`yarn`/`pnpm` are rejected (see [Supply Chain Security](supply-chain-security.md))
- **Build System**: Turborepo monorepo
- **Language**: TypeScript (strict mode)
- **AI Framework**: Mastra (V1)
- **LLM Provider**: Google Gemini (gemini-flash-latest)
- **Linting**: Biome
- **Testing**: `bun test`

## Repository Structure

This is a Turborepo monorepo containing intelligent voice assistant components. Each project's notes are a rule scoped to that project's directory; paths inside each are relative to it unless they say otherwise. When a change in one project depends on another (the apps on `hologram`, the apps on `mcp`'s server), read that project's rule too.

| Project                           | Description                                       | Rule |
| --------------------------------- | ------------------------------------------------- | ---- |
| **mcp**                           | Mastra AI-powered Model Context Protocol server: agents, tools, workflows, and vertical organization | [`mcp.md`](mcp.md) |
| **elevenlabs**                    | ElevenLabs voice interface integration, and its testing guidelines | [`elevenlabs.md`](elevenlabs.md) |
| **hologram**                      | Jarvis's sphere, voice tracker and conversation, shared by every app that is him: why nothing in it imports a value, and how it is tested | [`hologram.md`](hologram.md) |
| **mobile**                        | Expo app that is the phone's default assistant, and what makes Android accept it as one | [`mobile.md`](mobile.md) |
| **watch**                         | Expo app that is the watch's assistant, and how to try it as a Pixel Watch's assistant | [`watch.md`](watch.md) |
| **vr**                            | WebXR app that puts Jarvis in your room on a Meta Quest: the wake word, where he stands, the conversation and the 3D hologram, the emulated headset its tests run in, and the wake-word models' licence | [`vr.md`](vr.md) |
| **home-assistant-voice-firmware** | ESPHome firmware for voice hardware               | [`home-assistant-voice-firmware.md`](home-assistant-voice-firmware.md) |

## Core Development Principles

**See these rules for detailed guidance:**

- [`clean-code`](clean-code.md) - Variable naming, YAGNI, DRY, KISS, and ETC
- [`solid`](solid.md) - The five SOLID principles of object-oriented design
- [`no-hacks`](no-hacks.md) - Fix root causes; never paper over a problem
- [`code-smells`](code-smells.md) - The code smell catalog, and the refactorings that cure each smell
- [`refactoring`](refactoring.md) - How and when to refactor, and the refactoring technique catalog
- [`design-patterns`](design-patterns.md) - The creational, structural and behavioral design patterns, and when not to use them
- [`typescript`](typescript.md) - Type safety guidelines (prefer inference over casts)
- [`mastra`](mastra.md) - Factories, vertical organization, and type safety, plus [`mastra-agents`](mastra-agents.md), [`mastra-tools`](mastra-tools.md), and [`mastra-workflows`](mastra-workflows.md)
- [`use-npm-packages`](use-npm-packages.md) - Prefer existing libraries
- [`boy-scout-rule`](boy-scout-rule.md) - Leave code better than you found it
- [`conventional-commits`](conventional-commits.md) - Commit message and pull request title standards
- [`github-mcp-tools`](github-mcp-tools.md) - Use the GitHub MCP tools, never `curl` or `gh`
- [`security`](security.md) - Never read or print environment variable values
- [`supply-chain-security`](supply-chain-security.md) - Bun only, pinned versions, no install scripts, pinned Actions
- [`releases`](releases.md) - Every push to `main` is a release
- [`1password`](1password.md) - Signing in to the vault that holds every secret
- [`turbo-commands`](turbo-commands.md) - Always run tasks through Turborepo
- [`validation`](validation.md) - When and how to run tests, linting, and builds

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

- **ANY new .md files** outside `.claude/rules/` and `.claude/skills/` — and **never** an `AGENTS.md` or `CLAUDE.md`
- **ANY documentation artifacts** (README, GUIDE, DOCS, etc.)
- **Example or demo scripts** unless explicitly requested
- **Test files** outside standard test directory structure

### ✅ ALLOWED:

- Core functionality files (agents, tools, workflows)
- Package configuration when required for new dependencies
- Test scripts in appropriate test directories

### 📝 DOCUMENTATION:

- **UPDATE the existing rules** in `.claude/rules/` (a project's notes are `.claude/rules/<project>.md`) instead of creating new documentation
- Add inline comments for complex logic
- Use the Mastra playground for testing and examples

## Pull Request Standards

**Pull request titles MUST follow Conventional Commits format** (same as commit messages).

Format: `<type>(<scope>): <subject>`

## Contributing

**See these rules for detailed development guidelines:**

- [`mastra`](mastra.md) - Factories, vertical organization, and type safety
- [`mastra-agents`](mastra-agents.md), [`mastra-tools`](mastra-tools.md), [`mastra-workflows`](mastra-workflows.md) - Per-file-type conventions

All contributions should:

- Follow TypeScript best practices
- Use the Hey Jarvis factory patterns
- Include proper testing
- Update the relevant project rule in `.claude/rules/`

## Common Tasks

### Adding a New Mastra Agent

1. Create a new vertical in `mcp/mastra/verticals/<name>/`
2. Add `agent.ts`, `tools.ts`, `workflows.ts`, and `index.ts`
3. Export from `mcp/mastra/verticals/index.ts`
4. Register in `mcp/mastra/index.ts`
5. Document in [`mcp.md`](mcp.md)

### Adding a New Tool

1. Create tool in appropriate vertical's `tools.ts`
2. Use `createTool()` factory function
3. Use camelCase for tool IDs, identical to the variable name and the export key
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

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), use repository-approved generators and workspace conventions first.
