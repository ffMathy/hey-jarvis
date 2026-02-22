# Jarvis MCP Server

The AI brain of the Jarvis ecosystem — a Mastra-powered MCP server with specialized agents for home automation, weather, shopping, cooking, and more.

## Quick Start

```bash
bunx nx serve mcp          # Start server + Mastra Studio playground
bunx nx serve:mcp mcp      # Start MCP server only (JWT-authenticated)
bunx nx test mcp            # Run tests
bunx nx e2e mcp             # Run E2E tests
```

Access the playground at `http://localhost:4111/agents` to test agents, debug tools, and monitor memory.

## Verticals

The project is organized by business domain. Each vertical contains its own agents, tools, and workflows:

| Vertical | Purpose |
|----------|---------|
| `api` | Token usage tracking |
| `calendar` | Google Calendar management |
| `coding` | GitHub repo/issue management, requirements gathering |
| `commute` | Travel planning and navigation (Google Maps) |
| `cooking` | Recipe search and meal planning (Valdemarsro) |
| `email` | Gmail search, draft, reply |
| `human-in-the-loop` | Form-based approval workflows |
| `internet-of-things` | Smart home device control (Home Assistant) |
| `notification` | Multi-channel alerts (voice, SMS, calls) |
| `phone` | Phone calls and texts (Twilio/ElevenLabs) |
| `routing` | DAG-based task routing and orchestration |
| `shopping` | Bilka grocery shopping (Danish) |
| `synapse` | IoT state change reactor |
| `todo-list` | Google Tasks management |
| `weather` | OpenWeatherMap forecasting |
| `web-research` | Google Search with citations |

## Key Patterns

- **Factory functions** for all agents, tools, and workflows (`createAgent`, `createTool`, `createWorkflow`)
- **Tool IDs** are always `kebab-case` (e.g., `get-current-weather`)
- **Persistent memory** via LibSQL with semantic vector recall
- **Multi-model**: Gemini Flash (primary), Ollama Qwen3 (local/scheduled tasks), GitHub Models (CI)
- **Storage**: Credentials, device state, email state, noise baselines, token usage — all in LibSQL

## Server Endpoints

| Endpoint | Port | Purpose |
|----------|------|---------|
| Mastra Studio (Hono) | 4111 | Agent playground, OpenAPI spec, health check |
| MCP Server (Express) | 4112 | JWT-authenticated MCP endpoint |

## Environment

Secrets managed via 1Password CLI. Key variables:

- Google API key (Gemini), OpenWeatherMap API key
- Bilka credentials, Algolia keys
- MCP JWT secret
- OAuth credentials for Google Calendar, Gmail, GitHub, Microsoft

See [AGENTS.md](./AGENTS.md) for development guidelines.
