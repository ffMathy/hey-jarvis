---
paths:
  - "mcp/**"
---

# Available Workflows

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## Shopping List Workflow
Multi-step shopping list processing workflow implementing the original n8n 3-agent architecture:
- **`shoppingListWorkflow`**: Handles natural language shopping requests in Danish with 5-step process
- **Step 1 - Cart Snapshot**: Gets current cart contents as "before" baseline
- **Step 2 - Information Extraction**: Uses specialized Information Extractor agent to parse user requests into structured product data with operation types (set/remove/null)
- **Step 3 - Product Mutation**: A plain step running the Shopping List Mutator Agent's own tool loop, with only the search and set tools and the current basket in its prompt; it skips the model when nothing needs changing. It used to be an agent step, whose tools are disabled, so it never changed the basket
- **Step 4 - Updated Cart Snapshot**: Gets final cart contents as "after" comparison
- **Step 5 - Summary Generation**: Uses Summarization Agent to compare before/after states and provide user feedback in Danish
- **Error handling**: Comprehensive retry logic and graceful failure messages for each step
- **Danish language support**: Processes requests and provides responses in Danish

**Converted from n8n**: This workflow replicates the exact 3-agent pattern from the original n8n Shopping List Agent workflow, including Information Extractor → Shopping List Mutator → Summarization Agent flow with before/after cart comparison.

## Split into its own rules

- [Routing](mcp-routing.md)
- [📅 Workflow Scheduling](mcp-workflow-scheduling.md)
- [Voice Announcements](mcp-voice-announcements.md)
- [Phone Notifications Into Synapse](mcp-phone-notifications-into-synapse.md)
- [Home Assistant Companion App Setup](mcp-home-assistant-companion-app-setup.md)
- [State Change Notification Workflow](mcp-state-change-notification-workflow.md)
- [Synapse Subscriptions (Points of Interest)](mcp-synapse-subscriptions-points-of-interest.md)
- [Synapse Important Changes (News for the Next Request)](mcp-synapse-important-changes-news-for-the-next.md)
- [Synapse Rules (Standing Instructions in Code)](mcp-synapse-rules-standing-instructions-in-code.md)
- [Weather Workflow](mcp-weather-workflow.md)
- [Implement Feature Workflow](mcp-implement-feature-workflow.md)
- [Fixing Failed ElevenLabs Evaluations](mcp-fixing-failed-elevenlabs-evaluations.md)
- [Human-in-the-Loop Demo Workflow](mcp-human-in-the-loop-demo-workflow.md)
- [Email Checking Workflow](mcp-email-checking-workflow.md)
- [Form Replies Detection Workflow](mcp-form-replies-detection-workflow.md)
