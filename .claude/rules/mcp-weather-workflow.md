---
paths:
  - "mcp/**"
---

# Weather Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Multi-step weather processing workflow with state change registration:
- **`weatherWorkflow`**: Handles interactive weather requests from prompts or chat
- **`weatherMonitoringWorkflow`**: Performs scheduled weather checks every hour with automatic state change registration
- **Agent integration**: Seamlessly connects to the weather agent for tool execution
- **State change registration**: Automatically registers weather updates for notification analysis

**Workflow Steps:**
1. **Scheduled Weather Check**: reads the current weather for Aarhus, Denmark straight from the weather API and writes the line itself — no model call
2. **Register State Change**: Calls `registerStateChange` tool to persist weather data and trigger notification analysis

**Technical Implementation:**
- The check calls the weather tool directly. It was an agent step, and `createAgentStep` runs its agent with tools disabled, so every hourly update was the model guessing the weather; the factory now refuses tools at compile time
- Uses custom step with tool execution for state change registration
- Transforms weather result into structured state change format
- Triggers `stateChangeNotificationWorkflow` asynchronously
