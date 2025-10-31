# GitHub Copilot Instructions for Hey Jarvis

## Repository Overview

Hey Jarvis is an NX monorepo containing a digital assistant system with three main projects:

- **mcp**: TypeScript MCP (Model Context Protocol) server with Mastra AI agents
- **home-assistant-voice-firmware**: C++ voice processing foundation for Home Assistant integration  
- **e2e**: TypeScript end-to-end testing capabilities foundation

## Development Guidelines

### Build System - NX Workspace Commands

**CRITICAL: ALWAYS use NX commands** for this monorepo:

✅ **CORRECT**:
- `npx nx build [project-name]`
- `npx nx serve [project-name]` 
- `npx nx test [project-name]`
- `npx nx lint [project-name]`
- `npx nx run-many --target=build --all`

❌ **NEVER use**:
- `npm run dev` or `npm run build` in subdirectories
- `npm install` directly in subdirectories
- Individual package.json scripts bypassing NX

### Project-Specific Guidelines

#### mcp (Mastra AI Agents)

**File Creation Policy - ABSOLUTELY CRITICAL**:

❌ **PROHIBITED FILES**:
- **ANY new .md files** (README, GUIDE, DOCS, etc.)
- **ANY documentation artifacts** (ANALYSIS.md, COMPARISON.md, ARCHITECTURE.md)
- **ANY explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md)
- **ANY example or demo scripts** unless explicitly requested
- **ANY test files or testing artifacts** outside standard test directory structure
- **ANY configuration files** not directly required for functionality

✅ **ALLOWED FILE CREATION**:
- **Core functionality files**: agents, tools, workflows in respective directories
- **Package configuration**: Only when required for new dependencies

**Architecture Patterns**:

**REQUIRED Factory Usage**:
```typescript
// Agents
import { createAgent } from '../../utils/agent-factory';
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  // memory and model (gemini-flash-latest) are automatically provided
});

// Tools  
import { createTool } from '../../utils/tool-factory';
export const myTool = createTool({
  id: 'my-tool-action', // kebab-case required
  description: 'Performs a specific action',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ context }) => ({ result: context.input }),
});

// Workflows
import { createWorkflow, createStep } from '../../utils/workflow-factory';
```

**Vertical Organization**:
- Directory structure: `mastra/verticals/[vertical-name]/`
- Files: `agent.ts` or `agents.ts`, `tools.ts`, `workflows.ts`, `index.ts`
- Tool IDs: Always `kebab-case` (e.g., `get-current-weather`)
- Agent naming: `[vertical]Agent` or `[vertical][Purpose]Agent`

**❌ NEVER do direct imports**:
```typescript
// ❌ Bypasses Hey Jarvis defaults and standards
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
```

#### home-assistant-voice-firmware (C++ Application)

- Uses C++17 with g++ compilation
- Source code in `src/` directory
- Foundation for embedded systems and IoT device integration
- Cross-platform compilation support
- Future: Voice processing, Home Assistant integration, real-time audio

#### e2e (End-to-End Testing)

- TypeScript foundation for testing automation
- Simple class structure demonstrations
- Future: Cross-project communication validation, automated workflows

### Code Style & Standards

**General Principles**:
- Follow TypeScript best practices for TS projects
- Use existing libraries whenever possible
- Minimal, surgical changes only
- Comprehensive tool validation for Mastra agents
- Proper agent memory management

**Mastra-Specific**:
- Default sampling rate: 10% of responses scored for evaluation
- Evaluation model: `gemini-flash-latest` for cost-effectiveness  
- Asynchronous execution for scoring (non-blocking)
- Results stored in `mastra_scorers` table

### DevContainer Support

Repository includes DevContainer configuration with:
- TypeScript/Node.js support
- C++ development tools (g++)
- NX workspace tools pre-configured
- VS Code extensions

### GitHub MCP Tools

**GitHub repository management tools are available** for:
- Listing releases and tags
- Getting release information by tag
- Checking package/container registry status
- Managing branches and commits
- Creating and updating files
- Push files and manage repositories

**Always use GitHub MCP tools instead of curl/API calls** when interacting with GitHub:
- ✅ Use `mcp_github_github_list_releases` to check releases
- ✅ Use `mcp_github_github_get_release_by_tag` for specific versions
- ✅ Use `mcp_github_github_list_tags` to check available tags
- ❌ Don't use `curl`, `gh api`, or manual API calls

For Docker images on GHCR, use release tools to verify versions exist before updating config files.

### Agent Instructions Context

Each project has detailed `AGENTS.md` files with specific instructions:
- `mcp/AGENTS.md`: Comprehensive Mastra development guidelines
- `home-assistant-voice-firmware/AGENTS.md`: C++ firmware development guidelines  
- `e2e/AGENTS.md`: Testing automation guidelines

**Always consult the relevant AGENTS.md file** before making changes to ensure compliance with project-specific requirements.

### Setup & Contributing Workflow

**Initial Setup**:
```bash
npm install  # Install dependencies (may take several minutes)
```

**Development Workflow**:
1. Use NX commands exclusively (`./nx` or `npx nx`)
2. Follow factory patterns for mcp components
3. Respect file creation policies (especially mcp restrictions)
4. Test changes with appropriate NX targets
5. Maintain monorepo consistency across all projects

**Common Commands**:
```bash
# Show all projects and their dependencies
npx nx graph

# Build all projects
npx nx run-many --target=build --all

# Build specific project
npx nx build [project-name]

# Serve/run specific project
npx nx serve [project-name]
```

### Future Development Focus

- Model Context Protocol integration (mcp)
- Voice processing and recognition (home-assistant-voice-firmware)
- Home automation control coordination
- Cross-project AI agent communication
- Comprehensive end-to-end testing automation