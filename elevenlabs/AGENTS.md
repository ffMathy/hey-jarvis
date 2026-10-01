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

CI runs the offline half on every push. The live half never runs on GitHub
Actions — only when someone runs `turbo test:integration` by hand — so an eval
never spends quota unless someone asked it to.

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
- **Conciseness**: Brief, witty acknowledgements (5-15 words, max 20) — and for a routed
  request, whatever length the `instructions` field asks for, which outranks the prompt's own
  rules: a few words for a command, a sentence for a lookup, detail for a briefing, full
  character for conversation (the planner labels each request; see `mcp/AGENTS.md`)
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
- **When sir is silent**: see **Hanging up when he goes quiet** below
- **Photos sir sends from his phone**: see **Showing Jarvis something** below

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

## The voice model

`conversationConfig.tts.modelId` is `eleven_v4_turbo`, Eleven v4 Turbo: the low-latency variant of
Eleven v4 that ElevenAgents recommends for live conversation. It keeps the audio tags
(`suggestedAudioTags`) the prompt relies on, as `eleven_v3_conversational` did before it.

The SDK lags the API here. `@elevenlabs/elevenlabs-js` validates the request against enums frozen at
its release, and no published version lists `eleven_v4_turbo` yet, so a plain `agents.update` throws
`Expected enum` before sending anything. `deployConfig` therefore serializes `conversationConfig`
itself through `toConversationConfigBody`, which lets unknown enum values through, and sends it as an
additional body parameter. Once the SDK knows the model the workaround is harmless; keep it anyway,
because the next model will outrun the SDK the same way.

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
`"none"`, because a transcript said to. OpenAI's chat-completions endpoint
rejects a tools-bearing request for this model family unless `reasoning_effort`
is `none` — omitting the field is refused too — and this agent is never without
tools: `end_call`, `skip_turn`, `transfer_to_agent`, and the MCP server behind
`routePromptWorkflow`. With the field left `null`, the integration specs showed
exactly that: every turn that needed a tool ended the conversation straight
after sir spoke, with no tool call and no reply, while turns that needed none
("It is 01:07, sir") went through. The ended conversations then left ElevenLabs
reporting the MCP integration as connected with zero tools for every
conversation after them. Moving `llm` to another provider is the moment to
revisit this: the constraint is OpenAI's, and `LlmReasoningEffort` in the SDK
admits `none` through `max`.

And the question to ask of any candidate is not how it reads, not what it scores,
but whether it hangs up when it says it is hanging up. `turbo test:integration
--filter=elevenlabs` is what asks it, because those specs hold live conversations
with the deployed agent; a model swap that has not been through them is a guess —
this one included, until they run.

## Hanging up when he goes quiet

A finished request should not leave the line open until the 30-second `silenceEndCallTimeout`
gives up on it. So the agent has **`turnTimeout: 3`**: after three seconds of silence, ElevenLabs asks
Jarvis to speak again. The prompt's **When Sir Is Silent** section and the `end_call`/`skip_turn`
descriptions tell him what that means — after a finished request, `end_call` without a word; while
the conversation waits on sir, `skip_turn`. Every finished request — answered, failed, or handed off
to a notification — also ends with the routing loop's `FINISHED_REQUEST_INSTRUCTIONS`, which says
the same and forbids ending on a question or an offer, since the line closes while he is still
answering it. A request still waiting on him never carries it. The prompt, both descriptions and
routing's instructions all make the same one exception: a photo Jarvis is waiting for, whose silence
gets `skip_turn` even straight after a finished request (see **Showing Jarvis something** below).

That setting is agent-wide, so it is the one mechanism on every medium: the apps, the Voice speaker
and a telephone call alike. `initialWaitTime: 30` keeps it from firing at the start of a session
whose first message is empty (the apps play a recorded greeting instead). If the model ever fills
those silences with "are you still there?", `turnTimeout: -1` switches it off again — and with it
every hang-up after a finished request, so that is a trade, not a fix.

There used to be a second mechanism, the `hangUpWhenQuiet` client tool, that armed a three-second
clock on the device itself. It was removed: the agent asked for it, the phone, watch and firmware
each kept their own copy of the clock, and `turnTimeout` already did the same job everywhere.

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

## Showing Jarvis something

**Sir sends the photo, and the agent takes no part in taking it.** The camera is a button on the
phone, beside Jarvis, and the agent has no tool for it. The tap opens the camera and, in the same
gesture, has the phone ask the MCP server for an upload slot, naming the conversation it is holding;
the server checks with ElevenLabs that the conversation is live on Jarvis's agent before it opens one,
and the phone then uploads the photo to it. The phone and the server settle between them where the
photo goes, so nothing the model reads — an email it summarised, the text on an earlier photo — can
send it anywhere else: no address ever passes through the conversation. The phone's half is
"Showing him something" in `mobile/AGENTS.md`, and the server's is the Vision vertical in
`mcp/AGENTS.md`.

**What the agent hears of it is the phone's, sentence for sentence** (`mobile/src/photo-messages.ts`).
Three are contextual updates, which start no turn: once connected, that this device is sir's phone
with a camera button beside Jarvis, sent only when the phone knows a Jarvis server to send photos to;
at the tap, that sir has opened the camera; and, should he back out, that he closed it without a
photo. The other two are user messages in sir's name, because each is meant to start the agent's
turn: "I've sent you a photo (photo photo3)." once the photo is filed, and "The photo I took didn't
reach you: …" with a short reason when it was not. The first update is the one gate. The watch, the
Voice speaker, a telephone call and a phone with no server set all share this agent and never send
it, so the prompt has Jarvis tell sir to send the photo from his phone there, rather than point him at
a button that is not in front of him.

**Sir can go about it in either order.** Told first — "I'll send you a receipt, what's the
total?" — Jarvis routes nothing: there is nothing to look at yet, and a look routed now would read
whichever photo came last, possibly one from another conversation. He tells sir to go ahead with the
camera button and waits; when the photo's message arrives, the question goes to `routePromptWorkflow`
with "(photo photo3)" in it. Anything else asked in the same breath — "…and what's the weather?" — is
routed at once, on its own, and answering it does not end the wait: what sir wants done with the photo
goes with the photo. Should the agent route the announcement anyway, routing recognises it
(`awaitsPhoto` in `planner.ts`) and has Jarvis invite the photo and wait, rather than report a request
nothing could handle. Sent first, with nothing said, the message alone is routed as "He sent a
photo without saying what he wants: look at it and say what it shows (photo photo3)". The planner
puts that photo in `photosToAskAbout`, so routing's closing report has Jarvis say what it shows, then
ask what sir would like done with it and wait for the answer rather than hang up. That question comes
from routing's `instructions` and not from the prompt, because those outrank the prompt and would
otherwise forbid ending on a question (`mcp/AGENTS.md`, "Routing"). Every later request about the
photo names it by its id the same way, which is how the planner knows to send it to the `vision`
agent. The prompt states each of these rules once, in its **Photos** section, and a photo's id joins
the tool names and argument lists sir must never hear.

**A photo on its way is sir busy, not sir gone.** Nothing holds the agent's turn while he frames a
shot, so the three-second turn timeout asks Jarvis to speak again, and after a finished request the
answer to that is to hang up. So Jarvis waits instead — `skip_turn`, never `end_call` — while he is
waiting for a photo from sir on a device that has told him it has a camera button: sir said he would
send one, or a note says he has opened the camera on his phone, and since then nothing has settled
it. The photo settles it, and so do the phone's message that it did not reach him, its note that sir
closed the camera without one, and sir saying it is not coming. Nothing else he says does: his
answer to a question asked beside the photo, or anything else he asks for before it comes, is routed
as a request of its own, and once ended the wait — so that request's silence hung up on him on his
way to the camera. That holds even straight after a finished request, when the silence would
otherwise mean he has what he came for. A wait nothing settles is still bounded by the 30-second
`silenceEndCallTimeout`.

It starts only where the phone's camera-button note came. On the watch, the Voice speaker or a
telephone call, Jarvis sends sir to his phone and hangs up on the silence after: the photo goes to the
phone's own conversation, and with `agentConcurrencyLimit: 1` a line held open for it here would keep
that conversation from starting.

The exception is written into every place that states the rule it breaks, in the same words: the
prompt's **When Sir Is Silent**, both copies of the `skip_turn` and `end_call` descriptions in
`agent-config.json` (under `builtInTools`, which the test agent keeps, and under `tools`), and
routing's `FINISHED_REQUEST_INSTRUCTIONS` and `WAIT_FOR_THE_PHOTO`, which share one condition,
`WAITING_FOR_A_PHOTO`. It was once in the prompt alone, where the three that said to hang up outweighed
it: routing's above all, since it arrives last and the prompt says to follow it literally. An
exception stated in fewer places than the rule it breaks is outweighed the same way.

The phone also sends `user_activity` once in the tap, beside the note that the camera is open, and then
every five seconds while the camera is open or the photo is on its way. The first may land before the
three-second turn timeout; the rest are too seldom to hold one off, and ElevenLabs does not document them
as holding off the 30-second `silenceEndCallTimeout`; the phone's timers stop while the app is behind
the camera besides. So a long enough shot can still end the call — and the slot, opened at the tap,
outlives it.

**A photo whose message never reached the agent is not lost.** The phone sends that message only into
the conversation that opened the slot. If that conversation ended first, the photo stays with Mastra
as one nobody has looked at, and routing brings it up in the closing report of the next request it
answers, in whichever conversation that is, the way it brings up earlier work still waiting on sir
(`mcp/AGENTS.md`, "Vision" and "Routing"). None of this is in the prompt: it arrives in
`instructions`, beside the rest of routing's run-time mechanics, when it applies.

**The agent has no client tools, and asks ElevenLabs to send none.** `clientEvents` keeps
`mcp_tool_call` for the apps' thinking phase (`hologram/src/tool-activity.ts`), and because the
integration specs read tool calls off the socket, `applyTestAgentOverrides` adds it to the test agent
should the config ever drop it. The Voice speaker logs only an MCP result's tool name and state, since
a result can hold an email summary.

**What checks it.** `tests/specs/agent-config.spec.ts`, on every push: every client event is one
ElevenLabs sends, `mcp_tool_call` is among them, and the agent declares no client tool and asks for
no `client_tool_call`, since no device answers one; and the waiting-for-a-photo exception is in the prompt's **When Sir Is Silent**
and in the `skip_turn` and `end_call` descriptions, in the same phrases, whose two copies each must
match — with the prompt sending sir to his phone, and not waiting, where there is no camera button, and
ending the wait on a camera closed without a photo. `tests/specs/camera.integration.spec.ts` holds five
live conversations with a stood-in phone. Told first, the question is routed nowhere until the photo's
message is in, and then routed naming "(photo photo1)"; sent first, the photo is routed by that name
at once; a camera opened straight after a finished request is waited on — `skip_turn` answers the turn
timeouts since the camera's note, with no `end_call` — and the photo that follows is routed; the same
request with no camera opened after it is hung up on within ten seconds, the control without which the
wait would prove nothing, since it shows the harness is asked to speak again at all; and where no
device has said it has a camera button, the announcement is not routed, and the silence after it is
hung up on. No photo is really
uploaded, so the routed look finds nothing, and the evaluator is told to expect that. The routing evals
in `mcp/mastra/verticals/routing/workflows.llm-eval.integration.spec.ts` check the planner's half:
"(photo photo3)" goes to `vision` with the id in its prompt, and "add what is on this receipt to my
shopping list" reads the photo before `shoppingList` in the same chain. Both need credentials and run
only under `turbo test:integration`.

**None of this reaches the live agent until a release deploys it.** `bunx turbo deploy` runs in the
release workflow, and only when a releasable commit type (`feat`, `fix`, `perf`, `refactor`, `docs`)
cuts a release. Until then the phone's camera button sends photos to an agent whose prompt has never
heard of them.

## The headset

The agent knows nothing about sir's headset, and the headset tells it nothing about itself: no device
context, no pointing updates, no client tool. Both of the headset's extras travel between the MCP
server and the devices over its `/api/live` WebSocket instead (see `mcp/AGENTS.md`):

- **What a request reads or changes** is pushed by the server straight to the devices, as a list of
  `{ id, name? }` entities, and the headset lights it up where sir placed it in the room. The routing
  loop's reports carry nothing about it, and the voice agent never sees it.
- **What sir is pointing at** goes from the headset to the server, which adds
  `(pointing at "<name>", id <id>)` to the request it routes. "Is that on?" reaches the planner
  already naming the entity, so the prompt has no rule about what "that" means.

The agent once took part in both, through a client tool it called with the entities and through
contextual updates naming what sir pointed at. Both are gone, and `tests/specs/agent-config.spec.ts`
fails if a client tool, or `client_tool_call` in `clientEvents`, comes back.

## Contributing
- **Update agent-prompt.md** for behavior changes
- **Add tests** with 0.9+ score requirements for new features
- **Test locally** before deploying to ElevenLabs
- **Use `bunx turbo deploy --filter=elevenlabs`** to push prompt changes

## Scope Guidelines for Commits
Use elevenlabs-specific scopes:
- `elevenlabs`, `voice`, `agent`
- `tests`, `prompt`, `config`
