# Hey Jarvis - AI Coding Agent Guidelines

## Overview
This is the root-level guidelines document for the Hey Jarvis monorepo. All projects in this repository should follow these shared conventions.

## 🔍 Research Before Implementation

**CRITICAL: ALWAYS perform web searches before starting any task:**

### Mandatory Research Protocol
- **Minimum 1 web search** is REQUIRED before beginning any implementation
- **Perform as many searches as possible** to gather comprehensive information
- Use the `search_with_grounding` tool extensively for:
  - Current best practices and patterns
  - Latest library versions and APIs
  - Security considerations and common pitfalls
  - Existing solutions and examples
  - Documentation and tutorials

### When to Search
- ✅ Before implementing any new feature
- ✅ Before choosing a library or dependency
- ✅ Before making architectural decisions
- ✅ When encountering errors or issues
- ✅ When uncertain about best practices
- ✅ Before writing complex algorithms
- ✅ When working with unfamiliar APIs or frameworks

### Example Research Flow
```typescript
// STEP 1: Research (REQUIRED)
const bestPractices = await search_with_grounding({
  query: "TypeScript async error handling best practices 2024"
});

const libraryComparison = await search_with_grounding({
  query: "best SQLite libraries for Node.js TypeScript 2024"
});

const securityConsiderations = await search_with_grounding({
  query: "SQL injection prevention TypeScript parameterized queries"
});

// STEP 2: Implement based on research
// ... your implementation here
```

**Remember**: More research = Better implementation. Never skip this step!

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
| **home-assistant-addon** | Home Assistant addon for MCP server hosting |
| **home-assistant-voice-firmware** | ESPHome firmware for voice hardware |

## Development Commands

### NX Commands (MANDATORY)
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `bunx nx serve <project>` instead of running dev directly
- ✅ Use `bunx nx build <project>` instead of running build directly
- ✅ Use `bunx nx test <project>` instead of running test directly
- ✅ Use `bunx nx lint <project>` instead of running lint directly
- ✅ Use `bun install` for package installations at workspace level
- ❌ **NEVER use npm commands** in this Bun-powered monorepo
- ❌ **NEVER run commands directly** - always use NX for project commands

### Command Execution with Timeouts
**CRITICAL: ALWAYS use timeout for all commands** to prevent hanging processes:
- Quick operations (linting, formatting): 30-60 seconds
- Builds and compilation: 120-300 seconds
- Tests: 120-300 seconds
- Long-running operations (Docker builds): 600-900 seconds

```bash
# Examples
timeout 30 bunx nx lint mcp
timeout 180 bunx nx build mcp
timeout 180 bunx nx test mcp
```

### Mandatory Linting and Testing
**CRITICAL: ALWAYS run lint and tests after making any code changes:**

1. **Lint**: `bunx nx lint <project>`
2. **Test**: `bunx nx test <project>`
3. **Build**: `bunx nx build <project>`

Or for affected projects:
```bash
bunx nx affected --target=lint && bunx nx affected --target=test && bunx nx affected --target=build
```

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

### 🎯 YAGNI (You Aren't Gonna Need It)
- **Factory Methods**: Opinionated with sensible defaults, not extensive customization
- **Configuration**: Only expose necessary parameters
- **Features**: Don't implement speculative features
- **Dependencies**: Don't add libraries until they solve an actual problem

### 🔁 DRY (Don't Repeat Yourself)
- **Centralized Configuration**: Ports and URLs in dedicated config files
- **Single Source of Truth**: Never hardcode the same value in multiple files
- **Helper Functions**: Create reusable functions instead of duplicating logic

### 💬 Clean Code Comments
**Comments should ONLY explain WHY, never WHAT or HOW:**

❌ **NEVER:**
```typescript
// Loop through users
for (const user of users) { ... }
```

✅ **ONLY:**
```typescript
// Using internal port to allow nginx to handle JWT authentication
const port = 8111;
```

### 🔧 Use lodash-es for Utilities
This project uses `lodash-es` for common utility functions:

```typescript
import { find, uniqueId, truncate, chain, groupBy } from 'lodash-es';

const taskId = uniqueId('task-');
const task = find(tasks, task => task.status === 'running');
```

### 🛡️ TypeScript Type Safety
**CRITICAL: Never use `any` type** - it defeats TypeScript's purpose:
- Use proper types for all data structures
- Use `unknown` for truly unknown data, then narrow with type guards
- Use type assertions sparingly and only when verified

### 📛 Variable Naming
**CRITICAL: Never shorten variable names** - clarity is more important than brevity:
- ✅ Use `requirements`, `acceptanceCriteria`, `implementation`, `dependencies`
- ❌ Never use `req`, `ac`, `impl`, `deps`
- Variable names should be self-documenting and immediately understandable
- Longer descriptive names are preferred over short abbreviated ones

### 🔄 Don't Reinvent the Wheel
**ALWAYS prefer well-maintained npm packages** over custom implementations:
- Search npm first before writing custom code
- Check for active maintenance and TypeScript support
- Use official libraries from recognized maintainers

## 🏕️ Boy Scout Rule

**CRITICAL: Always fix issues you encounter, even if unrelated to your current task:**
- ✅ Fix ALL lint errors in any file you encounter
- ✅ Fix ALL failing tests you discover
- ✅ Fix formatting issues in files you touch
- ✅ Remove dead code and unused imports
- ✅ Improve code quality whenever possible

## GitHub Integration

### GitHub MCP Tools Usage
**CRITICAL: Always use GitHub MCP tools** for all repository operations:

```typescript
// ✅ CORRECT
const release = await mcp_github_github_get_release_by_tag({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  tag: 'home-assistant-addon-v0.2.2'
});

// ❌ INCORRECT
exec('curl -H "Authorization: Bearer $GITHUB_TOKEN" ...');
```

**Available Tools:**
- `mcp_github_github_list_releases` - List all releases
- `mcp_github_github_get_release_by_tag` - Get specific release
- `mcp_github_github_get_latest_release` - Get latest release
- `mcp_github_github_list_tags` - List all tags
- `mcp_github_github_list_branches` - List all branches
- `mcp_github_github_create_branch` - Create new branch
- `mcp_github_github_create_or_update_file` - Create/update files
- `mcp_github_github_push_files` - Push multiple files

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

## Commit Message Standards

**CRITICAL: ALWAYS follow Conventional Commits:**

### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
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

### Examples
```bash
feat(mcp): add calendar agent for scheduling
fix(shopping): correct product quantity calculation
docs(agents): update workflow examples
feat(api)!: change authentication method

BREAKING CHANGE: Auth now requires API key
```

### Best Practices
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter of subject
- No period at end of subject
- Reference issues in footer: `Closes #123`

## Project-Specific Guidelines

Each project has its own AGENTS.md with specialized instructions:
- **mcp/AGENTS.md** - Mastra agents, tools, workflows, and vertical organization
- **elevenlabs/AGENTS.md** - Voice integration and testing guidelines
- **home-assistant-addon/AGENTS.md** - Addon configuration and deployment
- **home-assistant-voice-firmware/AGENTS.md** - Firmware development

## Contributing

All contributions should:
- Follow TypeScript best practices
- Use the Hey Jarvis factory patterns
- Apply YAGNI principle
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
bunx nx build home-assistant-addon
```

### Testing Changes
```bash
# Test specific project
bunx nx test mcp

# Test affected projects
bunx nx affected --target=test
```
