# ElevenLabs Tests

This directory contains all test files for the ElevenLabs integration project.

## Directory Structure

```
tests/
├── specs/          # Test specification files (*.spec.ts, *.test.ts)
│   ├── agent-prompt.spec.ts
│   ├── routing-orchestration.spec.ts
│   ├── acknowledgement-timing.spec.ts
│   ├── routing-loop.spec.ts
│   ├── spoken-tool-call.spec.ts
│   └── retry-with-backoff.spec.ts
└── utils/          # Test utility functions and helpers
    ├── test-conversation.ts
    ├── conversation-strategy.ts
    ├── elevenlabs-conversation-strategy.ts
    ├── gemini-mastra-conversation-strategy.ts
    ├── acknowledgement-timing.ts
    ├── mcp-connection.ts
    ├── mcp-integration.ts
    ├── routing-loop.ts
    ├── spoken-tool-call.ts
    ├── test-environment.ts
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
- `mcp-connection.ts` - Whether the agent actually reached its MCP server, so an
  eval never scores a conversation that had no tools to call
- `mcp-integration.ts` - Reports how ElevenLabs is configured to reach the MCP server
- `routing-loop.ts` - Reads the route/poll orchestration loop off the connection:
  what each call delivered, what was still running, and anything the loop's own
  reports contradict
- `spoken-tool-call.ts` - Detects an agent reciting a tool call instead of making one
- `test-environment.ts` - Brings the MCP server and tunnel up and down around a
  spec file. Both halves live here because both spec files share the same ports,
  so the teardown of one has to finish before the setup of the next begins
- `acknowledgement-timing.ts` - Whether the user heard anything before the results,
  and whether he was told twice that he is being attended to
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

## How the conversation evals decide

Every end-to-end eval ends the same way: it waits for the conversation to settle,
then calls `assertCriteria(criteria, minimumScore)`. An LLM reads the conversation
and returns a score, and the test passes or fails on that score.

The model is not asked to infer what happened from the prose. Alongside the
transcript it receives an evidence block extracted mechanically from the socket:

- every tool call the agent made, in order, with its state
- how many times the agent spoke after the user's last request
- whether the user heard anything before the results arrived
- any tool name spoken aloud, and any lookup announced before routing
- the full message order

Regexes and message ordering are far better than a language model at "was this tool
called" and "was this name said out loud". So the detectors do the seeing, the
evidence is marked authoritative in the prompt, and the model is left to judge the
thing it is actually good at — whether what happened satisfies the criteria.

The one exception is a disconnected MCP server, which fails hard rather than being
scored. That is a broken precondition, not a result worth judging.

## Test Requirements

Tests require the following environment variables (managed via 1Password):
- `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` - Test agent ID
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API key for evaluations

Tests start the MCP server and Cloudflare tunnel, and only then deploy the test
agent. ElevenLabs reads the agent's MCP tool list when the agent is updated, so
deploying before the tunnel is up leaves the agent with no tools to call.

`spoken-tool-call.spec.ts`, `acknowledgement-timing.spec.ts`, `routing-loop.spec.ts`
and `retry-with-backoff.spec.ts` need none of this — they are pure logic and run
offline, so they still give useful signal when the credentials or the tunnel are
unavailable.

## The orchestration eval

`routing-orchestration.spec.ts` is the one eval that watches a whole request run
rather than a single turn. It sends the multi-part request that
`mcp/mastra/verticals/routing/workflows.ts` carries as its default — weather at
the current location, today's calendar, traffic for the time the work calendar
implies, a lasagna recipe, and a to-do reminder holding that recipe's ingredients
— and then follows the loop: `routePromptWorkflow` once, then
`getNextInstructionsWorkflow` until the DAG reports itself finished.

The conversation is run once and judged from several angles, because running it
costs minutes of real agent work and the angles are all questions about the same
run. The loop's shape is asserted mechanically from the tool results
(`routing-loop.ts`); what came back is scored by the evaluator.

Unlike the evals in `agent-prompt.spec.ts`, this one is **not read-only**: the
request ends in a to-do item, so a run leaves a task behind in Google Tasks. That
is inherent to the request being tested, but worth knowing before pointing it at
an account you care about.
