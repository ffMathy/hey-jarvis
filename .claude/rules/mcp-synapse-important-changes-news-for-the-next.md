---
paths:
  - "mcp/**"
---

# Synapse Important Changes (News for the Next Request)

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Not everything worth knowing is worth a push notification. When the State Change Reactor decides a
change is something sir would want to hear about — a parcel arriving this afternoon, a meeting moved —
it calls `noteImportantChange` with the sentence Jarvis should say. The change is kept for 24 hours in
`mastra/storage/important-changes.ts` (table `important_changes`, in SQLite because the reactor and the
MCP server are different processes).

One piece of news is told per silence, newest first: `routePromptWorkflow` works one into its
acknowledgement, so Jarvis tells it as an aside ("By the way, sir, …") before the first
`getNextInstructionsWorkflow` call, and every poll that runs out with nothing to report ("Still
processing") carries the next one. A request that finishes before the route call returns has no
silence, so its closing report carries the news, told straight after the answer. A claim marks the change told in the same statement, so each is
mentioned once, and a storage failure only costs the aside (`claimImportantChangeToMention` in
`synapse/important-changes.ts`).
