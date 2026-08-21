# ElevenLabs Tests

This directory contains all test files for the ElevenLabs integration project.

## Directory Structure

```
tests/
├── specs/          # Test specification files (*.spec.ts, *.test.ts)
│   ├── agent-prompt.spec.ts
│   ├── spoken-tool-call.spec.ts
│   └── retry-with-backoff.spec.ts
└── utils/          # Test utility functions and helpers
    ├── test-conversation.ts
    ├── conversation-strategy.ts
    ├── elevenlabs-conversation-strategy.ts
    ├── gemini-mastra-conversation-strategy.ts
    ├── mcp-integration.ts
    ├── spoken-tool-call.ts
    ├── tunnel-manager.ts
    ├── cloudflare-access.ts
    └── process-manager.ts
```

The MCP server lifecycle (`mcp-server-manager.ts`) and the retry helper
(`retry-with-backoff.ts`) live in `mcp/tests/utils/` and are imported from there.

## Test Utilities

Test utility functions are located in `tests/utils/`:
- `test-conversation.ts` - Conversation testing framework
- `conversation-strategy.ts` - Base conversation strategy interface
- `elevenlabs-conversation-strategy.ts` - ElevenLabs WebSocket strategy
- `gemini-mastra-conversation-strategy.ts` - Gemini/Mastra evaluation strategy
- `mcp-integration.ts` - Reports how ElevenLabs is configured to reach the MCP server
- `spoken-tool-call.ts` - Detects an agent reciting a tool call instead of making one
- `tunnel-manager.ts` - Cloudflare tunnel management
- `cloudflare-access.ts` - Cloudflare Access service token handling
- `process-manager.ts` - Child process lifecycle for the tunnel

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

Tests start the MCP server and Cloudflare tunnel, and only then deploy the test
agent. ElevenLabs reads the agent's MCP tool list when the agent is updated, so
deploying before the tunnel is up leaves the agent with no tools to call.

`spoken-tool-call.spec.ts` and `retry-with-backoff.spec.ts` need none of this —
they are pure logic and run offline, so they still give useful signal when the
credentials or the tunnel are unavailable.
