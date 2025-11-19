# GitHub Copilot Instructions for Hey Jarvis

## Repository Overview

Hey Jarvis is an NX monorepo containing a digital assistant system with three main projects:

- **mcp**: TypeScript MCP (Model Context Protocol) server with Mastra AI agents
- **home-assistant-voice-firmware**: C++ voice processing foundation for Home Assistant integration  
- **e2e**: TypeScript end-to-end testing capabilities foundation

## Development Guidelines

### Core Development Principles

#### 🎯 **YAGNI (You Aren't Gonna Need It)**
Avoid adding functionality or configuration options until they are actually needed:
- **Factory Methods**: Should be opinionated and provide sensible defaults
- **Configuration**: Only expose parameters that are necessary for core functionality
- **Features**: Don't implement speculative features or "what if" scenarios
- **Abstraction**: Keep abstractions minimal and add complexity only when required
- **Dependencies**: Don't add libraries or tools until they solve an actual problem

#### 🔁 **DRY (Don't Repeat Yourself)**
Avoid duplication of configuration and constants:
- **Centralized Configuration**: Define ports, URLs, and constants in centralized configuration files
  - Bash scripts: `mcp/lib/ports.sh`
  - TypeScript: Use helper files like `home-assistant-addon/tests/e2e/helpers/ports.ts`
- **Single Source of Truth**: Never hardcode the same value in multiple files
- **Helper Functions**: Create reusable helper functions instead of duplicating logic
- **Configuration Sharing**: Import configurations rather than duplicating them

#### 💬 **Clean Code Comments - CRITICAL**
**Comments should ONLY explain *WHY*, never *WHAT* or *HOW*:**

❌ **NEVER write comments like these:**
```typescript
// Loop through users
for (const user of users) { ... }

// Set port to 4111
const port = 4111;

// Create HTTP server
const server = createServer();

// Call the API
const response = await fetch(url);
```

✅ **ONLY write comments like these:**
```typescript
// Using internal port to allow nginx to handle JWT authentication at reverse proxy layer
const port = 8111;

// Workaround for nginx auth module not supporting dynamic key files - must be created before nginx starts
createJWTKeyFile();

// Port 4112 exposed externally for MCP clients, while internal service uses 8112 to avoid conflicts
const mcpExternalPort = 4112;
```

**When comments ARE allowed:**
- Explaining non-obvious business logic or architectural decisions
- Documenting workarounds for bugs in external libraries
- Clarifying why a hack or unusual pattern exists
- Noting important security considerations or constraints
- Explaining why we chose a specific approach over alternatives

**When comments are NOT allowed:**
- Describing what the code does (the code itself shows this)
- Explaining how something works (use descriptive names instead)
- Repeating information already in the code
- Documenting standard patterns or idioms
- Stating the obvious

**Golden Rule**: If removing the comment makes the code unclear, improve the code (better names, smaller functions, clearer structure) rather than adding a comment.

### Commit Message Standards - CRITICAL

**ALL commits and PR titles MUST follow Conventional Commits format**:

```
<type>(<scope>): <subject>
```

**Valid types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`

**Examples**:
- ✅ `feat(mcp): add calendar agent for scheduling`
- ✅ `fix(elevenlabs): correct voice synthesis issue`
- ✅ `chore: update dependencies`
- ❌ `Migrate to Mastra V1 beta` (missing type)
- ❌ `Update files` (missing type)

**Why this matters**:
- Release Please uses commit messages to determine version bumps and generate changelogs
- Non-conventional commits cause parsing errors and break automated releases
- PR titles become merge commit messages, so they must follow this format

**Enforcement**:
- **Local**: Husky + commitlint validates commit messages before they're created
- **CI**: GitHub Actions validates PR titles automatically
- **Result**: Invalid commits are prevented, and PRs with non-conventional titles fail checks

**How it works**:
1. When you commit: Husky runs commitlint to validate the message
2. Invalid messages are rejected immediately with helpful error messages
3. Valid messages are accepted and the commit proceeds

See `.husky/README.md` for more details on git hooks configuration.

### Verification Policy - CRITICAL

**ALWAYS verify your changes work before committing**:

✅ **REQUIRED VERIFICATION STEPS**:
1. **Build**: Run `bunx nx build [project-name] --configuration=production` to verify production builds succeed
2. **Test**: Run `bunx nx test [project-name]` to verify tests pass
3. **Lint**: Run `bunx nx lint [project-name]` to verify code quality
4. **Manual Testing**: For user-facing changes, manually test the functionality
5. **Check Build Output**: Verify build artifacts are correct (e.g., no test files in production builds)
6. **NX Target Testing**: Test through NX targets, not just scripts directly - this verifies target dependencies work correctly

**When to Verify**:
- ✅ After fixing bugs or errors
- ✅ After adding new features
- ✅ After refactoring code
- ✅ Before pushing commits
- ✅ After addressing code review feedback
- ✅ After modifying NX target configurations

**Example Verification Workflow**:
```bash
# After making changes to elevenlabs project
bunx nx build elevenlabs --configuration=production
bunx nx test elevenlabs
bunx nx lint elevenlabs

# Verify no test files in build output
find dist/elevenlabs -name "*.spec.js" -o -name "*.test.js"
# Should return nothing

# After modifying build targets or dependencies
bunx nx build [project-name] --skip-nx-cache
# Verify target dependencies (e.g., initialize) run correctly
```

### Build System - NX Workspace Commands

**CRITICAL: ALWAYS use NX commands with bunx** for this monorepo:

✅ **CORRECT**:
- `bunx nx build [project-name]`
- `bunx nx serve [project-name]` 
- `bunx nx test [project-name]`
- `bunx nx lint [project-name]`
- `bunx nx run-many --target=build --all`

❌ **NEVER use**:
- Running commands directly in subdirectories (always use NX)
- Individual package.json scripts bypassing NX
- npm commands (this is a Bun-powered monorepo)
- npx (use bunx instead for consistency with Bun)

### Project-Specific Guidelines

#### mcp (Mastra AI Agents)

**File Creation Policy - ABSOLUTELY CRITICAL**:

❌ **PROHIBITED FILES**:
- **NEVER create ANY .md files** - Not README.md, not TESTING.md, not GUIDE.md, not anything with .md extension
- **NO markdown files of any kind** (README, GUIDE, DOCS, TESTING, IMPLEMENTATION_SUMMARY, ANALYSIS, COMPARISON, etc.)
- **NO documentation artifacts** of any type
- **NO explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md)
- **NO example or demo scripts** unless explicitly requested
- **NO test files or testing artifacts** outside standard test directory structure
- **NO configuration files** not directly required for functionality

✅ **ALLOWED FILE CREATION**:
- **Core functionality files**: agents, tools, workflows in respective directories
- **Package configuration**: Only when required for new dependencies
- **Test scripts**: Only .js/.ts files in appropriate test directories when needed

📝 **DOCUMENTATION RULE**:
- **UPDATE existing documentation files** (like AGENTS.md, project README.md) instead of creating new ones
- **NEVER create new .md files under any circumstances**
- **Use inline code comments** for complex logic explanations
- **All documentation goes in existing files only**

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

Each project has detailed `AGENTS.md` files with specific instructions. The complete content from all AGENTS.md files is consolidated below for quick reference.

**Always consult the information below** before making changes to ensure compliance with project-specific requirements.

---

## MCP Project (Mastra AI Agents) - Complete Guidelines

### Overview
The MCP project is a Mastra-powered AI agent framework that enables intelligent home automation, voice interactions, and Model Context Protocol (MCP) integrations within the Hey Jarvis ecosystem.

### About Mastra
[Mastra](https://mastra.ai) is a TypeScript agent framework designed to build production-ready AI applications. It provides unified interfaces for multiple LLM providers, persistent agent memory, tool calling capabilities, and graph-based workflows.

### Project Structure
The project follows a vertical-based organization structure for better cohesion:

```
mcp/
├── mastra/
│   ├── verticals/       # Organized by business verticals
│   │   ├── weather/     # Weather vertical
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── shopping/    # Shopping vertical
│   │   │   ├── agents.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   └── cooking/     # Cooking vertical
│   │       ├── agent.ts
│   │       ├── tools.ts
│   │       ├── meal-planning/
│   │       │   ├── agents.ts
│   │       │   ├── workflows.ts
│   │       │   └── index.ts
│   │       └── index.ts
│   ├── memory/          # Shared memory management
│   ├── storage/         # Shared storage configuration
│   └── index.ts         # Main Mastra configuration
```

### Key Features

#### 🤖 Intelligent Agents
- **TypeScript-based agents** with persistent memory and tool calling
- **Multi-provider LLM support** via Vercel AI SDK (OpenAI, Anthropic, Google Gemini)
- **Structured output** generation with Zod validation
- **Real-time streaming** responses with step-by-step visibility

#### 🔧 Tool Ecosystem
- **Model Context Protocol (MCP)** server integrations
- **Home automation tools** for smart device control
- **Voice processing** capabilities for speech-to-text and text-to-speech
- **External API integrations** for weather, calendar, and more

#### 🌊 Workflow Engine
- **Graph-based workflows** with deterministic execution
- **Branching and conditional logic** with `.then()`, `.branch()`, `.parallel()`
- **Suspend/resume functionality** for human-in-the-loop interactions
- **Real-time tracing** and observability

#### 🧠 Memory & Context
- **Persistent agent memory** with semantic recall
- **Thread-based conversations** with context preservation
- **Vector database integration** for knowledge retrieval
- **Working memory** for short-term context management

### Current Agents

#### Weather Agent
Provides intelligent weather information and forecasting capabilities:
- **4 OpenWeatherMap tools**: Current weather and 5-day forecasts by city name or GPS coordinates
- **Google Gemini model**: Uses `gemini-2.0-flash-exp` for natural language processing
- **Smart defaults**: Automatically assumes Mathias, Denmark when no location is specified
- **Never asks questions**: Makes best-guess assumptions for seamless interaction
- **Persistent memory**: Maintains conversation context with LibSQLStore
- **Scheduled monitoring**: Hourly weather checks with automatic memory updates

#### Shopping List Agent
Provides intelligent shopping list management for Bilka online store with Danish language support:
- **4 Bilka integration tools**: Product search via Algolia, cart quantity management, cart retrieval, and cart clearing
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing in Danish
- **Priority-based selection**: Organic certification, Danish origin, healthier options, and price optimization
- **Smart quantity handling**: Balances food waste reduction with requested quantities (20% tolerance)

#### Recipe Search Agent
Provides general cooking and recipe search capabilities:
- **4 Valdemarsro tools**: Recipe search, get by ID, get all recipes, and search filters
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Danish recipe focus**: Specialized for Danish cuisine from Valdemarsro website

### Available Workflows

#### Weather Workflow
Multi-step weather processing workflow with two main components:
- **`weatherWorkflow`**: Handles interactive weather requests from prompts or chat
- **`weatherMonitoringWorkflow`**: Performs scheduled weather checks every hour with memory updates

#### Shopping List Workflow
Multi-step shopping list processing workflow implementing the original n8n 3-agent architecture:
- **Step 1 - Cart Snapshot**: Gets current cart contents as "before" baseline
- **Step 2 - Information Extraction**: Parses user requests into structured product data
- **Step 3 - Product Mutation**: Processes each extracted product with full tool access
- **Step 4 - Updated Cart Snapshot**: Gets final cart contents as "after" comparison
- **Step 5 - Summary Generation**: Compares before/after states and provides user feedback

### Agent-as-Step and Tool-as-Step Patterns

#### 🔄 Modern Workflow Architecture
All workflows use **agent-as-step** and **tool-as-step** patterns for better reusability, simplified logic, and consistent behavior.

#### 🤖 Agent-as-Step Pattern
```typescript
const weatherStep = createAgentStep({
  id: 'weather-check',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
});
```

#### 🔧 Tool-as-Step Pattern
```typescript
const getCurrentWeatherStep = createToolStep({
  id: 'get-current-weather',
  description: 'Get current weather for a city',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});
```

### MCP Development

#### Prerequisites
```bash
# Install Mastra globally
bun install mastra --global
```

#### Running the Project
```bash
# Start development server with playground
bunx nx serve mcp

# Build for production
bunx nx build mcp
```

#### Development Playground
Access the Mastra development playground at `http://localhost:4111/agents` to:
- Test agents interactively
- Monitor agent memory and state
- Debug tool calls and workflows
- View execution traces and performance metrics

#### Environment Setup
This project uses **1Password CLI** for secure environment variable management.

**Required Environment Variables:**
- **Weather**: `HEY_JARVIS_OPENWEATHERMAP_API_KEY`
- **AI Models**: `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY`
- **Shopping (Bilka)**: `HEY_JARVIS_BILKA_EMAIL`, `HEY_JARVIS_BILKA_PASSWORD`, `HEY_JARVIS_BILKA_API_KEY`
- **Shopping (Search)**: `HEY_JARVIS_ALGOLIA_API_KEY`, `HEY_JARVIS_ALGOLIA_APPLICATION_ID`, `HEY_JARVIS_BILKA_USER_TOKEN`
- **ElevenLabs**: `HEY_JARVIS_ELEVENLABS_API_KEY`, `HEY_JARVIS_ELEVENLABS_AGENT_ID`, `HEY_JARVIS_ELEVENLABS_VOICE_ID`
- **Recipes**: `HEY_JARVIS_VALDEMARSRO_API_KEY`

**Important**: Do NOT create separate `*-dev` targets that bypass 1Password CLI. The `op run` approach is designed for both development AND production.

### Vertical Organization Conventions

#### Core Principles
This project uses **vertical organization** where code is grouped by business domain rather than technical layer.

#### Directory Structure Rules

**New Vertical Creation:**
```bash
mastra/verticals/[vertical-name]/
├── agent.ts          # Single general-purpose agent (if simple)
├── agents.ts         # Multiple agents (if moderate complexity)
├── tools.ts          # All tools for this vertical
├── workflows.ts      # All workflows for this vertical
└── index.ts          # Export everything from this vertical
```

**Sub-Vertical Creation (for complex verticals):**
```bash
mastra/verticals/[vertical-name]/
├── agent.ts                    # General vertical agent
├── tools.ts                    # Shared tools for the vertical
├── [sub-vertical-name]/        # Specialized sub-vertical
│   ├── agents.ts              # Specialized agents
│   ├── workflows.ts           # Specialized workflows
│   └── index.ts               # Sub-vertical exports
└── index.ts                   # Main vertical exports
```

#### Naming Conventions

**File Naming:**
- **Single agent**: `agent.ts`
- **Multiple agents**: `agents.ts`
- **Tools**: Always `tools.ts`
- **Workflows**: Always `workflows.ts`
- **Exports**: Always `index.ts`

**Agent Naming:**
- **General agents**: `[vertical]Agent` (e.g., `weatherAgent`)
- **Specialized agents**: `[vertical][Purpose]Agent` (e.g., `mealPlanSelectorAgent`)

**Tool Naming:**
- **Tool IDs**: Always use `kebab-case` (e.g., `get-current-weather`)
- **Tool exports**: Use `[vertical]Tools` (e.g., `weatherTools`)

**Workflow Naming:**
- **Workflow IDs**: Use `kebab-case` (e.g., `weather-monitoring-workflow`)
- **Workflow exports**: Use descriptive names (e.g., `weatherMonitoringWorkflow`)

### MCP Development Guidelines

#### Core Development Principles

**🎯 YAGNI (You Aren't Gonna Need It):**
This project strictly follows the YAGNI principle - avoid adding functionality or configuration options until they are actually needed:
- **Factory Methods**: Should be opinionated and provide sensible defaults
- **Configuration**: Only expose parameters that are necessary for core functionality
- **Features**: Don't implement speculative features or "what if" scenarios
- **Abstraction**: Keep abstractions minimal and add complexity only when required
- **Dependencies**: Don't add libraries or tools until they solve an actual problem

#### File Creation Policy

**❌ ABSOLUTELY PROHIBITED FILES:**
- **NEVER create ANY .md files** - Not README.md, not TESTING.md, not GUIDE.md, not anything
- **NO markdown files of any kind** (README, GUIDE, DOCS, TESTING, IMPLEMENTATION_SUMMARY, etc.)
- **NO documentation artifacts** of any type
- **NO explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md)
- **NO example or demo scripts** unless explicitly requested
- **NO test files or testing artifacts** outside standard test directory structure
- **NO configuration files** not directly required for functionality

**✅ ALLOWED FILE CREATION:**
- **Core functionality files**: agents, tools, workflows in respective directories
- **Package configuration**: Only when required for new dependencies
- **Test scripts**: Only .js/.ts files in appropriate test directories when needed

**📝 DOCUMENTATION UPDATES:**
- **UPDATE AGENTS.md file** instead of creating new documentation
- **NEVER create new .md files under any circumstances**
- **Add inline comments** in code for complex logic explanations
- **Update existing configuration files** when adding new features
- **Use the Mastra playground** for testing and examples instead of creating files

#### Build and Development Commands

**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve mcp` instead of running commands directly
- ✅ Use `nx build mcp` instead of running commands directly
- ✅ Use `nx test mcp` instead of running commands directly
- ✅ Use `nx lint mcp` instead of running commands directly
- ✅ Use `bun install` for package management at workspace level
- ❌ **NEVER use npm commands** in this Bun-powered monorepo
- ❌ **NEVER run commands directly** - always use NX

#### Tool ID Naming Conventions

**CRITICAL**: All tool IDs must follow kebab-case naming conventions:

**✅ CORRECT Examples:**
- `get-current-weather` ✅
- `find-product-in-catalog` ✅
- `set-product-basket-quantity` ✅

**❌ INCORRECT Examples:**
- `get_current_weather` ❌ (snake_case)
- `getCurrentWeather` ❌ (camelCase)
- `GetCurrentWeather` ❌ (PascalCase)

#### Factory Pattern Usage

**CRITICAL**: All agents, tools, and workflows must be created using the Hey Jarvis factory functions:

**Required Factory Functions:**
- **Agents**: Use `createAgent()` from `../../utils/agent-factory`
- **Tools**: Use `createTool()` from `../../utils/tool-factory`
- **Workflows**: Use `createWorkflow()` and `createStep()` from `../../utils/workflow-factory`
- **Agent-as-Step**: Use `createAgentStep()` from `../../utils/workflow-factory`
- **Tool-as-Step**: Use `createToolStep()` from `../../utils/workflow-factory`

**✅ CORRECT Usage Examples:**

**Agent Creation:**
```typescript
import { createAgent } from '../../utils/agent-factory';

export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  // memory and model (gemini-flash-latest) are automatically provided
});
```

**Tool Creation:**
```typescript
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const myTool = createTool({
  id: 'my-tool-action',
  description: 'Performs a specific action',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ context }) => ({ result: context.input }),
});
```

**❌ INCORRECT Direct Usage:**
```typescript
// ❌ NEVER do this - bypasses Hey Jarvis defaults and standards
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';

export const badAgent = new Agent({ ... }); // ❌
export const badTool = createTool({ ... });  // ❌
```

#### Scorers and Evaluation

**AUTOMATIC**: All agents and workflow steps automatically include comprehensive evaluation scorers:

**Included Scorers:**
- **answer-relevancy**: Evaluates how well responses address the input query (0-1, higher is better)
- **faithfulness**: Measures how accurately responses represent provided context (0-1, higher is better)
- **hallucination**: Detects factual contradictions and unsupported claims (0-1, lower is better)
- **completeness**: Checks if responses include all necessary information (0-1, higher is better)
- **prompt-alignment**: Measures how well responses align with prompt intent (0-1, higher is better)
- **bias**: Detects potential biases in outputs (0-1, lower is better)

**Scorer Configuration:**
- **Default sampling rate**: 10% of responses are scored
- **Evaluation model**: Uses `gemini-flash-latest` for cost-effectiveness
- **Asynchronous execution**: Scoring runs in background without blocking responses
- **Automatic storage**: Results stored in `mastra_scorers` table for analysis

---

## Home Assistant Voice Firmware - Complete Guidelines

### Overview
This project provides a C++ voice processing foundation for Home Assistant integration within the Hey Jarvis monorepo.

### Project Description
A simple Hello World C++ application that demonstrates basic firmware structure and serves as a foundation for future voice processing and home automation integration.

### Key Features
- Simple C++ "Hello World" application
- Demonstrates basic class structure and execution flow
- Cross-platform compilation support
- Foundation for embedded systems and IoT device integration

### Agents & Automation
Currently implements:
- **HelloWorldApp**: A basic firmware agent that demonstrates greeting functionality
- Simple console output and execution flow
- C++ standard library utilization

### Future Capabilities
- Voice command processing and recognition
- Home Assistant integration for smart home control
- Real-time audio processing
- Device communication protocols
- Embedded systems deployment

### Hardware Integration
Designed to be compatible with:
- Raspberry Pi and similar SBCs
- ESP32/Arduino microcontrollers
- Voice processing hardware
- Home automation devices

### Usage
```bash
# Build the firmware
bunx nx build home-assistant-voice-firmware

# Run the firmware
bunx nx serve home-assistant-voice-firmware
```

### Development Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve home-assistant-voice-firmware` instead of running commands directly
- ✅ Use `nx build home-assistant-voice-firmware` instead of running commands directly
- ✅ Use `nx test home-assistant-voice-firmware` instead of running commands directly
- ✅ Use `nx lint home-assistant-voice-firmware` instead of running commands directly
- ❌ **NEVER use npm commands** in this Bun-powered monorepo

### Development Guidelines

**🎯 YAGNI (You Aren't Gonna Need It):**
Apply YAGNI principle to firmware and embedded systems development:
- **Hardware Abstraction**: Only abstract hardware interfaces when supporting multiple platforms
- **Protocol Support**: Don't implement communication protocols until they're needed
- **Memory Management**: Keep memory allocation simple until optimization is required
- **Feature Flags**: Avoid configuration options for features that aren't implemented yet
- **Libraries**: Don't include libraries until they solve a specific problem

### Development
The firmware is built using C++17 and follows NX monorepo conventions. All source code is located in the `src/` directory. The build system uses g++ for compilation.

---

## Home Assistant Addon - Complete Guidelines

### Overview
This project provides a Home Assistant addon that seamlessly hosts the Jarvis MCP server within your Home Assistant instance.

### Project Description
A Home Assistant addon that provides intelligent voice assistant capabilities directly integrated with your smart home.

### Key Features
- **Native Home Assistant Integration**: Runs as a standard Home Assistant addon
- **MCP Server Hosting**: Hosts the Jarvis MCP server within Home Assistant
- **Docker Support**: Containerized deployment with proper Home Assistant integration
- **Configuration UI**: Web-based configuration interface for addon settings
- **Multi-architecture Support**: AMD64, ARMv7, and AArch64 compatibility

### Configuration Management

#### config.json Schema
The addon configuration follows Home Assistant's schema with environment variable configuration options defined in the `options` and `schema` fields.

**Supported Configuration Options:**
- `google_api_key` → `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` (**REQUIRED**)
- `openweathermap_api_key` → `HEY_JARVIS_OPENWEATHERMAP_API_KEY` (optional)
- `valdemarsro_api_key` → `HEY_JARVIS_VALDEMARSRO_API_KEY` (optional)
- `bilka_email`, `bilka_password`, `bilka_api_key`, `bilka_user_token` (optional)
- `algolia_api_key`, `algolia_application_id` (optional)

#### Image Field Usage

**Option 1: Build from Dockerfile (Recommended for Development)**
- Remove the `image` field entirely
- Home Assistant will build the image locally using the Dockerfile
- Best for development and testing

**Option 2: Use Pre-built Images (Recommended for Production)**
- Set `image` to GHCR repository: `"image": "ghcr.io/ffmathy/home-assistant-addon"`
- Requires images to be pushed to GHCR via CI/CD
- Requires multi-architecture image support

### Development Commands

**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve home-assistant-addon` instead of running commands directly
- ✅ Use `nx build home-assistant-addon` instead of running commands directly
- ✅ Use `nx deploy home-assistant-addon` instead of running deploy script directly
- ✅ Use `nx docker:build home-assistant-addon` for Docker builds
- ❌ **NEVER use npm commands** in this Bun-powered monorepo

#### Build Dependencies
The addon depends on `mcp` project:
```bash
# The build automatically depends on mcp:docker:build
nx build home-assistant-addon  # Also builds mcp first
```

### Deployment Pipeline

#### GitHub Actions Workflow
The addon is deployed via `.github/workflows/release.yml`:
1. **Release Created**: Release Please creates version tags
2. **Deploy Job Runs**: Only when `home-assistant-addon-v*` tag is created
3. **Build in DevContainer**: Uses devcontainer for consistent environment
4. **Deploy Script**: Runs `scripts/deploy.sh` to push Docker images

#### Deploy Script Workflow
The `scripts/deploy.sh` script:
1. **Authenticate**: Login to GHCR using `GITHUB_TOKEN`
2. **Get Version**: Extract version from `config.json`
3. **Tag Images**: Create image tags matching the version
4. **Push Images**: Push all tags to `ghcr.io/ffmathy/home-assistant-addon`

**Important**: Image tags match the `version` field in `config.json` **without** any 'v' prefix.

### Home Assistant Integration

#### Addon Store Installation
**Manual Repository Addition:**
1. Go to **Supervisor** → **Add-on Store**
2. Click **⋮** → **Repositories**
3. Add: `https://github.com/ffmathy/hey-jarvis`
4. Find "Hey Jarvis MCP Server" in local addons
5. Click **Install**

#### Ingress Configuration
The addon uses Home Assistant ingress for secure web access:
- **Ingress Enabled**: `"ingress": true`
- **Ingress Port**: `4111`
- **Web UI**: Accessible via Home Assistant interface

#### API Access
- `"hassio_api": true` - Access to Supervisor API
- `"homeassistant_api": true` - Access to Home Assistant Core API
- `"hassio_role": "default"` - Default role permissions

#### Permissions
- `"privileged": ["NET_ADMIN"]` - Network administration for MCP server
- `"apparmor": true` - AppArmor security enabled
- `"full_access": false` - Limited access (security best practice)

### Development Guidelines

**🎯 YAGNI (You Aren't Gonna Need It):**
Apply YAGNI principle to addon development:
- **Configuration Options**: Only add options users actually need
- **Build Scripts**: Keep scripts simple
- **Features**: Keep addon focused on core MCP server hosting
- **Complexity**: Avoid over-engineering

**File Creation Policy:**

**❌ ABSOLUTELY PROHIBITED FILES:**
- **NEVER create ANY .md files** - No README.md, no TESTING.md, nothing
- **NO markdown files of any kind**
- **NO documentation artifacts**
- **NO example or demo scripts** unless explicitly requested

**✅ ALLOWED FILE CREATION:**
- **Core addon files**: config.json, Dockerfile, scripts
- **Package configuration**: Only when required

### Version Synchronization
**Important**: The addon version in `config.json` should align with releases:
- Addon version: `0.2.2`
- Release tag: `home-assistant-addon-v0.2.2`
- Docker image: `ghcr.io/ffmathy/home-assistant-addon:v0.2.2`

**Version bumping is handled by Release Please**: Automated version updates in `config.json`, creates release tags automatically, triggers deployment pipeline.

---

## ElevenLabs Integration - Complete Guidelines

### Overview
This project provides integration with ElevenLabs Conversational AI platform, enabling voice-based interactions with the Hey Jarvis assistant.

### Project Description
A TypeScript-based integration that connects ElevenLabs voice AI agents with the Hey Jarvis ecosystem, providing natural voice conversations with personality-driven responses.

### Key Features
- **ElevenLabs Agent Integration**: WebSocket-based real-time conversation with ElevenLabs agents
- **Personality-Driven Prompts**: J.A.R.V.I.S.-inspired witty, loyal, and sophisticated AI assistant
- **LLM-Based Testing**: Automated evaluation of agent behavior using Gemini models
- **Agent Configuration Deployment**: Programmatic updating of ElevenLabs agent configurations

### Testing Guidelines

#### Test Score Requirements

**CRITICAL**: All tests must use strict score requirements to ensure high-quality agent behavior:

**✅ CORRECT Test Assertions:**
```typescript
// For tests that should pass with high confidence
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);  // Require >90% confidence
```

**❌ INCORRECT Test Assertions:**
```typescript
// NEVER use these lenient checks
expect(result.score).toBeGreaterThanOrEqual(0);  // ❌ Too lenient!
expect(result.score).toBeGreaterThan(0.5);       // ❌ Too low!
```

**Score Threshold Guidelines:**
- **Standard tests**: `> 0.9` (90%+ confidence required)
- **Only use lower thresholds** when explicitly justified
- **Never use `>= 0`** - this accepts any response including complete failures
- **Document exceptions**: If a test needs <0.9, add a comment explaining why

#### Evaluation Best Practices

The `TestConversation.evaluate()` method automatically:
- ✅ Evaluates the FULL conversation transcript (not just the last message)
- ✅ Uses semantic understanding via LLM evaluation
- ✅ Provides reasoning for pass/fail decisions
- ✅ Returns confidence scores (0-1 range)

When writing test criteria:
1. **Be specific**: "Agent addresses user as 'sir'" not "Agent is polite"
2. **Be measurable**: Criteria should have clear success conditions
3. **Consider context**: Evaluation looks at the whole conversation flow
4. **Expect excellence**: Default to 0.9+ score requirements

### Agent Prompt Requirements

The agent prompt in `src/assets/agent-prompt.md` defines:
- **Personality**: J.A.R.V.I.S.-inspired wit, dry humor, condescending but loyal
- **Addressing**: Always call the user "sir"
- **No Follow-ups**: Make assumptions rather than asking clarifying questions
- **Conciseness**: Brief, witty acknowledgements (5-15 words, max 20)
- **Step-wise Acknowledgements**: Before every tool call, provide a witty one-sentence summary

### Development Commands

**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx test elevenlabs` instead of running commands directly
- ✅ Use `nx build elevenlabs` instead of running commands directly
- ✅ Use `nx deploy elevenlabs` to update ElevenLabs agent configuration
- ✅ Use `nx refresh elevenlabs` to fetch current agent configuration
- ❌ **NEVER use npm commands** in this Bun-powered monorepo

### Environment Setup

This project uses **1Password CLI** for secure environment variable management:

**Required Environment Variables:**
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API for test evaluations

**1Password Setup:**
1. **Sign in**: `op signin`
2. **Verify**: `op whoami`
3. **Run tests**: `nx test elevenlabs` (automatically uses `op run`)

### Integration Capabilities

#### ElevenLabs Conversational AI
- Real-time voice conversations via WebSocket
- Agent configuration management via API
- Text-to-speech with customizable voices
- Conversational context and memory

#### Test Automation
- LLM-powered evaluation of agent responses
- Full transcript analysis for context-aware testing
- Personality and tone verification
- Conversation coherence validation

---

### Setup & Contributing Workflow

**Initial Setup**:
```bash
bun install  # Install dependencies (may take several minutes)
```

**Development Workflow**:
1. Use NX commands exclusively with bunx (`bunx nx`)
2. Follow factory patterns for mcp components
3. Respect file creation policies (especially mcp restrictions)
4. Test changes with appropriate NX targets
5. Maintain monorepo consistency across all projects

**Common Commands**:
```bash
# Show all projects and their dependencies
bunx nx graph

# Build all projects
bunx nx run-many --target=build --all

# Build specific project
bunx nx build [project-name]

# Serve/run specific project
bunx nx serve [project-name]
```

### Commit Message Standards

**CRITICAL: ALWAYS follow Conventional Commits** for all commit messages:

#### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Required Components
- **type**: Category of the change (REQUIRED)
- **scope**: Component affected (optional but recommended)
- **subject**: Brief description (REQUIRED, lowercase, no period)
- **body**: Detailed explanation (optional)
- **footer**: Breaking changes, issue references (optional)

#### Commit Types
- **feat**: New feature for the user
- **fix**: Bug fix for the user
- **docs**: Documentation only changes
- **style**: Formatting, missing semicolons, etc. (no code change)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or refactoring tests
- **chore**: Maintenance tasks, dependency updates
- **build**: Build system or external dependency changes
- **ci**: CI configuration changes

#### Examples
```bash
# Feature addition
feat(mcp): add calendar agent for scheduling

# Bug fix with scope
fix(shopping): correct product quantity calculation

# Documentation update
docs(agents): update workflow examples

# Breaking change
feat(api)!: change authentication method

BREAKING CHANGE: Auth now requires API key instead of password
```

#### Scope Guidelines
Use project names or component names:
- `mcp`, `agents`, `workflows`, `tools`
- `home-assistant-addon`, `config`
- `home-assistant-voice-firmware`, `firmware`
- `elevenlabs`, `voice`
- `build`, `ci`, `deps`

#### Best Practices
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter of subject
- No period at end of subject
- Use body to explain "what" and "why" vs. "how"
- Reference issues in footer: `Closes #123`

### Future Development Focus

- Model Context Protocol integration (mcp)
- Voice processing and recognition (home-assistant-voice-firmware)
- Home automation control coordination
- Cross-project AI agent communication
- Comprehensive end-to-end testing automation