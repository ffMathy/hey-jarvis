# ElevenLabs Tests

This directory contains all test files for the ElevenLabs integration project.

## Directory Structure

```
tests/
├── specs/          # Test specification files (*.spec.ts, *.test.ts)
│   ├── agent-prompt.spec.ts
│   └── retry-with-backoff.spec.ts
└── utils/          # Test utility functions and helpers
    ├── test-conversation.ts
    ├── mcp-server-manager.ts
    ├── test-mcp-server.ts
    ├── retry-with-backoff.ts
    ├── conversation-strategy.ts
    ├── elevenlabs-conversation-strategy.ts
    └── gemini-mastra-conversation-strategy.ts
```

## Test Utilities

Test utility functions are located in `tests/utils/`:
- `test-conversation.ts` - Conversation testing framework
- `mcp-server-manager.ts` - MCP server lifecycle management
- `test-mcp-server.ts` - Checks the test agent's MCP server is reachable
- `retry-with-backoff.ts` - Retry logic with exponential backoff
- `conversation-strategy.ts` - Base conversation strategy interface
- `elevenlabs-conversation-strategy.ts` - ElevenLabs WebSocket strategy
- `gemini-mastra-conversation-strategy.ts` - Gemini/Mastra evaluation strategy

## Running Tests

```bash
# Run all tests
bunx turbo test --filter=elevenlabs

# Run tests with verbose output
bunx turbo test --filter=elevenlabs --verbose
```

## Test Requirements

Tests require the following environment variables (managed via 1Password):
- `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` - Test agent ID
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API key for evaluations

The agent under test is hosted by ElevenLabs and connects to its MCP server
itself, so these tests start nothing. That server has to be running and
reachable on its public hostname before the suite does, or the agent has no
tools to call — see `mcp/docker-compose.test-tunnel.yml`.
