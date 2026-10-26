---
paths:
  - "mcp/**"
---

# Project Structure

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

The project follows a vertical-based organization structure for better cohesion:

```
mcp/
├── mastra/
│   ├── verticals/       # Organized by business verticals
│   │   ├── weather/     # Weather vertical
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── shopping/    # Shopping vertical
│   │   │   ├── agents.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── cooking/     # Cooking vertical
│   │   │   ├── agent.ts        # General recipe search agent
│   │   │   ├── tools.ts
│   │   │   ├── meal-planning/  # Sub-vertical for meal planning
│   │   │   │   ├── agents.ts   # 3 specialized meal planning agents
│   │   │   │   ├── workflows.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── coding/      # GitHub repository management
│   │   │   ├── agent.ts          # Coding agent
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── notification/    # Proactive notifications
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── phone/           # Phone calls, texts and contacts (tools only)
│   │   │   ├── contacts.ts
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   ├── visualize/   # Pages built on request by a Claude session (mostly shortcuts)
│   │   │   ├── agent.ts
│   │   │   ├── shortcuts.ts
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   ├── presence/        # Where the user is (shortcuts only)
│   │   │   ├── shortcuts.ts
│   │   │   └── index.ts
│   │   ├── vision/          # Photos sent from the phone's camera button, and the agents that read them
│   │   │   ├── agents.ts
│   │   │   ├── live-conversation.ts # Asks ElevenLabs whether the phone's conversation is live, before a slot opens
│   │   │   ├── photos.ts    # The in-memory store, its upload slots, and which photos are waiting
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   └── reflection/      # The assistant's own errors and failed runs
│   │       ├── agent.ts
│   │       ├── reports.ts   # Pure readers over Mastra's stored records
│   │       ├── tools.ts
│   │       └── index.ts
│   ├── processors/      # Output processors for post-processing
│   │   ├── error-reporting.ts
│   │   └── index.ts
│   ├── memory/          # Shared memory management
│   ├── storage/         # Shared storage configuration
│   └── index.ts         # Main Mastra configuration
└── project.json         # TURBO project configuration
```
