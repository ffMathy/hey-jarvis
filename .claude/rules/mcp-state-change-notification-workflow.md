---
paths:
  - "mcp/**"
---

# State Change Notification Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Reactive notification workflow using agent network for intelligent state change analysis:
- **`stateChangeNotificationWorkflow`**: Analyzes state changes and sends notifications when warranted
- **Agent Network**: Uses Mastra Agent Network with notification agent for intelligent decision-making
- **Gemini Flash-Lite**: The reactor and the notification agent it delegates to run on Flash-Lite. They used to run on the Pi's `qwen2.5-instruct:1.5b` through hailo-ollama, which has no function calling (the Ollama provider strips tools from every request) and whose context the reactor's prompt overflowed, so in a month the reactor never called a tool (see `synapse/agent.ts`)
- **Woken only when something can come of it**: A change reaches the reactor only when it is high priority, a rule applies, a candidate subscription might fire, or Jev is sure it is wanted soon or now; everything else is saved to memory and held back (see [Jev Classifiers](mcp-jev-classifiers.md))
- **No Semantic Recall, no replayed thread**: The reactor reads working memory and its notification inbox, never embeddings and never its last messages. Its thread is a feed of `<notification-summary>` rollups; embedding those filled 41 GB of the Pi's disk in five weeks, and replaying them only put stale rollups in front of the model
- **Subscription Matching**: Retrieves relevant Given/When/Then subscriptions via static embeddings (see below)
- **Asynchronous Execution**: Triggered automatically by `registerStateChange` tool calls
- **Smart Filtering**: Only notifies for significant, actionable, or time-sensitive changes

**Workflow Steps:**
1. **Save to Memory**: State change is persisted as recent context, without an embedding
2. **Match Subscriptions**: State change is embedded and scored against every subscription's WHEN/GIVEN
3. **Gate**: Held back unless its priority, a rule, a candidate subscription or Jev calls for the reactor
4. **Analyze State Change**: Agent network examines state change data plus the matched subscriptions
5. **Notification Decision**: Determines if user should be notified based on:
   - Significance: Is this change important enough?
   - Actionability: Can the user do something about it?
   - Timing: Is this time-sensitive or urgent?
   - Context: What else is happening (from working memory)?
6. **Conditional Notification**: If warranted, hands the message to the notification agent, which routes it via `sendNotification`

**Technical Implementation:**
- Uses `AgentNetwork` from `@mastra/core` for multi-agent coordination
- Streams agent analysis for real-time decision-making
- Examines tool calls to detect if notification was actually sent
- Logs reasoning and notification status for observability
