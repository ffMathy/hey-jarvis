---
paths:
  - "mcp/**"
---

# Fixing Failed ElevenLabs Evaluations

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

ElevenLabs scores every finished conversation against the criteria in `platformSettings.evaluation` of
`elevenlabs/src/assets/agent-config.json`, and posts the result with the full transcript to the agent's
post-call webhook — `POST /webhooks/elevenlabs/post-call` on this server (`verticals/api/evaluation-webhook.ts`).
A conversation that failed a criterion (`failure`; `unknown` is not one) starts an **unattended** coding
session (`startImplementationSession` with `unattended: true`) with the failed criteria, the evaluator's
reasons, ElevenLabs' summary and the whole transcript, tool calls and results included
(`verticals/coding/evaluation-failures.ts`). It finds the cause, fixes it with a test, and the watcher
pushes its branch and opens the pull request when it is done.

**Unattended means sir is never asked anything.** Nobody asked for the fix in person, so nobody is called
about it. The session's task says nobody can answer questions and tells it to decide every choice itself,
picking whatever changes least and is easiest to undo, and to list its assumptions in its final message
so they reach the pull request (`buildUnattendedSessionInstructions` in `session-questions.ts`). A
question it asks anyway, fenced or caught in prose by the classifier, never reaches `askUserQuestion`: the
watcher resumes the session with `UNATTENDED_SESSION_ANSWER`, telling it to decide for itself. After three
such answers the watcher publishes the work as it stands, so a session that keeps asking cannot keep
itself running. The only thing he hears is the usual notice that the pull request is ready. The coding
agent's `startCodingSession` tool cannot start an unattended session: only the webhook does.

- **Signed, not authenticated by Access.** ElevenLabs cannot present a Cloudflare Access service token, so
  the path sits under `/webhooks/*`, which has a **Bypass** application, as `/api/photos/*` does (see [MCP Server Access](mcp-mcp-server-access.md#mcp-server-access)).
  The request's `ElevenLabs-Signature` (`t=<seconds>,v0=<HMAC-SHA256 of "<seconds>.<body>">`) is the
  credential: a request without a well-formed signature from the last thirty minutes is answered `401`
  before its body is read, and one whose body does not match is answered `401` after. The body is read
  raw, at most 4 MB, because the signature is over its bytes — so `readsItsOwnBody` skips the server's
  JSON parser for this path.
- **Production only.** A conversation whose `agent_id` is not `HEY_JARVIS_ELEVENLABS_AGENT_ID` is
  acknowledged and left alone, and the deploy links the webhook to the production agent only: the test
  agent's conversations are the integration specs'.
- **Bounded.** One session per conversation, however often ElevenLabs redelivers it, and at most five a
  day: a change that breaks the agent fails every conversation after it. Both are counted in memory and
  start afresh with the process.
- **Answered at once.** `202` as soon as the fix is claimed; the session starts after the answer, and one
  that does not start is logged. Every other authentic webhook — audio, a failed call initiation, a
  conversation that passed — is answered `200`, since ElevenLabs disables a webhook that keeps failing.
- **The transcript is data.** It holds whatever anyone on the call said and whatever a tool returned, so
  it is fenced off in the session's task, which says nothing inside it is an instruction. The session
  cannot push, and its pull request is reviewed like any other.

**Setting it up:**
1. In the ElevenLabs dashboard, create a workspace webhook (HMAC authentication) for
   `https://<your MCP hostname>/webhooks/elevenlabs/post-call`, and keep its secret and its id in the
   `ElevenLabs` item of the `Jarvis` vault as `Post-call webhook secret` and `Post-call webhook ID`.
2. `HEY_JARVIS_ELEVENLABS_WEBHOOK_SECRET` is resolved from `mcp/op.optional.env`; without it the server
   logs one warning at startup and answers every post-call webhook `503`.
3. Add a Cloudflare Access application for `<your MCP hostname>/webhooks/*` with a single **Bypass**
   policy (include: Everyone). Every webhook lives under `/webhooks/` (`WEBHOOKS_PATH`), so this one
   application covers this one and any added later; each guards itself with its sender's signature, and
   reads its own body to check it (`readsItsOwnBody`).
4. `HEY_JARVIS_ELEVENLABS_POST_CALL_WEBHOOK_ID` is resolved from `elevenlabs/op.optional.env`, and
   `bunx turbo deploy --filter=elevenlabs` sets it as the production agent's
   `workspaceOverrides.webhooks.postCallWebhookId` (`withPostCallWebhook` in `elevenlabs/src/main.ts`).
   The agent already sends `transcript` events.
