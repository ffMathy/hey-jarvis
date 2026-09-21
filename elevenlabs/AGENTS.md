# ElevenLabs Integration

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview
TypeScript-based integration connecting ElevenLabs voice AI agents with the Hey Jarvis ecosystem.

## Key Features
- **ElevenLabs Agent Integration**: WebSocket-based real-time conversation
- **Personality-Driven Prompts**: J.A.R.V.I.S.-inspired witty, loyal AI assistant
- **LLM-Based Testing**: Automated evaluation using Gemini models
- **Agent Configuration Deployment**: Programmatic updating of ElevenLabs configs

## File Structure
```
elevenlabs/
├── src/
│   ├── main.ts                      # Main entry point for CLI operations
│   └── assets/
│       ├── agent-config.json        # ElevenLabs agent configuration
│       └── agent-prompt.md          # Agent personality and behavior prompt
├── tests/
│   ├── specs/                       # Agent behavior specification tests
│   ├── utils/                       # Conversation framework, tunnel, MCP helpers
│   └── README.md                    # How the tests are wired together
├── AGENTS.md                        # This file
├── package.json                     # Project scripts, run through Turborepo
└── op.env                           # 1Password environment variable references
```

## TURBO Commands
```bash
bunx turbo test --filter=elevenlabs     # Run the offline tests
bunx turbo test:integration --filter=elevenlabs  # Run the live conversation evals
bunx turbo build --filter=elevenlabs    # Build the project
bunx turbo deploy --filter=elevenlabs   # Update ElevenLabs agent configuration
bun run --cwd elevenlabs refresh  # Fetch current agent configuration
bunx turbo lint --filter=elevenlabs     # Lint the project
```

## Environment Variables
Required (via 1Password):
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API for test evaluations

## Testing Guidelines

### Where a test belongs

A spec that connects to ElevenLabs, brings up the tunnel or scores a real
conversation is named `*.integration.spec.ts` and runs under
`turbo test:integration`, which is the only target that resolves the credentials
above. A spec that only exercises the detectors keeps the plain `*.spec.ts`
suffix and runs under `turbo test`, which carries no secrets at all.

CI runs the offline half on every push and the live half only once the pull
request is out of draft — so an eval never spends quota on work in progress.

### Test Score Requirements
All tests must use strict score requirements (>0.9 for 90%+ confidence):

```typescript
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);
```

### Mastra V1 Tool Message Format
When sending tool results to agents:
```typescript
const message = {
    createdAt: new Date(),
    id: 'unique-id',
    content: 'tool result content',  // REQUIRED
    role: 'tool',
    type: 'tool-result',  // REQUIRED
};
```

### Example Test Structure
```typescript
runTest(
  'should address the user as "sir"',
  async () => {
    await conversation.connect();
    await conversation.sendMessage('Hello, how are you?');
    const result = await conversation.evaluate(
      'The agent addresses the user as "sir" at least once'
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
  },
  90000
);
```

## Agent Prompt Requirements

The agent prompt in `src/assets/agent-prompt.md` defines:
- **Personality**: J.A.R.V.I.S.-inspired wit, dry humor
- **Addressing**: Always call the user "sir"
- **No Follow-ups**: Make assumptions rather than asking clarifying questions
- **Conciseness**: Brief, witty acknowledgements (5-15 words, max 20)
- **When to reach for a tool**: answer outright or route, and never both
- **Analysis Mode**: any phrase *beginning* with "analysis" drops the persona for
  a flat, robot-like step-by-step readout. Whatever follows the word is the focus,
  and it decides where the readout comes from: a focus on this call is answered
  from the conversation and never routed, while a focus the conversation cannot
  answer — why something failed elsewhere, whether the scheduled checks are still
  running — goes through `routePromptWorkflow` to the `reflection` agent, which
  reads Mastra's own errors and failed runs (see `mcp/AGENTS.md`)
- **Ending the call**: a closing line in character, then the `end_call` tool — a
  written "[end_call invoked]" is a stage direction, not a call, and leaves the
  line open

Keep it short. The prompt is carried on every turn, so anything the agent does
not need in order to decide its *next* utterance does not belong in it — that is
a latency and cost argument, and it holds no matter how capable the model is.

## What a client is allowed to override

`platformSettings.overrides.conversationConfigOverride` in `src/assets/agent-config.json` is an
allow-list, and a client that sends an override the agent does not permit does not get it ignored
— **the server closes the conversation**. That failure is close to silent from the app's side: the
session connects, the socket shuts, and the SDK reports it through `onDisconnect` rather than
`onError`, so nothing surfaces unless the app is listening for it (`mobile/` now is).

`conversation.textOnly` is on that list because the phone app needs it. A browser with the
microphone refused holds the conversation as text on both sides, which is done by sending exactly
that override — see "What a typed conversation asks for" in `mobile/AGENTS.md`. It is also the
least sensitive thing on the list: it changes whether Jarvis writes or speaks, not what he is or
what he can reach.

Anything changed here reaches the agent only through `bunx turbo deploy --filter=elevenlabs`, which
needs the 1Password credentials. Until that runs, the committed config and the live agent disagree,
and it is the live one the app talks to.

## The conversational model

`conversationConfig.agent.prompt.llm` in `src/assets/agent-config.json` names the
model that runs the conversation: it decides every line, and it is the thing that
either calls `end_call` and `routePromptWorkflow` or merely talks about calling
them.

It is `gpt-5.6-luna`, and the bar a value here has to clear is a transcript. On
`qwen35-397b-a17b` Jarvis was asked three times in a row to end the call, said
"ending the call now" each time, and never called `end_call` — the line stayed
open until sir gave up. The same conversation had it narrating the wait it had
just been told to keep quiet about, and answering a calendar lookup with wit
instead of a result. None of that is a prompt gap: every one of those rules is
already stated once, plainly, in `agent-prompt.md` or in the `instructions`
field. They were read and not followed, which is the one failure a longer prompt
cannot fix.

That transcript is why the field sat on `claude-sonnet-5` for as long as it did:
the hosted open-weight tier was cheap and did not obey, so the answer was a
frontier model and the per-turn cost that came with it. `gemini-3.8-flash` took
the field from it on price, and lost it on the fine print — that price was
introductory, and the rise already scheduled against it undoes the very gap that
justified leaving the frontier model at all. `gpt-5.6-luna` is cheaper again, and
cheaper after a cut rather than before a rise, which is the whole of why it holds
the field now.

Be honest about what the swap costs, because the published scores do not flatter
it: read on one consistent revision of the Artificial Analysis index, luna sits a
few points *below* `gemini-3.8-flash` rather than above it. The case here is
price and the durability of price, never capability. It survives only on what the
rest of this section already argues — that the hardest turn this agent takes is
picking the right tool and calling it, and that no index measures that.

Three things follow, and none of them is optional. The value must be one of the
ids in `Llm` from `@elevenlabs/elevenlabs-js/api` — ElevenLabs rejects anything
else, and that union is versioned with the SDK, so a model newer than the pinned
`@elevenlabs/elevenlabs-js` is not selectable until the pin moves.

`reasoningEffort` sits directly beneath `llm` in the same object, and it is
`null`. On an OpenAI id that is the first thing to suspect if Jarvis stops
calling tools at all: OpenAI's own chat-completions endpoint rejects a
tools-bearing request that omits `reasoning_effort`, and this agent is never
without tools — `end_call`, `skip_turn`, `transfer_to_agent`, and the MCP server
behind `routePromptWorkflow`. Whether ElevenLabs uses that endpoint, and whether
it forwards `null` as omitted or as `none`, is undocumented. `LlmReasoningEffort`
in the SDK admits `none` through `max` if it turns out to need setting, but do
not set it pre-emptively — a reasoning model pinned to `none` on every
tool-bearing turn is its own regression. Set it when a transcript says to.

And the question to ask of any candidate is not how it reads, not what it scores,
but whether it hangs up when it says it is hanging up. `turbo test:integration
--filter=elevenlabs` is what asks it, because those specs hold live conversations
with the deployed agent; a model swap that has not been through them is a guess —
this one included, until they run.

### What belongs in the routing instructions instead

Every response from `routePromptWorkflow` and `getNextInstructionsWorkflow`
carries an `instructions` field, and the prompt's only rule about the loop is
to follow that field literally. So the run-time mechanics — how long to keep
polling, what to say between reports, what to do with a failed call, that a
finished request does not finish the conversation — live in `INSTRUCTIONS` and
`ALL_TASKS_COMPLETED_INSTRUCTIONS` in
[`mcp/mastra/verticals/routing/workflows.ts`](../mcp/mastra/verticals/routing/workflows.ts),
where they arrive exactly when they apply.

State each such rule in one place only. Asking for the same line here *and*
there is how Jarvis once acknowledged the same request twice.

## Contributing
- **Update agent-prompt.md** for behavior changes
- **Add tests** with 0.9+ score requirements for new features
- **Test locally** before deploying to ElevenLabs
- **Use `bunx turbo deploy --filter=elevenlabs`** to push prompt changes

## Scope Guidelines for Commits
Use elevenlabs-specific scopes:
- `elevenlabs`, `voice`, `agent`
- `tests`, `prompt`, `config`
