---
paths:
  - "mcp/**"
---

# Routing

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

The entry point for every voice request. Two MCP tools, deliberately: the voice model gets a
small, fast surface, and everything else happens behind them. A photo sir sends reaches Jarvis the
same way, as a request naming it (see [Vision Vertical](mcp-vision-vertical.md#vision-vertical)); the phone opens its slot
over the REST API, not through the voice model.

Split into rules of their own:

- [Questions for the user](mcp-routing-questions-for-the-user.md)
- [Slow tasks](mcp-routing-slow-tasks.md)
- [What a request touches (affected entities)](mcp-routing-affected-entities.md)
- [Which agents are at work](mcp-routing-agent-activity.md)
- [What sir points at](mcp-routing-pointing.md)

**Workflows:**
- **`routePromptWorkflow`**: starts a request and returns its closing report if it finishes within
  a few seconds, or else the instruction to poll
- **`getNextInstructionsWorkflow`**: reports whatever has landed since the last call

**How a request runs:**
1. `routePromptWorkflow` starts the request and waits up to `ROUTE_ANSWER_WAIT_MS` (5s) for it to
   finish. A request that does — a light switched by Jev and one Home Assistant call, with no
   language model on this side — is answered with its closing report right there, so the voice
   model speaks the result on its next turn instead of spending that turn on a poll. Otherwise it
   returns the instruction to poll, having handed nothing over, and the loop below runs as before.
2. The planner writes a plan. Mastra validates and registers it as a **dynamic workflow** built
   for this one request: one workflow per chain, and a root running the chains in parallel.
3. Every delegation in the plan is marked outstanding *before a single step runs*, so the first
   poll already names the whole of the work.
4. `getNextInstructionsWorkflow` reports the delegations that have finished since the last poll,
   folded from the run's own step-result stream. A result is handed over exactly once.
5. When the run ends, the request is done and the closing report recaps everything — including
   anything the run never got to, so a delegation that never answered is reported rather than
   dropped. Every report says outright whether it is that one: `requestFinished` is true on the
   closing report and false on every other, so callers and tests read that rather than the
   wording, or an empty `taskIdsInProgress`, which a poll that runs out mid-planning has too.
6. A delegation that stops to ask the user something is reported in that closing report as a
   question, in `questionsForUser` — see **Questions for the user** below.
7. What a delegation's tools read or change is pushed straight to sir's devices over the WebSocket
   API, the moment a tool answers, and never appears in a poll response — see
   [What a request touches](mcp-routing-affected-entities.md#affected-entities) below.

**How long the answer is:** the planner labels every request with a `responseStyle`, by where its
value lands (`RESPONSE_STYLES` in `routing/planner.ts`):
- `command` — something changed in the world (lights, alarms, list additions): a few words, with a
  remark only where the result differs from what was asked
- `lookup` — one fact: one sentence, at most one remark
- `briefing` — several facts or a summary: detail, at most one remark
- `conversation` — open-ended: full character

A mixed request takes the style that needs the most words. Every report the loop sends speaks in
that style (`SPEAKING_INSTRUCTIONS` in `routing/workflows.ts`); it used to ask for "a detailed
manner" every time, which is how "turn off the lights" earned a paragraph.

**Ending the call:** every finished request — answered, failed, or handed to a notification — ends
with `FINISHED_REQUEST_INSTRUCTIONS`: say nothing more, and if asked to speak again before sir has
said anything, call `end_call` without a word. The agent's turn timeout is what asks him again.
Nothing still waiting on sir carries it — a question the work stopped on, one from earlier, or what
to do with a photo he sent without saying: those end on `askTheUserInstructions`, which asks last and
waits. It makes one exception, in the same words as the prompt and the `end_call` and `skip_turn`
descriptions (`WAITING_FOR_A_PHOTO`): while Jarvis is waiting for a photo on a device that has told
him it has a camera button — sir said he would send one, or a note says he has opened the camera —
silence gets `skip_turn`, until the photo comes, a message says it did not reach him, a note says
sir closed the camera without one, or sir says it is not coming. Nothing else he says ends it: his
answer to a question, or any other request made before the photo comes, is routed and ends on this
instruction too, and when a word from him ended the wait, that request's silence hung up on him on
his way to the camera. A wait nothing settles still ends at ElevenLabs' 30-second
`silenceEndCallTimeout`. A request that said a photo is on its way (`awaitsPhoto`) does not end on
it at all: `WAIT_FOR_THE_PHOTO` has Jarvis say what the rest of the request found, tell sir to go
ahead with the camera button, and hold the line with `skip_turn` — or, where no note said this
device has a camera button, send him to his phone and hang up on the silence, since that photo goes
to the phone's own conversation. One that also asks sir something tells him to go ahead before the
question (`GO_AHEAD_BEFORE_ASKING`), and the question is still asked last. See **Hanging up when he
goes quiet** in `.claude/rules/elevenlabs.md`.

The wait lasts only until a photo is kept after the request said one was coming
(`followThePhotoWait` in `routing/controller.ts`, asked again whenever a report is built). The photo
can arrive while the rest of the request still runs, and be looked at by a request joined to it, and
the report that says what it shows must not also say it has yet to come and send sir back to the
camera for it. A photo that was already waiting when he said another was on its way does not end it.

**Why a workflow per request:**
Which agents a request needs is known only once it arrives, so a request that is a workflow has
to be built per request. What that buys: Studio graphs it, so what a request did — the root, its
chains, every agent step, what each was asked and what it answered — can be looked at rather
than read back from logs; the run is persisted; and the work is written down before it starts,
so `taskIdsInProgress` names what is outstanding instead of inferring it from whatever happened
to start.

`workflow-finish` is deliberately **not** read off the run stream. A chain is a nested workflow
sharing the root's pubsub, so its own finish event reaches the same stream — taking the first
one for the request's would close the request the moment the fastest chain was done. The end of
the request is the end of the stream, which only the root run has.

**Retention:**
A plan is a workflow per request, so the list would grow without limit. The five newest plans
stay visible and runnable; older ones are unregistered and their definitions archived, which
stops them rehydrating at boot without throwing away what they recorded.

**Polling contract:**
A poll blocks up to `POLL_DEADLINE_MS` (10s) waiting for something to report, then says so and
asks to be called again. That deadline has to fit inside ElevenLabs' `cascadeTimeoutSeconds`
(15s, in `elevenlabs/src/assets/agent-config.json`): a poll that times out at the ElevenLabs
boundary is a *lost* answer, not a delayed one. **The two move together.** They were 5s and 8s;
raising the deadline alone would reproduce the measured failures the header comment on
`POLL_DEADLINE_MS` records — every poll returning inside 4.4s succeeded, and the ones blocking
toward a 15s deadline against an 8s boundary came back failed at 9.3s, 10.9s and 13.7s. The
agent half only reaches the live agent once `bunx turbo deploy --filter=elevenlabs` has run, so
until then the deployed agent still enforces whatever it was last given.
The closing report recaps every result, including ones earlier polls already relayed, so a
response dropped on the way cannot lose an answer for good.

**One call per turn, carrying all of it:**
`userQuery` takes everything the user asked for in that turn, and the planner writes a task per
part with the independent ones running side by side. A real conversation had the agent split
"what about my calendar and my email this week?" into two routing calls — calendar planned, run,
polled and reported, and only then the email — so the second answer arrived a whole round of
polling late for no gain. The cause was the agent prompt's "every request gets its own call",
read as being about the things inside one turn rather than about successive turns. The prompt now
separates the two rules, and the `userQuery` description says it as well, since that description
is what the voice model reads when it decides what to put in the field.

**Who says "I'm on it":**
ElevenLabs, not the instructions. `routePromptWorkflow` has pre-tool speech set to **Force** in
its tool settings, so the agent speaks before the call is made — earlier than any instruction in
a response can manage, since a response only exists once the call has returned. `INSTRUCTIONS.poll`
therefore asks for no line at all. It used to, and when the agent prompt asked as well Jarvis
delivered both. That setting is an override held on the tool in the ElevenLabs dashboard rather
than in `agent-config.json` — MCP tools reach the agent through `mcpServerIds` and carry their own
configuration — so it is invisible from this repository and is written down in the code instead.

**Two tools, deliberately:**
The voice model gets `routePromptWorkflow` and `getNextInstructionsWorkflow` and nothing else.
That is a hard constraint, not an accident of the current design: the model on the call is
chosen for speed, and every extra tool is surface it has to reason about on a latency budget
that has no room for it.

What a request touches does not change that either: it goes to sir's devices over the WebSocket API
and never through the voice model (see [What a request touches](mcp-routing-affected-entities.md#affected-entities)).

It is also why a question's answer comes back through `routePromptWorkflow` rather than a tool
of its own (see **Questions for the user** above): the planner already reads every request, so it
is the one that recognises a reply as an answer. Approval gates are still not on this path: an
approval resumes with `{ approved: boolean }` rather than a sentence, so `readSuspension` refuses
it and the delegation is reported as failed rather than left parked on a question nobody can
answer.

**Authoring rules a generated plan has to respect:**
`createStepFromAgent` fixes every agent step's input to `{ prompt }` and its output to
`{ text }`; a `mapping` entry has to be a top-level workflow entry, so one inside a `parallel`
is rejected — which is why each chain is its own workflow; and `mapConfig` is a JSON *string*,
not an object. `plan.spec.ts` pins all of these against `validateDynamicWorkflow`, the same
check registration runs, so "would this register?" is answerable in milliseconds rather than by
restarting a server.

**Concurrent callers:**
`createSession({ resourceId })` is get-or-create and isolated, and the task records are scoped
by the same `resourceId`. Two callers get two sessions and neither can see the other's
delegations.

**Inspecting a request:**
Traces, in Studio's Observability tab — model calls, each delegation, timings and errors for
one request. Workflows are the only thing Studio draws as a graph, and the graph of this
machinery would be the same picture every time; what varies is which agents were asked and what
they said, which is what a trace shows.

Studio's Logs page lists every warning and error Mastra logged, from both processes.
`@mastra/libsql` stores no logs, so they are kept in an `observability_logs` table of our own
in the same SQLite file and spliced into the LibSQL observability store
(`storage/observability-logs.ts`, `storage/observability.ts`).
