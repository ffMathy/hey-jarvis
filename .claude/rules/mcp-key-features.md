---
paths:
  - "mcp/**"
---

# Key Features

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## 🤖 Intelligent Agents
- **TypeScript-based agents** with persistent memory and tool calling
- **Multi-provider LLM support** via Vercel AI SDK (OpenAI, Anthropic, Google Gemini, Ollama)
- **Structured output** generation with Zod validation
- **Real-time streaming** responses with step-by-step visibility
- **A twenty-step tool loop**, set by `createAgent` — see below

### The step budget

A step is one turn of the tool loop, and Mastra's default is five. Running out is not an
error: the run ends on a tool-calls step and the agent's answer is an empty string, which
routing reports as "finished without answering". That is what the calendar did to every
request asking for a week at a time — five steps was enough to list the calendars and read
them, and left none to answer with.

So `createAgent` sets `maxSteps` to twenty, which is Mastra's own ceiling for its durable and
network agents: enough for an agent to walk a household's worth of calendars, emails or
devices and still speak, while remaining a bound on a model that has started looping.
`mastra/utils/agent-factory.spec.ts` pins it with a model that insists on six tool calls.

An agent that needs more than twenty needs fewer round trips, not a bigger number — a tool
that answers in one call rather than one per item.

### The shared guidelines

`createAgent` follows every agent's own instructions with the same short section: never ask
questions, make a best-guess assumption instead, act on an id the request gives without looking it
up first (`POINTED_AT_ID_GUIDELINE` — see **What sir points at** under Routing), and the current
time. The instructions are resolved on every request, not at construction — agents are built once
at boot and the server stays up for days, so a time taken then would be days stale.

An agent's answer usually ends the exchange, so a question in it has nowhere to go. Questions
that do reach the user come from a tool that suspends, or from a Claude Code session that stops
to ask (see **Questions a coding session asks** under the coding vertical), never from an agent's
own text.
`mastra/utils/agent-factory.spec.ts` pins the exact text.

## 🔧 Tool Ecosystem
- **Model Context Protocol (MCP)** server integrations
- **Home automation tools** for smart device control
- **Voice processing** capabilities for speech-to-text and text-to-speech
- **External API integrations** for weather, calendar, and more

## 🌊 Workflow Engine
- **Graph-based workflows** with deterministic execution
- **Branching and conditional logic** with `.then()`, `.branch()`, `.parallel()`
- **Suspend/resume functionality** for human-in-the-loop interactions
- **Real-time tracing** and observability

## 🧠 Memory & Context
- **Persistent agent memory** with semantic recall
- **Thread-based conversations** with context preservation
- **Vector database integration** for knowledge retrieval
- **Working memory** for short-term context management
- **Automatic backup in Home Assistant**: When running as addon, all data stored in `/data` directory (included in HA backups)

## 📊 Token Usage Tracking & Quota Management
- **Automatic token tracking**: Captures token usage from all LLM interactions via AI tracing
- **Per-model statistics**: Track prompt tokens, completion tokens, and total usage by model and provider
- **Quota management**: Set token limits per model with daily, monthly, or yearly reset periods
- **Usage monitoring**: Query current usage, remaining quota, and percentage used
- **Database persistence**: Token usage stored in SQLite for historical tracking and reporting
- **AI Trace integration**: Seamlessly integrates with Mastra's observability pipeline
- **Startup summary**: Cumulative token usage displayed in console on system startup
