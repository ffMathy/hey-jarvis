---
paths:
  - "mcp/**"
---

# Reflection Agent

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Answers questions about the assistant itself rather than about the world — what failed, when, in
which agent, and why. It is the only agent whose tools read Mastra's own records, and the only one
that can explain a request the rest of the system got wrong.

It reads three things, because a failure lands in a different place depending on what kind it was:

- **Traces.** Every agent run, tool call and model call is sampled (`SamplingStrategyType.ALWAYS`)
  and kept for 14 days, each span carrying its own error. This is where a request that failed lives.
- **Workflow runs.** Kept for 30 days, each with the snapshot naming the step it stopped at. A
  scheduled email check that has failed hourly since last night is here and in no trace anyone would
  think to look for, because nobody asked for it.
- **The runtime diagnostics ring** (`utils/diagnostics.ts`). Everything Mastra reports about *itself*
  — a scheduler tick that threw, a run retired at boot, an exception an agent handled and tracked —
  goes to a logger and, with no telemetry backend attached, nowhere else. None of it is a run, so
  none of it is in a trace. `createLogger` keeps the last 200 warnings and errors in memory so
  something inside the system can read them back. It empties on restart, and the tool says so in its
  own output rather than letting an empty list read as a clean bill of health.

**Available Tools** (`reflection/tools.ts`):
- **`getSystemHealth`**: how many runs there were in a window, how many failed, and which agents they
  were in. The starting point for any broad question.
- **`listRecentFailures`**: the failures themselves, each with a traceId. Filtered on `hasChildError`
  rather than on the trace's own status — a run fails from the inside, so the tool call that broke
  carries the error while the agent span above it may well have recovered and finished clean.
  Matching on the root's status alone misses exactly the failures worth asking about. Each failure
  carries its `cause` — the innermost failing span — so "why did that fail?" is usually answered
  without a `describeTrace` call.
- **`describeTrace`**: one trace span by span, with the failing spans ordered innermost first. That
  ordering is the answer to "why": the deepest failure is the thing that actually broke, and every
  span above it is a wrapper reporting that something below it did. Inputs and outputs are included
  for the failing spans only, unless `includePayloads` is set: a routed request has dozens of spans,
  and every payload is text the agent has to read before it can answer.
- **`listWorkflowRuns`**: recent runs with their status and, for the failed ones, which step stopped
  them. A `foreach` step reports each failing iteration separately, because "the step failed" and
  "the step failed on two of forty items" are different answers.
- **`listRuntimeErrors`**: the diagnostics ring, filterable by level.
- **`describeConversation`**: everything one ElevenLabs conversation set running — each run, the
  agents, tool calls and workflow runs inside it with their trimmed payloads, what failed, the logs
  written inside those runs, and the diagnostics logged outside them while the conversation was being
  served. What Analysis Mode reads.

**Nothing here writes.** A vertical that could clear its own error log would be the last thing worth
trusting about an error.

The reporting logic lives in `reflection/reports.ts` as pure functions over storage records, so
which span is named as the cause and what its error reads as are tested without a database, a model
or a running server (`reports.spec.ts`). `errorSummary` joins an error to its `cause` rather than
picking one: a routing delegation arrives wrapped in a `MastraError` whose message names only the
agent — `[Agent:RoutingSupervisor] - Failed agent tool execution for calendar` — with the real
reason kept underneath it, and either half alone has been the one that was not useful.

**Reached by voice through Analysis Mode.** `elevenlabs/src/assets/agent-prompt.md` sends any phrase
beginning with "analysis" into a flat, numbered readout, and every analysis is routed here once —
"Analysis of conversation `<id>`: <focus>" — so the readout carries what happened behind the voice
agent's back, not only what it can see of its own call.

**How a conversation's work is found again.** The voice agent passes its ElevenLabs conversation id
(`{{system__conversation_id}}`, substituted into its prompt) as `routePromptWorkflow`'s
`conversationId`. The routing step starts the request inside `withinConversation`
(`utils/conversation.ts`), an `AsyncLocalStorage` scope that every promise the request leaves running
inherits, so nothing in the routing controller has to carry the id as a parameter. Where a run
starts — the MCP tool's own workflow run, the planner, the plan run, an agent resumed with an
answer — `conversationTracingOptions()` sets the root span's `sessionId` metadata, which Mastra
copies onto every child span, stores in the span's `sessionId` column and stamps onto every log
written inside those spans. `describeConversation` is then two queries: `listTraces` and `listLogs`
filtered on `sessionId`. Warnings routing logs outside any span go to the diagnostics ring with the
conversation id attached. The classifier and the direct answers start no root span of their own, so
their failures surface through those diagnostics rather than through a trace.
