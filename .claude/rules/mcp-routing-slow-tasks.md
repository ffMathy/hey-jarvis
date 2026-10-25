---
paths:
  - "mcp/**"
---

<a id="slow-tasks"></a>
# Slow tasks

> Part of [Routing](mcp-routing.md). Paths in it are relative to `mcp/` unless they say otherwise.

Some work takes minutes: a Claude Code session answering a question about a codebase, or building a page. A tool or
workflow is flagged slow in code with `markAsSlow` (`mastra/utils/slow-tasks.ts`), and a shortcut
onto a slow tool is slow too. The flag belongs to the tool rather than the agent — the coding
agent lists issues in a second and starts an implementation that takes ten minutes.

1. Routing sees the agent call a slow tool the same way it sees a suspension: the step forwards
   the agent's `tool-call` chunk as `workflow-step-output`, and its `toolName` (`workflow-<id>` for
   a workflow) is looked up among the slow ones. That becomes a `delegation_slow` event.
2. The next poll returns at once with the task in `slowTaskIds`, and instructions to tell the user
   it will take a few minutes and offer to notify him when it is done. Each task is offered once.
3. His reply to the offer is **not** routed — a new request supersedes the running one and would
   cancel the work he just agreed to be told about. If he accepts, Jarvis polls with
   `notifyWhenDone: true`, which keeps the two-tool surface.
4. From then on the request outlives the conversation: a newer request does not cancel it, its
   questions stay open, and when it ends `completion-notice.ts` sends him the results through
   `sendNotification` — or, when it is waiting on a question, asks it through `askQuestion`, where
   his answer can come back. He answers it there or the next time he talks to Jarvis, through
   **Questions for the user** as usual.
