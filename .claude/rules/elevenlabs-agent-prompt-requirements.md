---
paths:
  - "elevenlabs/**"
---

# Agent Prompt Requirements

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

The agent prompt in `src/assets/agent-prompt.md` defines:
- **Personality**: J.A.R.V.I.S.-inspired wit, dry humor
- **Addressing**: Always call the user "sir"
- **No Follow-ups**: Make assumptions rather than asking clarifying questions
- **Conciseness**: Brief, witty acknowledgements (5-15 words, max 20) — and for a routed
  request, whatever length the `instructions` field asks for, which outranks the prompt's own
  rules: a few words for a command, a sentence for a lookup, detail for a briefing, full
  character for conversation (the planner labels each request; see `.claude/rules/mcp.md`)
- **When to reach for a tool**: answer outright or route, and never both
- **Analysis Mode**: any phrase *beginning* with "analysis" drops the persona for
  a monotone, emotionless step-by-step readout. Every sentence opens with
  `[monotone][emotionless]` and no other tag — both are in `suggestedAudioTags`, since
  expressive mode leans on that list — and the text itself is written flat (full stops only,
  no judgement words, no emphasis), because the voice performs whatever feeling the text
  carries and a tag alone did not strip it. Whatever follows the word is the focus.
  Every analysis first calls `routePromptWorkflow` once — "Analysis of conversation
  `<id>`: <focus>" — which reaches the `reflection` agent's `describeConversation`:
  the agents, tool calls, failures and logs Mastra recorded behind each routed
  request of this call. The readout then walks the call in order and inserts what
  happened behind every `routePromptWorkflow` step (see `.claude/rules/mcp.md`)
- **Conversation id**: the prompt carries `{{system__conversation_id}}`, and every
  `routePromptWorkflow` call passes it as `conversationId`. ElevenLabs substitutes dynamic
  variables in the prompt but cannot bind an MCP tool argument to one, so the model copies
  it. That id is what Mastra files the request's traces and logs under, and a call
  without it still runs but is missing from every analysis
- **Ending the call**: a closing line in character, then the `end_call` tool — a
  written "[end_call invoked]" is a stage direction, not a call, and leaves the
  line open
- **When sir is silent**: see **Hanging up when he goes quiet** below
- **Photos sir sends from his phone**: see **Showing Jarvis something** below

Keep it short. The prompt is carried on every turn, so anything the agent does
not need in order to decide its *next* utterance does not belong in it — that is
a latency and cost argument, and it holds no matter how capable the model is.
