# Jarvis MCP Server

A Mastra AI-powered Model Context Protocol (MCP) server that provides intelligent agents and tools for comprehensive home automation and voice assistance.

## Overview

This TypeScript application serves as the brain of the Jarvis ecosystem, implementing a robust MCP server with AI agents powered by Google Gemini models. It processes voice commands from ElevenLabs, executes intelligent tool operations, and integrates with various services for home automation, weather monitoring, shopping assistance, and more.

## Features

- **AI-Powered Agents**: Multiple specialized agents for different domains (weather, shopping, cooking)
- **Model Context Protocol**: Standards-compliant MCP server for tool sharing and communication
- **Persistent Memory**: Agent memory with semantic recall and context preservation
- **Tool Ecosystem**: Rich collection of tools for external service integration
- **Workflow Engine**: Graph-based workflows with conditional logic and human-in-the-loop capabilities
- **Real-time Streaming**: Live response streaming with step-by-step visibility
- **Comprehensive Evaluation**: Automatic scoring for response quality and accuracy

## Architecture

### Vertical Organization
The project is organized by business verticals rather than technical layers:

```
mastra/verticals/
├── weather/          # Weather forecasting and monitoring
├── shopping/         # Bilka shopping list management  
├── cooking/          # Recipe search and meal planning
└── [future verticals]
```

### Key Components

- **Agents**: AI agents with specialized instructions and tool access
- **Tools**: External service integrations (APIs, databases, etc.)
- **Workflows**: Multi-step processes with branching and parallel execution
- **Memory**: Persistent conversation context and semantic knowledge storage
- **Scorers**: Automated evaluation for response quality and accuracy

## Quick Start

```bash
# Start development server with playground
nx serve mcp

# Build for production  
nx build mcp

# Run MCP server only
nx run mcp:mcp
```

## Development Playground

Access the interactive playground at `http://localhost:4111/agents` to:
- Test agents in real-time
- Monitor memory and conversation state
- Debug tool calls and workflow execution
- View performance metrics and evaluation scores

## Current Agents

### Weather Agent
- **Tools**: OpenWeatherMap integration (current + 5-day forecasts)
- **Model**: Google Gemini 2.0 Flash Experimental
- **Features**: Smart location defaults, scheduled monitoring, persistent memory
- **Coverage**: Weather by city name or GPS coordinates

### Shopping Agent
- **Tools**: Bilka online store integration with Algolia search
- **Model**: Google Gemini Flash Latest  
- **Features**: Danish language support, organic preference, smart quantity handling
- **Capabilities**: Product search, cart management, price optimization

### Recipe Search Agent
- **Tools**: Valdemarsro Danish recipe database
- **Model**: Google Gemini Flash Latest
- **Features**: Recipe search, nutritional information, cooking guidance
- **Specialization**: Danish cuisine focus with general cooking support

### Meal Planning Agents
- **Specialized Agents**: 3 dedicated agents for complex meal planning workflows
- **Tools**: Recipe database integration with filtering and selection
- **Features**: Weekly planning, dietary preferences, shopping list generation

## Environment Setup

This project uses **1Password CLI** for secure environment management:

1. Install [1Password CLI](https://developer.1password.com/docs/cli/get-started/)
2. Sign in: `op signin`
3. Store required secrets in your 1Password vault:
   - `HEY_JARVIS_OPENWEATHERMAP_API_KEY`
   - `HEY_JARVIS_GOOGLE_GEMINI_API_KEY`
   - `HEY_JARVIS_BILKA_EMAIL`, `HEY_JARVIS_BILKA_PASSWORD`, `HEY_JARVIS_BILKA_API_KEY`
   - `ALGOLIA_API_KEY`, `ALGOLIA_APPLICATION_ID`

All NX commands automatically use `op run` for secure credential injection.

## Available Workflows

### Weather Monitoring
- **Interactive Requests**: Process weather queries from voice/chat
- **Scheduled Monitoring**: Hourly weather checks with memory updates
- **Agent Integration**: Seamless connection to weather agent tools

### Shopping List Management
- **Multi-Agent Architecture**: 3-step process with specialized agents
- **Danish Language**: Full Danish language support for requests and responses
- **Cart Management**: Before/after comparison with intelligent product selection
- **Error Handling**: Comprehensive retry logic and graceful failure recovery

### Weekly Meal Planning
- **Tool-as-Step**: Direct recipe database access for efficiency
- **Agent-as-Step**: Intelligent meal selection with dietary considerations
- **Multi-Step Process**: Recipe fetching → meal planning → output formatting

## Integration Capabilities

### Model Context Protocol
- Server-client communication for tool sharing
- Resource management and discovery  
- Secure agent-to-agent communication
- Real-time data synchronization

### External Services
- **ElevenLabs**: Voice interface integration
- **Home Assistant**: Smart device control
- **OpenWeatherMap**: Weather data and forecasting
- **Bilka**: Danish grocery shopping
- **Valdemarsro**: Danish recipe database

### Voice Processing
- Speech-to-text processing
- Natural language understanding
- Text-to-speech generation
- Wake word detection and response

## Development Guidelines

### Factory Pattern Usage
All components must use Hey Jarvis factory functions:

```typescript
// Agents
import { createAgent } from '../../utils/agent-factory';
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
});

// Tools  
import { createTool } from '../../utils/tool-factory';
export const myTool = createTool({
  id: 'my-tool-action', // kebab-case required
  description: 'Performs a specific action',
  inputSchema: z.object({ input: z.string() }),
  execute: async ({ context }) => ({ result: context.input }),
});
```

### YAGNI Principle
- Only implement features when actually needed
- Keep abstractions minimal until complexity is required
- Avoid speculative configuration options
- Add dependencies only when they solve actual problems

### Naming Conventions
- **Tool IDs**: Always `kebab-case` (e.g., `get-current-weather`)
- **Agents**: `[vertical]Agent` or `[vertical][Purpose]Agent`
- **Files**: `agent.ts` (single) or `agents.ts` (multiple)

For complete development guidelines, see [AGENTS.md](./AGENTS.md).

## Future Roadmap

- **Calendar Agent**: Smart scheduling and meeting management
- **Security Agent**: Home security monitoring and alerts  
- **Entertainment Agent**: Media control and content recommendations
- **Energy Agent**: Smart energy management and optimization
- **Multi-agent Orchestration**: Complex home automation workflows
- **Learning Workflows**: Adaptive behavior based on user preferences

## Contributing

This project follows strict development principles:
- Use NX commands exclusively (`nx serve mcp`)
- Follow vertical organization patterns
- Implement factory pattern for all components
- Include comprehensive evaluation and scoring
- Maintain persistent agent memory
- Document all changes in AGENTS.md

For detailed contribution guidelines, see [AGENTS.md](./AGENTS.md).