# Jarvis Mastra AI Agents

## Overview
This project is a Mastra-powered AI agent framework that enables intelligent home automation, voice interactions, and Model Context Protocol (MCP) integrations within the Hey Jarvis ecosystem.

## About Mastra
[Mastra](https://mastra.ai) is a TypeScript agent framework designed to build production-ready AI applications. It provides unified interfaces for multiple LLM providers, persistent agent memory, tool calling capabilities, and graph-based workflows.

**This project uses Mastra V1 beta** (v1.0.0-beta.2), which is the upcoming stable release with standardized APIs and improved production readiness.

### Mastra V1 Migration
As of the latest update, this project has been migrated to Mastra V1 beta:
- **@mastra/core**: 1.0.0-beta.2 (previously 0.24.0)
- **mastra CLI**: 1.0.0-beta.1 (previously 0.18.0)
- **Supporting packages**: Continue using stable versions until V1 beta releases are available
  - @mastra/memory: 0.15.11
  - @mastra/libsql: 0.16.2
  - @mastra/loggers: 0.10.19
  - @mastra/mcp: 0.14.2
  - @mastra/evals: 0.14.4

**Key API changes:**
- `streamVNext()` → `stream()` - Now the standard streaming API
- `generateVNext()` → `generate()` - Now the standard generation API
- Full AI SDK v5 compatibility
- Enhanced structured output options
- Unified API signatures across the framework

For more details, see the [official migration guide](https://mastra.ai/guides/v1/migrations/upgrade-to-v1/overview).

## Project Structure
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
│   │   ├── cooking/     # Cooking vertical
│   │   │   ├── agent.ts        # General recipe search agent
│   │   │   ├── tools.ts
│   │   │   ├── meal-planning/  # Sub-vertical for meal planning
│   │   │   │   ├── agents.ts   # 3 specialized meal planning agents
│   │   │   │   ├── workflows.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── coding/      # GitHub repository management
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   └── notification/    # Proactive notifications
│   │       ├── agent.ts
│   │       ├── tools.ts
│   │       ├── workflows.ts
│   │       └── index.ts
│   ├── processors/      # Output processors for post-processing
│   │   ├── error-reporting.ts
│   │   └── index.ts
│   ├── memory/          # Shared memory management
│   ├── storage/         # Shared storage configuration
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
- **Smart defaults**: Automatically assumes Mathias, Denmark when no location is specified
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

### Recipe Search Agent
Provides general cooking and recipe search capabilities:
- **4 Valdemarsro tools**: Recipe search, get by ID, get all recipes, and search filters
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Danish recipe focus**: Specialized for Danish cuisine from Valdemarsro website
- **General purpose**: Handles recipe search, information retrieval, and general cooking questions
- **Clear boundaries**: Does NOT handle meal planning, scheduling, or email formatting

**Part of cooking vertical**: This agent handles general recipe-related queries, while specialized meal planning agents handle the complex multi-step planning workflows.

### Notification Agent
Provides proactive notification delivery to Home Assistant Voice Preview Edition devices:
- **1 notification tool**: Sends voice notifications via ElevenLabs-enabled voice devices
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Proactive messaging**: Triggers conversations without wake word activation
- **Configurable timeout**: Default 5-second timeout after notification delivery
- **Device targeting**: Can notify specific devices or broadcast to all available devices
- **Home Assistant integration**: Works through ESPHome API service calls
- **Error reporting**: Configured with error reporting processor (see Processors section)

**Key Capabilities:**
- Send notifications proactively without user initiation
- Start interactive conversations after notification
- Automatically timeout if no user response within configured period
- Support for custom notification messages
- Integration with Home Assistant automation system
- Automatic error reporting to GitHub when failures occur

**Example Use Cases:**
- "Remind me about my meeting in 5 minutes"
- "Notify me when the laundry is done"
- "Alert me if the temperature drops below 18°C"
- "Let me know when dinner is ready"

### Coding Agent
Manages GitHub repositories and provides coding task coordination:
- **4 GitHub tools**: List repositories, list issues, search repositories, create GitHub issues
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Repository management**: Browse and search repositories for any GitHub user
- **Issue tracking**: View open, closed, or all issues for repositories
- **Issue creation**: Create new GitHub issues with title, body, and labels
- **Smart defaults**: Defaults to "ffMathy" owner when not specified

**Key Capabilities:**
- List all public repositories for a GitHub user
- Search repositories by name, keywords, or topics
- View issues with filtering by state (open/closed/all)
- Create GitHub issues programmatically (used by error reporting processor)
- Provide GitHub URLs for quick access to repositories and issues

**Example Use Cases:**
- "What repositories does ffMathy have?"
- "Show me open issues in hey-jarvis"
- "Search for repositories about AI agents"
- "Create an issue for the bug I just reported"

*Note: Additional agents will be added as the project evolves.*

## Available Workflows

### Notification Workflow
Proactive notification delivery workflow with validation and device targeting:
- **`notificationWorkflow`**: Sends proactive voice notifications to Home Assistant Voice Preview Edition devices
- **Step 1 - Validation**: Ensures notification message is not empty and within reasonable length (max 500 characters)
- **Step 2 - Delivery**: Sends notification via ESPHome service with configurable timeout
- **Device support**: Can target specific device by name or broadcast to all devices
- **Timeout configuration**: Default 5-second conversation timeout, configurable per notification
- **Error handling**: Graceful failure messages for validation errors and API failures

**Technical Implementation:**
- Uses ESPHome API service: `esphome.{device_name}_send_notification`
- Parameters: `message` (string), `timeout` (integer in milliseconds)
- Requires device firmware with ElevenLabs integration and custom action support
- Works within Home Assistant addon environment with Supervisor token

**Usage Example:**
```typescript
await mastra.workflows.notificationWorkflow.execute({
  message: "Sir, your meeting starts in 5 minutes",
  deviceName: "hass_elevenlabs", // Optional: defaults to "hass_elevenlabs"
  conversationTimeout: 5000, // Optional: defaults to 5000ms
});
```

**ESPHome Device Configuration:**
The target device must have the following service configured:
```yaml
api:
  services:
    - service: send_notification
      variables:
        message: string
        timeout: int
      then:
        - elevenlabs_stream.start:
            initial_message: !lambda 'return message;'
            timeout: !lambda 'return timeout;'
```

### Weather Workflow
Multi-step weather processing workflow with two main components:
- **`weatherWorkflow`**: Handles interactive weather requests from prompts or chat (replaces n8n ExecuteWorkflowTrigger + ChatTrigger)
- **`weatherMonitoringWorkflow`**: Performs scheduled weather checks every hour with memory updates (replaces n8n ScheduleTrigger chain)
- **Agent integration**: Seamlessly connects to the weather agent for tool execution
- **Memory updates**: Automatically notifies other agents when weather conditions change

### Shopping List Workflow
Multi-step shopping list processing workflow implementing the original n8n 3-agent architecture:
- **`shoppingListWorkflow`**: Handles natural language shopping requests in Danish with 5-step process
- **Step 1 - Cart Snapshot**: Gets current cart contents as "before" baseline
- **Step 2 - Information Extraction**: Uses specialized Information Extractor agent to parse user requests into structured product data with operation types (set/remove/null)
- **Step 3 - Product Mutation**: Processes each extracted product using Shopping List Mutator Agent with full tool access for search, selection, and cart modification
- **Step 4 - Updated Cart Snapshot**: Gets final cart contents as "after" comparison
- **Step 5 - Summary Generation**: Uses Summarization Agent to compare before/after states and provide user feedback in Danish
- **Error handling**: Comprehensive retry logic and graceful failure messages for each step
- **Danish language support**: Processes requests and provides responses in Danish

**Converted from n8n**: This workflow replicates the exact 3-agent pattern from the original n8n Shopping List Agent workflow, including Information Extractor → Shopping List Mutator → Summarization Agent flow with before/after cart comparison.

## Processors

### 🔍 **Output Processors**
This project implements custom output processors that run after agent responses are generated. Processors enable post-processing logic without blocking the main agent flow.

### **Error Reporting Processor**
Automatically captures errors from agent responses and creates GitHub issues with sanitized information.

**Features:**
- **Asynchronous execution**: Runs in background without blocking agent responses
- **Error detection**: Scans agent output for error indicators (keywords: "error", "failed", "exception", "stack trace")
- **PII sanitization**: Uses Mastra's built-in PIIDetector to remove sensitive information before creating issues
- **GitHub integration**: Creates issues using the `createGitHubIssue` tool
- **Automatic integration**: Added to ALL agents by default via agent factory
- **Configurable**: Labels, repository, and enable/disable options

**Automatic Integration:**
The error reporting processor is automatically added to all agents created with `createAgent()`. No manual configuration needed - every agent gets error reporting by default.

```typescript
// Error reporting is automatically included
export async function getMyAgent() {
  return createAgent({
    name: 'MyAgent',
    instructions: '...',
    tools: myTools,
    // Error reporting processor is automatically added
  });
}
```

**Configuration:**
- `owner` (optional): Repository owner, defaults to "ffMathy"
- `repo` (required): Repository name where issues will be created
- `labels` (optional): Issue labels, defaults to `["automated-error", "bug"]`
- `enabled` (optional): Enable/disable processor, defaults to `true`

**Environment Requirements:**
- `HEY_JARVIS_GITHUB_API_TOKEN`: GitHub Personal Access Token with `repo` scope

**How It Works:**
1. After agent generates response, processor scans messages for error indicators
2. If error detected, Mastra's PIIDetector sanitizes the error message (removes PII)
3. GitHub issue is created with sanitized error using `createGitHubIssue` tool
4. All processing happens asynchronously - agent response returns immediately

**Testing:**
```bash
# Start MCP server
bunx nx serve mcp

# Access playground at http://localhost:4111/agents
# Select any agent (all have error reporting)
# Send message containing error keywords: "error", "failed", "exception", "stack trace"
# Verify agent responds immediately (non-blocking)
# Check GitHub repository for created issue with sanitized error
```

**PII Redaction Examples:**
Mastra's PIIDetector automatically redacts:
- Email: `user@example.com` → `[EMAIL]`
- API Key: `sk_live_abc123` → `[API-KEY]`
- IP Address: `192.168.1.1` → `[IP-ADDRESS]`
- Phone: `555-1234` → `[PHONE]`
- Credit Card: `4111-1111-1111-1111` → `[CREDIT-CARD]`

**Architecture Notes:**
- **Async execution**: Processor doesn't block agent responses (~2-3s background processing)
- **Error detection**: Simple keyword matching (very fast)
- **PII sanitization**: Uses Mastra's PIIDetector with Google Gemini (~1-2 seconds)
- **Issue creation**: GitHub API call (~0.5-1 second)
- **Failure handling**: Processor errors are logged but don't fail the main agent flow

## Agent-as-Step and Tool-as-Step Patterns

### 🔄 **Modern Workflow Architecture**
All workflows in this project have been converted to use **agent-as-step** and **tool-as-step** patterns, which provide:

- **Better Reusability**: Existing agents and tools become reusable workflow components
- **Simplified Logic**: Less custom step code, more declarative workflow composition  
- **Consistent Behavior**: Agent and tool behavior is the same whether used standalone or in workflows
- **Easier Maintenance**: Changes to agents/tools automatically benefit all workflows using them

### 🤖 **Agent-as-Step Pattern**
Uses existing agents directly as workflow steps:

```typescript
const weatherStep = createAgentStep({
  id: 'weather-check',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
  structuredOutput: { // Optional for JSON responses
    schema: z.object({ temperature: z.number(), condition: z.string() })
  }
});
```

**Benefits:**
- Leverages existing agent intelligence and tool access
- Consistent prompting and response handling
- Automatic scoring and evaluation (when enabled)
- Memory integration

### 🔧 **Tool-as-Step Pattern** 
Uses existing tools directly as workflow steps:

```typescript
const getCurrentWeatherStep = createToolStep({
  id: 'get-current-weather',
  description: 'Get current weather for a city',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});
```

**Benefits:**
- Direct tool execution without agent overhead
- Precise input/output transformation
- Better for deterministic operations
- Faster execution for simple operations

### 🌊 **Converted Workflows**

#### **Weather Monitoring Workflow**
- **Before**: Custom step with manual agent calling
- **After**: Agent-as-step pattern with weather agent
- **Improvement**: Simplified from 2 custom steps to 1 agent step + 1 transform step

#### **Weekly Meal Planning Workflow**  
- **Before**: Complex custom steps calling multiple agents
- **After**: Tool-as-step for recipe fetching + agent-as-step for meal planning
- **Improvement**: Tool-as-step for `getAllRecipes`, agent-as-step for `mealPlanGenerator`

#### **Shopping List Workflow**
- **Before**: 5 complex custom steps with inline agent creation
- **After**: Mix of tool-as-step and agent-as-step patterns
- **Improvement**: Tool-as-step for cart operations, agent-as-step for extraction/processing/summarization

### 📋 **Pattern Selection Guidelines**

**Use Agent-as-Step when:**
- Need natural language processing
- Require tool calling capabilities  
- Want conversation context
- Need flexible, intelligent responses

**Use Tool-as-Step when:**
- Have deterministic operations
- Need direct API calls
- Want precise input/output control
- Prefer faster execution

**Use Custom Steps when:**
- Need complex data transformation
- Require workflow-specific logic
- Must combine multiple operations
- Need conditional branching

## Development

### Prerequisites
```bash
# Install Mastra globally
bun install mastra --global
```

### Running the Project
```bash
# Start development server with playground
bunx nx serve mcp

# Build for production
bunx nx build mcp
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
All environment variables use the `HEY_JARVIS_` prefix for easy management and DevContainer forwarding. Store these in your 1Password vault:
- **Weather**: `HEY_JARVIS_OPENWEATHERMAP_API_KEY` for weather data
- **AI Models**: `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` for Gemini language models (explicitly configured in agent factory)
- **Shopping (Bilka)**: `HEY_JARVIS_BILKA_EMAIL`, `HEY_JARVIS_BILKA_PASSWORD`, `HEY_JARVIS_BILKA_API_KEY` for authentication
- **Shopping (Search)**: `HEY_JARVIS_ALGOLIA_API_KEY`, `HEY_JARVIS_ALGOLIA_APPLICATION_ID`, `HEY_JARVIS_BILKA_USER_TOKEN` for product search
- **ElevenLabs**: `HEY_JARVIS_ELEVENLABS_API_KEY`, `HEY_JARVIS_ELEVENLABS_AGENT_ID`, `HEY_JARVIS_ELEVENLABS_VOICE_ID` for voice AI
- **Recipes**: `HEY_JARVIS_VALDEMARSRO_API_KEY` for Danish recipe data
- **GitHub**: `HEY_JARVIS_GITHUB_API_TOKEN` for GitHub API access (coding agent and error reporting processor)
- **WiFi**: `HEY_JARVIS_WIFI_SSID`, `HEY_JARVIS_WIFI_PASSWORD` for Home Assistant Voice Firmware
- **Authentication**: `HEY_JARVIS_MCP_JWT_SECRET` for JWT-based HTTP authentication of the MCP server (Mastra UI is protected by Home Assistant ingress)

#### Development Setup
1. **Install 1Password CLI**: Follow [1Password CLI installation guide](https://developer.1password.com/docs/cli/get-started/)
2. **Sign in to 1Password**: `op signin`
3. **Store your API keys** in 1Password vaults with the paths referenced in `.env`
4. **Run commands**: Use `nx serve mcp` or `nx run mcp:mcp` - both use `op run` automatically

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

## MCP Server Authentication

The MCP server supports JWT (JSON Web Token) authentication for secure access over HTTP. Authentication is handled at the Nginx reverse proxy layer in the Home Assistant addon, providing protection for the MCP server endpoints (port 4112) while allowing open access to the Mastra UI (port 4111) which is protected by Home Assistant's ingress authentication.

### JWT Authentication Setup

#### 1. Configure JWT Secret

**For Home Assistant Addon:**
Configure the JWT secret in the addon configuration:
1. Go to **Supervisor** → **Hey Jarvis MCP Server** → **Configuration**
2. Add your JWT secret to the `jwt_secret` field
3. Save and restart the addon

**For Development with 1Password:**
Store a secure JWT secret in your 1Password vault:
```bash
# The secret should be a strong, randomly generated string
HEY_JARVIS_MCP_JWT_SECRET="op://Personal/Jarvis/JWT secret"
```

**Important**: The JWT secret should be:
- At least 32 characters long
- Randomly generated (use a password generator)
- Kept secure in your 1Password vault or Home Assistant configuration
- Never committed to version control

#### 2. Generate JWT Tokens
Generate JWT tokens using any JWT library that supports HS256 signing. For example, using Node.js:

```javascript
import { sign } from 'hono/jwt';

const payload = {
  sub: 'mcp-client',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
};

const token = await sign(payload, process.env.HEY_JARVIS_MCP_JWT_SECRET);
```

Or use online tools like [jwt.io](https://jwt.io) with the HS256 algorithm.

#### 3. Using JWT Tokens
Include the JWT token in the `Authorization` header of HTTP requests to the MCP server:

```bash
# Example curl command for MCP server (requires JWT)
curl -H "Authorization: Bearer <your-token>" \
     -X POST \
     http://localhost:4112/api/mcp

# Mastra UI does NOT require JWT - it's protected by Home Assistant ingress
# Access through Home Assistant ingress: http://homeassistant.local:8123/...
```

#### 4. Token Format
Tokens must use the "Bearer" authentication scheme:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Security Features

- **Nginx-Based Authentication**: JWT validation happens at the Nginx layer for MCP server endpoints
- **Selective Protection**: Only MCP server (`/api/mcp`) requires JWT authentication
- **Mastra UI Access**: Mastra UI is accessible without JWT (protected by Home Assistant ingress instead)
- **HTTP-Only Authentication**: JWT authentication applies only to HTTP transport. The stdio transport (used for local development with MCP clients) is unaffected.
- **Token Validation**: All MCP HTTP requests are validated before reaching the backend service.
- **Graceful Degradation**: If JWT secret is not configured, the MCP server runs without authentication (useful for development).
- **401 Unauthorized**: Invalid or missing tokens receive a clear error response from Nginx.
- **Standard JWT**: Uses industry-standard JWT format (HS256 algorithm) compatible with all JWT libraries.

### Authentication Flow

1. Client sends HTTP request to `/api/mcp` with `Authorization: Bearer <token>` header
2. Nginx extracts and validates the JWT token using the configured secret via nginx-mod-http-auth-jwt
3. If valid, request is proxied to the MCP server (port 4112)
4. If invalid/missing, Nginx returns 401 Unauthorized response
5. Requests to other paths (Mastra UI) are proxied without JWT validation

### Disabling Authentication

To disable authentication (not recommended for production):
- **Home Assistant Addon**: Leave the `jwt_secret` field empty in the addon configuration
- **Development**: Don't set `HEY_JARVIS_MCP_JWT_SECRET` environment variable
- The MCP server will be accessible without authentication

### Token Payload

JWT tokens should include standard claims:
- `sub`: Subject identifier (e.g., "mcp-client")
- `iat`: Issued at timestamp
- `exp`: Expiration timestamp (recommended: 24 hours or less)

Tokens can be created using any JWT library that supports HS256 signing with your JWT secret.

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

### Vertical Organization
- **Business Domain Alignment**: Code is organized by business verticals (weather, shopping, cooking) rather than technical layers
- **High Cohesion**: Related agents, tools, and workflows are co-located for better maintainability
- **Sub-vertical Support**: Complex verticals like cooking can have sub-folders (meal-planning) for specialized flows
- **Clear Ownership**: Each vertical has its own focused scope and responsibilities

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

## Vertical Organization Conventions

### 📋 **Core Principles**
This project uses **vertical organization** where code is grouped by business domain rather than technical layer. Follow these conventions for all future development:

### 🏗️ **Directory Structure Rules**

#### **1. New Vertical Creation**
When adding a new business vertical (e.g., `calendar`, `security`, `entertainment`):

```bash
# Create the vertical directory structure
mastra/verticals/[vertical-name]/
├── agent.ts          # Single general-purpose agent (if simple)
├── agents.ts         # Multiple agents (if moderate complexity)
├── tools.ts          # All tools for this vertical
├── workflows.ts      # All workflows for this vertical
└── index.ts          # Export everything from this vertical
```

**Examples:**
- **Simple vertical**: `weather/` (1 agent, 1 workflow)
- **Moderate vertical**: `shopping/` (2 agents, 1 workflow)
- **Complex vertical**: `cooking/` (1 general + 3 specialized agents, 1 workflow)

#### **2. Sub-Vertical Creation**
For complex verticals with multiple specialized flows, create sub-verticals:

```bash
# Complex vertical with sub-vertical
mastra/verticals/[vertical-name]/
├── agent.ts                    # General vertical agent
├── tools.ts                    # Shared tools for the vertical
├── [sub-vertical-name]/        # Specialized sub-vertical
│   ├── agents.ts              # Specialized agents
│   ├── workflows.ts           # Specialized workflows
│   └── index.ts               # Sub-vertical exports
└── index.ts                   # Main vertical exports
```

**Example**: `cooking/meal-planning/` contains 3 specialized agents for complex meal planning workflows

### 🎯 **Naming Conventions**

#### **File Naming**
- **Single agent**: `agent.ts` (e.g., `weather/agent.ts`)
- **Multiple agents**: `agents.ts` (e.g., `shopping/agents.ts`)
- **Tools**: Always `tools.ts`
- **Workflows**: Always `workflows.ts`
- **Exports**: Always `index.ts`

#### **Agent Naming**
- **General agents**: `[vertical]Agent` (e.g., `weatherAgent`, `recipeSearchAgent`)
- **Specialized agents**: `[vertical][Purpose]Agent` (e.g., `mealPlanSelectorAgent`, `shoppingListSummaryAgent`)

#### **Tool Naming**
- **Tool IDs**: Always use `camelCase` matching the variable name (e.g., `getCurrentWeather`, `findProductInCatalog`)
- **Tool variable names**: Must exactly match their tool ID (e.g., tool ID `getCurrentWeather` = variable name `getCurrentWeather`)
- **Tool exports**: **CRITICAL** - Export tools using the variable name directly as shorthand
- **Tool collection exports**: Use `[vertical]Tools` (e.g., `weatherTools`, `cookingTools`)

**Example - CORRECT Tool Naming:**
```typescript
// ✅ CORRECT: Variable name matches tool ID (camelCase)
export const getCurrentWeather = createTool({
  id: 'getCurrentWeather',  // camelCase ID matching variable name
  // ... tool config
});

export const weatherTools = {
  getCurrentWeather,  // ✅ Shorthand - key and value use same name
  getForecast,
};
```

**Example - INCORRECT Tool Naming:**
```typescript
// ❌ INCORRECT: Variable name doesn't match ID
export const fetchWeather = createTool({
  id: 'getCurrentWeather',  // ❌ ID doesn't match variable name
  // ... tool config
});

// ❌ INCORRECT: Using different key than variable name
export const weatherTools = {
  'get-current-weather': getCurrentWeather,  // ❌ Wrong key format!
};
```

**Why This Matters:**
Mastra's `/api/tools` endpoint requires tool keys to match their tool IDs. When tools are registered in the Mastra instance, the object keys become the tool identifiers used by the API. The tool ID, variable name, and export key must all be identical for tools to be properly exposed.

#### **Workflow Naming**
- **Workflow IDs**: Use `kebab-case` (e.g., `weather-monitoring-workflow`)
- **Workflow exports**: Use descriptive names (e.g., `weatherMonitoringWorkflow`, `weeklyMealPlanningWorkflow`)

### 📦 **Export Patterns**

#### **Vertical Index Exports**
Each vertical's `index.ts` must follow this pattern:

```typescript
// [Vertical] vertical exports
export { [agent/agents] } from './agent'; // or './agents'
export { [vertical]Tools } from './tools';
export { [workflows] } from './workflows';
export * from './[sub-vertical]'; // if sub-verticals exist
```

#### **Main Verticals Index**
The main `verticals/index.ts` should export everything:

```typescript
// Main verticals exports
export * from './weather';
export * from './shopping';
export * from './cooking';
export * from './[new-vertical]'; // Add new verticals here
```

### 🔧 **Implementation Guidelines**

#### **Agent Creation Rules**
1. **Start Simple**: Begin with a single general agent (`agent.ts`)
2. **Split When Complex**: If >3 distinct responsibilities, consider multiple agents (`agents.ts`)
3. **Create Sub-Verticals**: If >4 agents, create specialized sub-verticals
4. **Maintain Focus**: Each agent should have ONE clear responsibility

#### **Tool Organization Rules**
1. **Vertical Ownership**: All tools for a vertical go in its `tools.ts`
2. **No Cross-Vertical Tools**: Tools belong to exactly one vertical
3. **Shared Tools**: If truly shared, create a new `shared/` vertical
4. **API Integration**: Group related API calls in the same vertical
5. **CRITICAL - Tool Naming**: Tool ID, variable name, and export key must all be identical camelCase

**Tool Export Pattern:**
```typescript
// In tools.ts - Export using variable name directly (shorthand)
export const weatherTools = {
  getCurrentWeather,        // ✅ Shorthand for getCurrentWeather: getCurrentWeather
  getForecastByCity,        // ✅ ID, variable, and key all match
};

// In index.ts - Export the tools object
export { weatherTools } from './tools';

// In mastra/index.ts - Spread into Mastra config
tools: {
  ...weatherTools,  // Keys will be tool IDs (camelCase)
  ...shoppingTools,
}
```

#### **Workflow Rules**
1. **Domain Alignment**: Workflows should match business processes, not technical steps
2. **Single Vertical**: Workflows should primarily use agents/tools from their own vertical
3. **Cross-Vertical**: If using multiple verticals, consider if it should be in a new vertical

### 🚀 **Step-by-Step: Adding a New Vertical**

#### **Example: Adding a Calendar Vertical**

1. **Create Directory Structure**:
```bash
mkdir -p mastra/verticals/calendar
```

2. **Create Core Files**:
```typescript
// calendar/agent.ts
import { createAgent } from '../../utils/agent-factory';

export const calendarAgent = createAgent({
  name: 'Calendar',
  instructions: 'You are a calendar management agent...',
  tools: calendarTools,
  // memory and model automatically provided by factory
});

// calendar/tools.ts  
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const getCalendarEvents = createTool({
  id: 'getCalendarEvents',  // camelCase matching variable name
  // ... tool config
});

export const calendarTools = {
  getCalendarEvents,  // Shorthand export
};

// calendar/workflows.ts
import { createWorkflow, createStep } from '../../utils/workflow-factory';

export const calendarSyncWorkflow = createWorkflow({
  id: 'calendar-sync-workflow',
  // ... workflow config
});

// calendar/index.ts
export { calendarAgent } from './agent';
export { calendarTools } from './tools';
export { calendarSyncWorkflow } from './workflows';
```

3. **Update Main Exports**:
```typescript
// verticals/index.ts
export * from './weather';
export * from './shopping';  
export * from './cooking';
export * from './calendar'; // Add new vertical
```

4. **Register in Mastra**:
```typescript
// mastra/index.ts
import { calendarAgent, calendarSyncWorkflow } from './verticals';

export const mastra = new Mastra({
  agents: {
    // ... existing agents
    calendar: calendarAgent,
  },
  workflows: {
    // ... existing workflows  
    calendarSyncWorkflow,
  },
});
```

### ✅ **Validation Checklist**
Before considering a vertical complete:

- [ ] Directory follows naming conventions
- [ ] All files use proper naming patterns  
- [ ] Exports are properly structured
- [ ] Agent responsibilities are clear and focused
- [ ] Tools use kebab-case IDs
- [ ] Workflows match business processes
- [ ] Main index files are updated
- [ ] Build passes: `nx build mcp`
- [ ] Documentation updated in this AGENTS.md file

### 🎯 **When to Create Sub-Verticals**
Create sub-verticals when:
- **>4 specialized agents** in one vertical
- **Multiple distinct workflows** that share some but not all tools
- **Complex business processes** that have sub-processes
- **Clear logical separation** within the vertical

**Example**: `cooking/meal-planning/` exists because meal planning has 3 specialized agents and complex workflows, while general recipe search is simpler.

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

## GitHub Integration

### GitHub MCP Tools Usage
**CRITICAL: Always use GitHub MCP tools** for all GitHub repository operations:

#### Available Tools
- `mcp_github_github_list_releases` - List all releases in repository
- `mcp_github_github_get_release_by_tag` - Get specific release by tag name
- `mcp_github_github_get_latest_release` - Get the latest published release
- `mcp_github_github_list_tags` - List all tags in repository
- `mcp_github_github_list_branches` - List all branches
- `mcp_github_github_create_branch` - Create a new branch
- `mcp_github_github_create_or_update_file` - Create or update files
- `mcp_github_github_push_files` - Push multiple files in single commit

#### Common Use Cases

**Checking Docker Image Availability**:
```typescript
// ✅ CORRECT: Use MCP tools to verify release exists
const release = await mcp_github_github_get_release_by_tag({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  tag: 'home-assistant-addon-v0.2.2'
});

// ❌ INCORRECT: Don't use curl or manual API calls
exec('curl -H "Authorization: Bearer $GITHUB_TOKEN" ...');
```

**Listing Available Versions**:
```typescript
// ✅ CORRECT: List all releases to see what's published
const releases = await mcp_github_github_list_releases({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  perPage: 20
});

// Filter for specific project
const addonReleases = releases.filter(r => 
  r.tag_name.startsWith('home-assistant-addon-v')
);
```

**Creating Release Branches**:
```typescript
// ✅ CORRECT: Create branch for release work
await mcp_github_github_create_branch({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  branch: 'release/v0.3.0',
  from_branch: 'main'
});
```

#### Why Use MCP Tools?
- **Type Safety**: Full TypeScript types for requests and responses
- **Error Handling**: Consistent error handling across all operations
- **Authentication**: Automatic token management
- **Rate Limiting**: Built-in rate limit handling
- **Documentation**: Self-documenting with schemas

#### GitHub Container Registry (GHCR)
When working with Docker images:
1. **Always verify release exists** before updating `config.json` image references
2. **Check deployment logs** in GitHub Actions to confirm images were pushed
3. **Use semantic versioning** for addon releases (e.g., `home-assistant-addon-v0.2.2`)
4. **Multi-arch images required** for Home Assistant compatibility

## Development Guidelines

### Core Development Principles

#### 🎯 **YAGNI (You Aren't Gonna Need It)**
This project strictly follows the YAGNI principle - avoid adding functionality or configuration options until they are actually needed:

- **Factory Methods**: Should be opinionated and provide sensible defaults rather than extensive customization options
- **Configuration**: Only expose parameters that are necessary for core functionality
- **Features**: Don't implement speculative features or "what if" scenarios
- **Abstraction**: Keep abstractions minimal and add complexity only when required
- **Dependencies**: Don't add libraries or tools until they solve an actual problem

**Example**: Our workflow factory methods (`createAgentStep`, `createToolStep`) only accept essential parameters and use opinionated defaults for scorers, rather than exposing all possible configuration options.

#### 🔁 **DRY (Don't Repeat Yourself)**
Avoid duplication of configuration and constants:

- **Centralized Configuration**: All ports and URLs are defined in centralized configuration files
  - Bash scripts: `mcp/lib/ports.sh`
  - TypeScript tests: `home-assistant-addon/tests/e2e/helpers/ports.ts`
- **Single Source of Truth**: Never hardcode the same value in multiple files
- **Helper Functions**: Create reusable helper functions instead of duplicating logic
- **Configuration Sharing**: Import configurations rather than duplicating them

**Example**: Port configuration is centralized in `ports.sh` and `ports.ts`, then imported by all scripts and tests rather than hardcoded.

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

### File Creation Policy
**CRITICAL**: When working on this project:

#### ❌ ABSOLUTELY PROHIBITED FILES:
- **NEVER create ANY .md files** - Not README.md, not GUIDE.md, not TESTING.md, not anything
- **NO markdown files of any kind** (README, GUIDE, DOCS, SHOPPING_README, TESTING, IMPLEMENTATION_SUMMARY, etc.)
- **NO documentation artifacts** (ANALYSIS.md, COMPARISON.md, ARCHITECTURE.md, etc.)
- **NO explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md, etc.)
- **NO example or demo scripts** unless explicitly requested
- **NO test files or testing artifacts** outside the standard test directory structure
- **NO configuration files** not directly required for functionality

#### ✅ ALLOWED FILE CREATION:
- **Core functionality files**: agents, tools, workflows in their respective directories
- **Package configuration**: Only when required for new dependencies
- **Test scripts**: Only .js/.ts files in appropriate test directories when needed

#### 📝 DOCUMENTATION UPDATES:
- **UPDATE this AGENTS.md file** instead of creating new documentation
- **Add inline comments** in code for complex logic explanations
- **Update existing configuration files** when adding new features
- **Use the Mastra playground** for testing and examples instead of creating files

#### 🎯 REASONING:
This project follows a strict "lean documentation" approach because:
- **AGENTS.md is the single source of truth** for all project documentation
- **NO OTHER .md FILES ARE PERMITTED** - everything goes in AGENTS.md
- **Scattered documentation** creates maintenance overhead and confusion
- **The Mastra playground** provides interactive testing without file creation
- **Inline comments** are more maintainable than separate documentation files
- **Multiple README files** violate the monorepo structure and NX conventions

**If you feel documentation is needed, ALWAYS update this AGENTS.md file instead of creating new files. DO NOT CREATE ANY .md FILES UNDER ANY CIRCUMSTANCES.**

### Build and Development Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve mcp` instead of running dev directly
- ✅ Use `nx build mcp` instead of running build directly
- ✅ Use `nx test mcp` instead of running test directly
- ✅ Use `nx lint mcp` instead of running lint directly
- ✅ Use `bun install` for package installations at the workspace level
- ❌ **NEVER use npm commands** in this Bun-powered monorepo
- ❌ **NEVER run commands directly** - always use NX for project commands

**Why NX is Required:**
- NX provides intelligent caching and dependency management
- Ensures consistent builds across the monorepo
- Manages project dependencies and task orchestration
- Prevents conflicts between different project configurations

**Testing NX Targets:**
After modifying NX target configurations (project.json), always test through NX:
```bash
# Test with cache disabled to verify dependencies work
bunx nx build mcp --skip-nx-cache
bunx nx build home-assistant-voice-firmware --skip-nx-cache

# Verify that dependent targets (e.g., initialize) run automatically
# Check output for "Running target [target] for project [name] and X tasks it depends on"
```

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

### Factory Pattern Usage
**CRITICAL**: All agents, tools, and workflows must be created using the Hey Jarvis factory functions:

#### 🏭 **Required Factory Functions**
- **Agents**: Use `createAgent()` from `../../utils/agent-factory`
- **Tools**: Use `createTool()` from `../../utils/tool-factory`  
- **Workflows**: Use `createWorkflow()` and `createStep()` from `../../utils/workflow-factory`
- **Agent-as-Step**: Use `createAgentStep()` from `../../utils/workflow-factory` to use agents directly as workflow steps
- **Tool-as-Step**: Use `createToolStep()` from `../../utils/workflow-factory` to use tools directly as workflow steps

#### ✅ **CORRECT Usage Examples**:

**Agent Creation:**
```typescript
import { createAgent } from '../../utils/agent-factory';
import { myTools } from './tools';

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

**Workflow Creation:**
```typescript
import { createWorkflow, createStep, createAgentStep, createToolStep } from '../../utils/workflow-factory';
import { z } from 'zod';

// Traditional custom step
const myStep = createStep({
  id: 'my-step',
  description: 'A workflow step',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
  execute: async () => ({ result: 'done' }),
});

// Agent-as-step: Use an existing agent directly as a workflow step
const agentStep = createAgentStep({
  id: 'weather-step',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ weather: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
});

// Tool-as-step: Use an existing tool directly as a workflow step
const toolStep = createToolStep({
  id: 'get-weather-step',
  description: 'Get current weather using tool',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});

export const myWorkflow = createWorkflow({
  id: 'my-workflow',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
}).then(myStep);
```

#### ❌ **INCORRECT Direct Usage**:
```typescript
// ❌ NEVER do this - bypasses Hey Jarvis defaults and standards
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWorkflow } from '@mastra/core/workflows';

export const badAgent = new Agent({ ... }); // ❌
export const badTool = createTool({ ... });  // ❌
export const badWorkflow = createWorkflow({ ... }); // ❌
```

#### 🎯 **Factory Pattern Benefits**:
- **Consistent Defaults**: All agents automatically get `gemini-flash-latest` model and shared memory
- **Explicit API Configuration**: Google provider is explicitly configured with `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY`
- **Future-Proof**: Easy to add logging, error handling, or observability across all entities
- **Type Safety**: Better TypeScript support with optional parameters for common defaults
- **Maintainability**: Single point of configuration for system-wide changes
- **Standards Enforcement**: Ensures all components follow Hey Jarvis conventions
- **YAGNI Compliance**: Factory methods are opinionated and only expose necessary customization options

#### 📦 **Import Paths**:
Always use relative imports from your vertical to the utils:
- From `verticals/[vertical]/`: `../../utils/agent-factory`
- From `verticals/[vertical]/[sub-vertical]/`: `../../../utils/agent-factory`

**When creating new entities, ALWAYS use the Hey Jarvis factory functions instead of direct Mastra constructors.**

### Scorers and Evaluation

**AUTOMATIC**: All agents and workflow steps automatically include comprehensive evaluation scorers through the new **AI Tracing** system:

#### 🎯 **Included Scorers**:
- **answer-relevancy**: Evaluates how well responses address the input query (0-1, higher is better)
- **hallucination**: Detects factual contradictions and unsupported claims (0-1, lower is better)
- **completeness**: Checks if responses include all necessary information (0-1, higher is better)
- **prompt-alignment**: Measures how well responses align with prompt intent (0-1, higher is better)
- **bias**: Detects potential biases in outputs (0-1, lower is better)

#### 🔧 **Available But Not Auto-Enabled**:
- **faithfulness**: Measures how accurately responses represent provided context (requires context to be provided)
- **tool-call-accuracy**: Evaluates whether the LLM selects correct tools (requires per-agent configuration with actual tool objects)

#### ⚙️ **Scorer Configuration**:
- **Default sampling rate**: 10% of responses are scored (balances monitoring with cost)
- **Evaluation model**: Uses `gemini-flash-latest` for cost-effectiveness
- **Asynchronous execution**: Scoring runs in background without blocking responses
- **Automatic storage**: Results stored in `mastra_scorers` table via AI Tracing

#### 📊 **AI Tracing and Observability**:
The project now uses **Mastra AI Tracing** instead of the deprecated telemetry system:
- **AI Tracing**: Enabled via `observability: { default: { enabled: true } }` in Mastra config
- **Structured Logging**: Uses PinoLogger for comprehensive log management
- **Trace Storage**: All traces and scorer results automatically stored in LibSQL database
- **DefaultExporter**: Persists traces locally for viewing in Studio
- **CloudExporter**: Optionally sends traces to Mastra Cloud (requires `MASTRA_CLOUD_ACCESS_TOKEN`)

#### 🔧 **Customizing Scorers**:
```typescript
// Override sampling rate for production (lower cost)
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: createScorersConfig({}, 0.05), // 5% sampling
});

// Add custom scorers
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: createScorersConfig({
    customScorer: {
      scorer: myCustomScorer(),
      sampling: { type: 'ratio', rate: 1.0 },
    },
  }),
});

// Disable scorers (not recommended)
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: undefined,
});
```

#### 📊 **Monitoring and Analysis**:
- View scoring results in the Mastra playground at `http://localhost:4111/agents`
- Access AI traces and detailed metrics through Studio's Observability section
- Query the `mastra_scorers` table directly for custom analysis
- Use scoring data to identify improvement opportunities and track performance trends

**All scorers are automatically enabled by default to ensure comprehensive quality monitoring across the Hey Jarvis system.**

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
- **Apply YAGNI principle**: Only add features and configuration options when actually needed

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
- `weather`, `shopping`, `cooking`
- `build`, `ci`, `deps`

#### Best Practices
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter of subject
- No period at end of subject
- Use body to explain "what" and "why" vs. "how"
- Reference issues in footer: `Closes #123`

For more information about Mastra development, visit the [official documentation](https://mastra.ai/docs).