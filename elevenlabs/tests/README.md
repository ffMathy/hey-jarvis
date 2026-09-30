# ElevenLabs Tests

This directory contains all test files for the ElevenLabs integration project.

## Directory Structure

```
tests/
├── specs/          # Test specification files
│   ├── agent-prompt.integration.spec.ts          # live — needs credentials + tunnel
│   ├── headset.integration.spec.ts               # live — needs credentials + tunnel
│   ├── routing-orchestration.integration.spec.ts # live — needs credentials + tunnel
│   ├── acknowledgement-timing.spec.ts            # offline
│   ├── agent-config.spec.ts                      # offline
│   ├── conversation-config-body.spec.ts          # offline
│   ├── headset.spec.ts                           # offline
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
    ├── headset.ts
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
  contextual update, with a context id when a newer update should replace an older one, and
  answer client tool calls the way a device would when a test passes `answerClientToolCall`;
  without one, client tool calls are recorded and left unanswered
- `gemini-mastra-conversation-strategy.ts` - Gemini/Mastra evaluation strategy
- `headset.ts` - The sentences the headset sends, and what the headset eval reads off the
  connection: the `markAffected` calls, the entities the routing loop relayed, and each
  routed query
- `mcp-connection.ts` - Whether the agent actually reached its MCP server, so an
  eval never scores a conversation that had no tools to call
- `mcp-integration.ts` - Reports how ElevenLabs is configured to reach the MCP server
- `routing-loop.ts` - Reads the route/poll orchestration loop off the connection:
  what each call delivered, what was still running, and anything the loop's own
  reports contradict
- `spoken-tool-call.ts` - Detects an agent reciting a tool call instead of making one
- `test-environment.ts` - Brings the MCP server and tunnel up and down around a
  spec file. Both halves live here because the spec files share the same ports,
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

Every spec without the `.integration` suffix needs none of this — they are pure
logic and run offline, so they still give useful signal when the credentials or
the tunnel are unavailable.

`agent-config.spec.ts` is the one that guards the deploy rather than a detector. The
deploy runs only after a merge to `main`, strips any key the SDK does not recognise
without a word, and sends an enum value it does not recognise on to ElevenLabs as
written. So the spec runs the hand-written client tools in `agent-config.json` through
the SDK's own serialiser with unknown keys set to fail — a snake_case key that would
have vanished, or a misspelt enum value the deploy would have sent anyway, fails here
on the push instead. It also pins what the headset relies on of `markAffected`, and
that the test agent keeps it.

## The headset evals

`headset.integration.spec.ts` stands in for sir's headset. Told by the headset's device
context that it lights up what Jarvis works on, the agent has to answer "Are the kitchen
lights on?" and, along the way, call `markAffected` with exactly the entities the routing
loop relayed in `affectedEntities` — no id changed, none left out — without a word about
it, and still carry the loop to its closing report. Told nothing, the same request must
never call `markAffected`, as on the phone, the watch, the Voice speaker or a phone call,
and must still finish. And with two pointing updates sharing a context id, "Is that on?"
must be routed with the name and id of the second, never the first.

The calls are asserted off the socket; the evaluator only judges whether Jarvis talked
about the machinery. Every request is read-only, because the environment runs the real
MCP server against the real house. The first two evals fail up front, naming the MCP
half, when the routing loop relays no `affectedEntities` at all: without them the agent
had nothing to mark, and neither a mark nor its absence says anything about the agent.

`headset.spec.ts` keeps the detectors behind these evals honest offline, and checks that
the prompt still quotes the sentences the headset sends.

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
