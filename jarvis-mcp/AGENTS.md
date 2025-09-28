# Jarvis Mastra AI Agents

## Overview
This project is a Mastra-powered AI agent framework that enables intelligent home automation, voice interactions, and Model Context Protocol (MCP) integrations within the Hey Jarvis ecosystem.

## About Mastra
[Mastra](https://mastra.ai) is a TypeScript agent framework designed to build production-ready AI applications. It provides unified interfaces for multiple LLM providers, persistent agent memory, tool calling capabilities, and graph-based workflows.

## Project Structure
The project follows Mastra's recommended structure:

```
jarvis-mcp/
├── mastra/
│   ├── agents/           # AI agent definitions
│   ├── tools/           # Custom tool implementations
│   ├── workflows/       # Multi-step workflow graphs
│   └── index.ts         # Main Mastra configuration
├── project.json         # NX project configuration
└── AGENTS.md           # This documentation
```

## Key Features

### 🤖 Intelligent Agents
- **TypeScript-based agents** with persistent memory and tool calling
- **Multi-provider LLM support** via Vercel AI SDK (OpenAI, Anthropic, Google Gemini)
- **Structured output** generation with Zod validation
- **Real-time streaming** responses with step-by-step visibility

### 🔧 Tool Ecosystem
- **Model Context Protocol (MCP)** server integrations
- **Home automation tools** for smart device control
- **Voice processing** capabilities for speech-to-text and text-to-speech
- **External API integrations** for weather, calendar, and more

### 🌊 Workflow Engine
- **Graph-based workflows** with deterministic execution
- **Branching and conditional logic** with `.then()`, `.branch()`, `.parallel()`
- **Suspend/resume functionality** for human-in-the-loop interactions
- **Real-time tracing** and observability

### 🧠 Memory & Context
- **Persistent agent memory** with semantic recall
- **Thread-based conversations** with context preservation
- **Vector database integration** for knowledge retrieval
- **Working memory** for short-term context management

## Current Agents

### Weather Agent
Provides intelligent weather information and forecasting capabilities:
- **4 OpenWeatherMap tools**: Current weather and 5-day forecasts by city name or GPS coordinates
- **Google Gemini model**: Uses `gemini-2.0-flash-exp` for natural language processing
- **Smart defaults**: Automatically assumes ***REMOVED***, Denmark when no location is specified
- **Never asks questions**: Makes best-guess assumptions for seamless interaction
- **Persistent memory**: Maintains conversation context with LibSQLStore
- **Scheduled monitoring**: Hourly weather checks with automatic memory updates

**Converted from n8n**: This agent replicates the exact functionality of the original n8n Weather Agent workflow, including the same system message, tools, and behavior patterns.

### Shopping List Agent
Provides intelligent shopping list management for Bilka online store with Danish language support:
- **4 Bilka integration tools**: Product search via Algolia, cart quantity management, cart retrieval, and cart clearing
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing in Danish
- **Priority-based selection**: Organic certification, Danish origin, healthier options, and price optimization
- **Smart quantity handling**: Balances food waste reduction with requested quantities (20% tolerance)
- **Special product logic**: Separate handling for herbs (fresh vs dried), garlic units, and bundled vegetables
- **Danish product aliases**: Supports synonyms like "Soja → Sojasauce", "Rødkål → Rød spidskål"
- **Automatic authentication**: JWT token management with renewal for Bilka APIs
- **Error recovery**: Retry logic with simplified search terms and graceful failure handling

**Converted from n8n**: This agent maintains all the complex logic from the original n8n Shopping List Agent workflow, including the comprehensive priority hierarchy, special rules for herbs and quantities, and Danish product handling.

*Note: Additional agents will be added as the project evolves.*

## Available Workflows

### Weather Workflow
Multi-step weather processing workflow with two main components:
- **`weatherWorkflow`**: Handles interactive weather requests from prompts or chat (replaces n8n ExecuteWorkflowTrigger + ChatTrigger)
- **`weatherMonitoringWorkflow`**: Performs scheduled weather checks every hour with memory updates (replaces n8n ScheduleTrigger chain)
- **Agent integration**: Seamlessly connects to the weather agent for tool execution
- **Memory updates**: Automatically notifies other agents when weather conditions change

### Shopping List Workflow
Simplified shopping list processing workflow:
- **`shoppingListWorkflow`**: Handles natural language shopping requests in Danish (replaces complex n8n workflow with multiple agents and branching logic)
- **Agent-driven processing**: Leverages the intelligent shopping list agent for all operations including product extraction, search, selection, and cart management
- **Automatic cart synchronization**: Gets current cart state, processes changes, and provides user feedback
- **Error handling**: Comprehensive retry logic and graceful failure messages
- **Danish language support**: Processes requests and provides responses in Danish

## Development

### Prerequisites
```bash
# Install Mastra globally
npm install mastra --global
```

### Running the Project
```bash
# Start development server with playground
npx nx serve jarvis-mcp

# Build for production
npx nx build jarvis-mcp
```

### Development Playground
Access the Mastra development playground at `http://localhost:4111/agents` to:
- Test agents interactively
- Monitor agent memory and state
- Debug tool calls and workflows
- View execution traces and performance metrics

### Environment Setup

This project uses **1Password CLI** for secure environment variable management in both development and production environments. 

#### Required Environment Variables
Store these in your 1Password vault:
- **Weather**: `OPENWEATHERMAP_API_KEY` for weather data
- **AI Models**: `GOOGLE_GEMINI_API_KEY` for Gemini language models  
- **Shopping (Bilka)**: `BILKA_EMAIL`, `BILKA_PASSWORD`, `BILKA_API_KEY` for authentication
- **Shopping (Search)**: `ALGOLIA_API_KEY`, `ALGOLIA_APPLICATION_ID`, `BILKA_USER_TOKEN` for product search

#### Development Setup
1. **Install 1Password CLI**: Follow [1Password CLI installation guide](https://developer.1password.com/docs/cli/get-started/)
2. **Sign in to 1Password**: `op signin`
3. **Store your API keys** in 1Password vaults with the paths referenced in `.env`
4. **Run commands**: Use `nx serve jarvis-mcp` or `nx run jarvis-mcp:mcp` - both use `op run` automatically

#### Important Development Guidelines
- **Do NOT create separate `*-dev` targets** that bypass 1Password CLI
- **The `op run` approach is designed for both development AND production**
- **1Password CLI provides secure local testing** without hardcoded keys
- **All nx targets should use the same `op run --env-file=".env"` pattern**
- **This ensures consistency between development and deployment environments**

If you encounter 1Password CLI authentication issues:
1. Run `op signin` to authenticate
2. Verify your vault contains the referenced secret paths
3. Check that the `.env` file references match your 1Password structure

## Integration Capabilities

### Home Assistant
- Voice command processing through ESPHome firmware
- Smart device control and automation
- Sensor data processing and analysis
- Scene and routine management

### Model Context Protocol (MCP)
- Server-client communication for tool sharing
- Resource management and discovery
- Secure agent-to-agent communication
- Real-time data synchronization

### Voice Interface
- Speech-to-text processing
- Natural language understanding
- Text-to-speech generation with ElevenLabs
- Wake word detection and response

## Architecture Benefits

### Type Safety
- Full TypeScript support with runtime validation
- Zod schemas for structured data
- Type-safe tool definitions and agent configurations

### Scalability
- Horizontal scaling with workflow distribution
- Memory-efficient agent state management
- Observability and performance monitoring
- Cloud deployment ready (Vercel, Cloudflare, AWS Lambda)

### Extensibility
- Modular agent and tool architecture
- Plugin-based workflow system
- Easy integration with external services
- Custom evaluation and scoring systems

## Future Roadmap

### Enhanced Agents
- **Calendar Agent**: Smart scheduling and meeting management
- **Security Agent**: Home security monitoring and alerts
- **Entertainment Agent**: Media control and content recommendations
- **Energy Agent**: Smart energy management and optimization

### Advanced Workflows
- **Multi-agent orchestration** for complex home automation
- **Event-driven automation** with real-time triggers
- **Learning workflows** that adapt to user preferences
- **Emergency response** protocols with prioritization

### Integrations
- **Apple HomeKit** compatibility
- **Google Assistant** and **Alexa** voice integration
- **IFTTT/Zapier** workflow connections
- **IoT device ecosystem** expansion

## Development Guidelines

### File Creation Policy
**CRITICAL**: When working on this project:

#### ❌ ABSOLUTELY PROHIBITED FILES:
- **ANY new .md files** (README, GUIDE, DOCS, SHOPPING_README, etc.)
- **ANY documentation artifacts** (ANALYSIS.md, COMPARISON.md, ARCHITECTURE.md, etc.)
- **ANY explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md, etc.)
- **ANY example or demo scripts** unless explicitly requested
- **ANY test files or testing artifacts** outside the standard test directory structure
- **ANY configuration files** not directly required for functionality

#### ✅ ALLOWED FILE CREATION:
- **Core functionality files**: agents, tools, workflows in their respective directories
- **Environment templates**: Only `.env.example` when creating new integrations
- **Package configuration**: Only when required for new dependencies

#### 📝 DOCUMENTATION UPDATES:
- **UPDATE this AGENTS.md file** instead of creating new documentation
- **Add inline comments** in code for complex logic explanations
- **Update existing configuration files** when adding new features
- **Use the Mastra playground** for testing and examples instead of creating files

#### 🎯 REASONING:
This project follows a strict "lean documentation" approach because:
- **AGENTS.md is the single source of truth** for all project documentation
- **Scattered documentation** creates maintenance overhead and confusion
- **The Mastra playground** provides interactive testing without file creation
- **Inline comments** are more maintainable than separate documentation files
- **Multiple README files** violate the monorepo structure and NX conventions

**If you feel documentation is needed, ALWAYS update this AGENTS.md file instead of creating new files.**

### Build and Development Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve jarvis-mcp` instead of `npm run dev`
- ✅ Use `nx build jarvis-mcp` instead of `npm run build` 
- ✅ Use `nx test jarvis-mcp` instead of `npm run test`
- ✅ Use `nx lint jarvis-mcp` instead of `npm run lint`
- ✅ Use `npx nx install` for package installations through NX
- ❌ **NEVER use `npm run` commands** in this NX monorepo
- ❌ **NEVER use `npm install` directly** - use NX workspace commands
- ❌ **NEVER use `npm start`, `npm test`, `npm build`** - always prefix with `nx`

**Why NX is Required:**
- NX provides intelligent caching and dependency management
- Ensures consistent builds across the monorepo
- Manages project dependencies and task orchestration
- Prevents conflicts between different project configurations

### Tool ID Naming Conventions
**CRITICAL**: All tool IDs must follow kebab-case naming conventions:

#### ✅ CORRECT Examples:
- `get-current-weather` ✅
- `find-product-in-catalog` ✅  
- `set-product-basket-quantity` ✅
- `get-current-cart-contents` ✅
- `clear-cart-contents` ✅

#### ❌ INCORRECT Examples:
- `get_current_weather` ❌ (snake_case)
- `getCurrentWeather` ❌ (camelCase)
- `GetCurrentWeather` ❌ (PascalCase)
- `get current weather` ❌ (spaces)

#### 🎯 REASONING:
- **Consistency**: All tools across the project use the same naming pattern
- **Readability**: Kebab-case is easier to read in tool IDs and URLs
- **Standards**: Follows web standards and REST API conventions
- **Mastra compatibility**: Aligns with Mastra's recommended practices

**When creating new tools, ALWAYS use kebab-case for tool IDs.**

### Agent Architecture Guidelines
When refactoring or creating agents:
- **Prefer specialized agents** over single multi-purpose agents for complex workflows
- **Keep agent prompts focused** on specific cognitive tasks
- **Use clear separation of concerns** between search, selection, generation, and formatting
- **Maintain backward compatibility** by keeping original agent names as aliases
- **Update the main Mastra index** to register all new specialized agents
- **Test agent interactions** using the Mastra playground at `http://localhost:4111/agents`

This keeps the project lean, properly structured, and aligned with NX monorepo best practices.

## Contributing
This project is part of the Hey Jarvis monorepo and follows Mastra's development patterns. Contributions should:
- Follow TypeScript best practices
- Include proper agent memory management
- Implement comprehensive tool validation
- Add appropriate workflow testing
- Document new capabilities thoroughly

For more information about Mastra development, visit the [official documentation](https://mastra.ai/docs).