# ElevenLabs Tests

This directory contains all test files for the ElevenLabs integration project.

## Directory Structure

```
tests/
├── specs/          # Test specification files
│   ├── agent-prompt.integration.spec.ts          # live — needs credentials + tunnel
│   ├── camera.integration.spec.ts                # live — needs credentials + tunnel
│   ├── routing-orchestration.integration.spec.ts # live — needs credentials + tunnel
│   ├── acknowledgement-timing.spec.ts            # offline
│   ├── agent-config.spec.ts                      # offline
│   ├── procedure-version-refs.spec.ts            # offline
│   ├── routing-loop.spec.ts                      # offline
│   ├── spoken-tool-call.spec.ts                  # offline
│   └── retry-with-backoff.spec.ts                # offline
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
- `conversation-strategy.ts` - Base conversation strategy interface, the message log's
  types, and the transcript the evaluator reads
- `elevenlabs-conversation-strategy.ts` - ElevenLabs WebSocket strategy. It can send a
  contextual update, and answer client tool calls the way a device would when a test passes
  `answerClientToolCall`; without one, client tool calls are recorded and left unanswered
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
  so the teardown of one has to finish before the setup of the next begins. Also
  `withConversationRetry`, which holds a fresh conversation for each attempt
- `acknowledgement-timing.ts` - Whether the user heard anything before the results,
  and whether he was told twice that he is being attended to
- `tunnel-manager.ts` - Cloudflare tunnel management
- `cloudflare-access.ts` - Cloudflare Access service token handling
- `process-manager.ts` - Child process lifecycle for the tunnel

## Running Tests

```bash
# The offline detector coverage — no credentials, no tunnel
bunx turbo test --filter=elevenlabs

# The live conversation evals — credentials, tunnel, real agent
bunx turbo test:integration --filter=elevenlabs

# Either one, with verbose output
bunx turbo test --filter=elevenlabs --verbose
```

The `*.integration.spec.ts` suffix is what decides which half a spec lands in.
CI runs the offline half on every push. The live half never runs on GitHub
Actions — only when someone runs `turbo test:integration` by hand — so a
conversation eval never spends quota unless someone asked it to.

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

`spoken-tool-call.spec.ts`, `acknowledgement-timing.spec.ts`, `routing-loop.spec.ts`,
`retry-with-backoff.spec.ts`, `procedure-version-refs.spec.ts` and
`agent-config.spec.ts` need none of this — they are pure logic and run offline, so
they still give useful signal when the credentials or the tunnel are unavailable.

`agent-config.spec.ts` is the one that guards the deploy rather than a detector. The
deploy runs only after a merge to `main`, and the SDK strips any key it does not
recognise without a word, so it runs the hand-written client tools in
`agent-config.json` through the SDK's own serialiser with unknown keys set to fail —
a snake_case key that would have vanished, or an enum value that would have failed the
release, fails here on the push instead.

## The camera eval

`camera.integration.spec.ts` stands in for the phone. Told by a contextual update that the device
has a camera — the sentence the phone sends — the agent has to take "What's the total on this
receipt?" through `preparePhotoUpload`, then `openCamera` (which the test answers with a photo id,
as the phone would), then `routePromptWorkflow` naming that id. Told nothing, the same request must
reach for neither tool, as on the watch, the Voice speaker or a phone call. The order and content
of the calls are asserted off the socket; the evaluator only judges whether Jarvis spoke as though
he could see a photo he cannot. No photo is really uploaded, so the routed answer is never a real
total.

## The orchestration eval

`routing-orchestration.integration.spec.ts` is the one eval that watches a whole request run
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

Unlike the evals in `agent-prompt.integration.spec.ts`, this one is **not read-only**: the
request ends in a to-do item, so a run leaves a task behind in Google Tasks. That
is inherent to the request being tested, but worth knowing before pointing it at
an account you care about.
