---
paths:
  - "mcp/**"
---

# Scorers and Evaluation

> Part of [Jarvis Mastra AI Agents → Development Guidelines](mcp-development-guidelines.md). Paths in it are relative to `mcp/` unless they say otherwise.

**AUTOMATIC**: All agents and workflow steps automatically include comprehensive evaluation scorers through the new **AI Tracing** system:

## 🎯 **Included Scorers**:
- **answer-relevancy**: Evaluates how well responses address the input query (0-1, higher is better)
- **hallucination**: Detects factual contradictions and unsupported claims (0-1, lower is better)
- **completeness**: Checks if responses include all necessary information (0-1, higher is better)
- **prompt-alignment**: Measures how well responses align with prompt intent (0-1, higher is better)
- **bias**: Detects potential biases in outputs (0-1, lower is better)

## 🔧 **Available But Not Auto-Enabled**:
- **faithfulness**: Measures how accurately responses represent provided context (requires context to be provided)
- **tool-call-accuracy**: Evaluates whether the LLM selects correct tools (requires per-agent configuration with actual tool objects)

## ⚙️ **Scorer Configuration**:
- **Default sampling rate**: 10% of responses are scored (balances monitoring with cost)
- **Evaluation model**: Uses `gemini-flash-latest` for cost-effectiveness
- **Asynchronous execution**: Scoring runs in background without blocking responses
- **Automatic storage**: Results stored in `mastra_scorers` table via AI Tracing

## 📊 **AI Tracing and Observability**:
The project now uses **Mastra AI Tracing** instead of the deprecated telemetry system:
- **AI Tracing**: Enabled via custom observability config in Mastra setup
- **Structured Logging**: Uses PinoLogger for comprehensive log management
- **Trace Storage**: All traces and scorer results automatically stored in LibSQL database
- **DefaultExporter**: Persists traces locally for viewing in Studio
- **CloudExporter**: Optionally sends traces to Mastra Cloud (requires `MASTRA_CLOUD_ACCESS_TOKEN`)
- **TokenUsageExporter**: Custom exporter that captures and persists token usage from model generations
- **TokenTrackingProcessor**: Enriches spans with agent/workflow context for accurate attribution

## 💰 **Token Usage Tracking**:
Automatic token tracking is built into the observability pipeline:

**Architecture:**
1. **TokenUsageExporter**: Custom AI tracing exporter that listens for `MODEL_GENERATION` spans
2. **TokenTrackingProcessor**: Span processor that enriches traces with agent/workflow IDs
3. **TokenUsageStorage**: SQLite-based storage layer for historical token usage data
4. **Startup Logging**: Cumulative usage statistics displayed in console on system startup

**Database Schema:**
```sql
-- Token usage records table
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,              -- e.g., "gemini-flash-latest"
  provider TEXT NOT NULL,           -- e.g., "google"
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  trace_id TEXT,                    -- Links to AI trace
  agent_id TEXT,                    -- Agent that made the call
  workflow_id TEXT                  -- Workflow that made the call
);

-- Quota configuration table
CREATE TABLE token_quotas (
  model TEXT PRIMARY KEY,
  max_tokens INTEGER NOT NULL,
  reset_period TEXT DEFAULT 'monthly',  -- daily/monthly/yearly
  last_reset TEXT NOT NULL
);
```

**Startup Display:**
On system startup, cumulative token usage is logged to the console:
```
📊 Token Usage Summary:
   Total: 150,000 tokens (42 requests)
   Prompt: 100,000 | Completion: 50,000
   By Model:
   - gemini-flash-latest: 120,000 tokens (35 requests)
   - gpt-4: 30,000 tokens (7 requests)
```

**Programmatic Access:**
Token usage can be queried programmatically via the `TokenUsageStorage` API:
```typescript
import { getTokenUsageStorage } from './storage';

const storage = await getTokenUsageStorage();
const totalUsage = await storage.getTotalUsage();
const modelUsage = await storage.getAllModelUsage();
```

## 🔧 **Customizing Scorers**:
```typescript
// Override sampling rate for production (lower cost)
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: createScorersConfig({}, 0.05), // 5% sampling
});

// Add custom scorers
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: createScorersConfig({
    customScorer: {
      scorer: myCustomScorer(),
      sampling: { type: 'ratio', rate: 1.0 },
    },
  }),
});

// Disable scorers (not recommended)
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: undefined,
});
```

## 📊 **Monitoring and Analysis**:
- View scoring results in the Mastra playground at `http://localhost:4111/agents`
- Access AI traces and detailed metrics through Studio's Observability section
- Query the `mastra_scorers` table directly for custom analysis
- Use scoring data to identify improvement opportunities and track performance trends

**All scorers are automatically enabled by default to ensure comprehensive quality monitoring across the Hey Jarvis system.**
