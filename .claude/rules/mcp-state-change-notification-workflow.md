---
paths:
  - "mcp/**"
---

# State Change Notification Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Reactive notification workflow using agent network for intelligent state change analysis:
- **`stateChangeNotificationWorkflow`**: Analyzes state changes and sends notifications when warranted
- **Agent Network**: Uses Mastra Agent Network with notification agent for intelligent decision-making
- **Semantic Recall**: Leverages memory to understand context and determine notification necessity
- **Subscription Matching**: Retrieves relevant Given/When/Then subscriptions via static embeddings (see below)
- **Asynchronous Execution**: Triggered automatically by `registerStateChange` tool calls
- **Smart Filtering**: Only notifies for significant, actionable, or time-sensitive changes

**Workflow Steps:**
1. **Save to Memory**: State change is persisted for semantic recall
2. **Match Subscriptions**: State change is embedded and scored against every subscription's WHEN/GIVEN
3. **Analyze State Change**: Agent network examines state change data plus the matched subscriptions
4. **Notification Decision**: Determines if user should be notified based on:
   - Significance: Is this change important enough?
   - Actionability: Can the user do something about it?
   - Timing: Is this time-sensitive or urgent?
   - Context: What else is happening (from semantic recall)?
5. **Conditional Notification**: If warranted, hands the message to the notification agent, which routes it via `sendNotification`

**Technical Implementation:**
- Uses `AgentNetwork` from `@mastra/core` for multi-agent coordination
- Streams agent analysis for real-time decision-making
- Examines tool calls to detect if notification was actually sent
- Logs reasoning and notification status for observability
