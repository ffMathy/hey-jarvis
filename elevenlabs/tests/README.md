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
│   ├── conversation-config-body.spec.ts          # offline
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
- `elevenlabs-conversation-strategy.ts` - ElevenLabs WebSocket strategy. Besides messages, it
  can send a contextual update, background that starts no turn, as the phone does
- `gemini-mastra-conversation-strategy.ts` - Gemini/Mastra evaluation strategy
- `mcp-connection.ts` - Whether the agent actually reached its MCP server, so an
  eval never scores a conversation that had no tools to call
- `mcp-integration.ts` - Reports how ElevenLabs is configured to reach the MCP server
- `routing-loop.ts` - Reads the route/poll orchestration loop off the connection:
  what each call delivered, what was still running, and anything the loop's own
  reports contradict
- `spoken-tool-call.ts` - Detects an agent reciting a tool call instead of making one
- `test-environment.ts` - Brings the MCP server and tunnel up and down around a
  spec file. Both halves live here because every live spec file (agent-prompt,
  camera, routing-orchestration) shares the same ports, so the teardown of one has
  to finish before the setup of the next begins. Also
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

`agent-config.spec.ts` guards the committed config rather than a detector. The deploy
runs only after a merge to `main`, and the apps' own specs are cached by turbo until their
package changes, so a change to `agent-config.json` alone is never run past them. The spec
holds it to what the devices assume: every client event is one ElevenLabs sends,
`mcp_tool_call` — which the apps' thinking phase follows — is among them, and the agent
declares no client tool and asks for no `client_tool_call`, since no device answers one. The
agent knows nothing about sir's headset: what a request reads or changes, and what sir is
pointing at, travel between the MCP server and the devices over `/api/live`, never through the
agent. The spec also checks that the test agent always emits `mcp_tool_call`, which the evals
read. And it holds the one exception to
hanging up after a finished request — a photo sir said he would send, or has opened the camera
for, on a device that has said it has a camera button, until the photo, a message that it did not
arrive, a note that he closed the camera without one, or his word that it is not coming settles
it — to being stated in the same phrases wherever that rule is: in the prompt's **When Sir Is
Silent**, and in both copies of the `skip_turn` and `end_call` descriptions, which must match each
other. Routing's copy is held to the same phrases by `workflows.spec.ts` in `mcp/`. It also holds
the prompt to sending sir to his phone, without waiting, where there is no camera button, and to
ending the wait on a camera closed without a photo.

## The camera eval

`camera.integration.spec.ts` stands in for the phone, sending the contextual updates and the message
the phone sends, word for word. Sir sends a photo with the phone's camera button, never through the
agent, so what is tested is what Jarvis routes around the phone's "I've sent you a photo (photo
photo1)." in both orders sir can go about it. Told first — "I'll send you a receipt. What's the
total?" — the agent must route nothing until the photo's message is in, then route the question
naming "(photo photo1)". Sent first, with nothing said, the message alone must be routed at once by
that name. A camera opened straight after a finished request must be waited on: the request is
answered in full, the camera's note follows at once, and several three-second turn timeouts later
the agent must have answered them with `skip_turn` and never called `end_call`, and must still route
the photo when its message comes. The same request with no camera opened after it is the control:
it must be hung up on within ten seconds. Without it, a harness whose text-only conversation is
never asked to speak again would pass the camera case whether or not the exception exists. And
where no device has said it has a camera button, as on the watch, the Voice speaker or a phone call,
the announcement must not be routed at all, and the silence after sir is sent to his phone must be
hung up on.

What was routed, and when, is asserted off the socket, along with the photo's id never being said
aloud; the evaluator judges what Jarvis said — sending sir to the camera button, or to his phone, and
never speaking as though he could see a photo he cannot. No photo is really uploaded, so the routed
look finds none and the answer is never a real total, and the criteria allow for that.

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
