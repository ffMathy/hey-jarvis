# Hey Jarvis - AI Coding Agent Guidelines

## Overview
This is the root-level guidelines document for the Hey Jarvis monorepo. All projects in this repository should follow these shared conventions.

## GitHub Copilot Skills

This project includes specialized [GitHub Copilot Agent Skills](https://docs.github.com/copilot/concepts/agents/about-agent-skills) in `.github/skills/`. These skills teach Copilot how to perform tasks following project conventions. See [`.github/skills/README.md`](.github/skills/README.md) for the complete list.

## Technology Stack
- **Runtime**: Bun (not Node.js)
- **Package Manager**: Bun (use `bun install`, never npm)
- **Build System**: NX monorepo
- **Language**: TypeScript (strict mode)
- **AI Framework**: Mastra (V1 beta)
- **LLM Provider**: Google Gemini (gemini-flash-latest)
- **Linting**: Biome
- **Testing**: Jest

## Repository Structure
This is an NX monorepo containing intelligent voice assistant components:

| Project | Description |
|---------|-------------|
| **mcp** | Mastra AI-powered Model Context Protocol server |
| **elevenlabs** | ElevenLabs voice interface integration |
| **home-assistant-voice-firmware** | ESPHome firmware for voice hardware |

## Development Commands

**See the [`nx-monorepo-commands`](.github/skills/nx-monorepo-commands/SKILL.md) skill for detailed NX usage.**

### NX Commands (MANDATORY)
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- `bunx nx serve <project>` - Start development server
- `bunx nx build <project>` - Build for production
- `bunx nx test <project>` - Run tests
- `bunx nx lint <project>` - Run linter
- `bunx nx affected --target=<lint|test|build>` - Run on affected projects

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

**See these skills for detailed guidance:**
- [`clean-code`](.github/skills/clean-code/SKILL.md) - Variable naming and YAGNI principle
- [`typescript`](.claude/rules/typescript.md) - Type safety guidelines (prefer inference over casts)
- [`mastra-development`](.claude/skills/mastra-development/SKILL.md) - Agents, tools, workflows, vertical organization, and type safety
- [`use-npm-packages`](.github/skills/use-npm-packages/SKILL.md) - Prefer existing libraries
- [`boy-scout-rule`](.github/skills/boy-scout-rule/SKILL.md) - Leave code better than you found it
- [`conventional-commits`](.github/skills/conventional-commits/SKILL.md) - Commit message standards

## Web Search and Information Retrieval

### Gemini Grounding MCP Tools
**CRITICAL: Always use the `search_with_grounding` tool** when you need to fetch information online or search the web:

The Gemini grounding MCP server provides access to real-time web search capabilities through Google's Gemini API with grounding. Use this tool to:
- Search for current information online
- Fetch real-time data from the web
- Find documentation, tutorials, or examples
- Get up-to-date information about packages, libraries, or APIs

**Available Tools:**
- `search_with_grounding` - Perform web searches with Gemini grounding

**Example Usage:**
```typescript
// Search for information online
const results = await search_with_grounding({
  query: "latest TypeScript best practices 2024"
});
```

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
  url: "https://example.com"
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

## Work Preferences

- **Always use worktrees**: All implementation work should be done in isolated git worktrees (`isolation: "worktree"`) to prevent changes from affecting the main working directory. The worktree should be named something that semantically makes sense compared to the work being done.
- **Always run in background**: Tasks should be run in the background (`run_in_background: true`) so the user can continue working while agents complete their work.

## Project-Specific Guidelines

Each project has its own AGENTS.md with specialized instructions:
- **mcp/AGENTS.md** - Mastra agents, tools, workflows, and vertical organization
- **elevenlabs/AGENTS.md** - Voice integration and testing guidelines
- **home-assistant-voice-firmware/AGENTS.md** - Firmware development

## Contributing

**See these skills for detailed development guidelines:**
- [`mastra-development`](.claude/skills/mastra-development/SKILL.md) - Agents, tools, workflows, vertical organization, and type safety

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
bunx nx serve mcp
# Access playground at http://localhost:4111/agents
```

### Building for Production
```bash
bunx nx build mcp
```

### Testing Changes
```bash
# Test specific project
bunx nx test mcp

# Test affected projects
bunx nx affected --target=test
```
