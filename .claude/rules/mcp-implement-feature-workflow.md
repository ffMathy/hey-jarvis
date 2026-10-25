---
paths:
  - "mcp/**"
---

# Implement Feature Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Takes a change from a spoken request to a Claude Code session implementing it:
- **`implementFeatureWorkflow`**: Starts the session at once; the session studies the codebase, asks only what the user alone can decide, and implements
- **Step 1 - Prepare**: Resolves the repository (Jarvis's own by default) and an optional title
- **Step 2 - Start Coding Session**: Starts a Claude Code session on the change with `startCodingSession`, and watches its events; the watcher asks the session's questions and opens the pull request once the session is done. No issue is filed
- **Step 3 - Format**: Says whether the session started, and on what

**Workflow Steps:**
1. **Prepare**: The request goes to the session as the user said it.
2. **Coding Session**: The session is told to read the parts of the codebase the request touches before changing
   anything, and to decide whatever the code, its documentation and its conventions settle. When nothing is left that
   only the user can decide, which is the usual case, it implements the change without asking. When something is, it
   asks then or at any later point (see **Questions a coding session asks** under [Coding Agent](mcp-coding-agent.md#coding-agent)). The
   session runs unattended in the host's Docker Sandbox, and every notable event it emits (agent messages, status
   transitions, errors) is republished as a Synapse state change from the `coding` source, so progress flows into the
   existing notification path instead of needing the workflow to stay alive. The session commits on a `jarvis/…`
   branch and pushes nothing; when it is done, the watcher pushes the branch and opens the pull request from the
   server, and reports its link as `coding_session_pull_request_opened` (see **The sandbox cannot write to GitHub; the
   server publishes** under [Coding Agent](mcp-coding-agent.md#coding-agent))
3. **Format**: Reports the session id and title, or why the session did not start.

**Usage Example:**
```typescript
await mastra.workflows.implementFeatureWorkflow.execute({
  initialRequest: "Add email notifications for task reminders",
  repository: "hey-jarvis", // Optional: defaults to "hey-jarvis"
  owner: "ffMathy", // Optional: defaults to "ffMathy"
});
```

**Why it asks nothing up front:**
It used to run a separate analysing session first and suspend once per question it wrote. That cost
minutes before anything was built even when nothing needed asking, and could only ask before the
work began. Letting the implementing session ask means a clear request is built straight away and a
question that only shows up halfway through can still be asked.
