---
paths:
  - "mcp/**"
---

# Form Replies Detection Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Automatically processes incoming email replies to form requests and resumes the suspended runs
they answer:
- **`formRepliesDetectionWorkflow`**: Scheduled workflow that runs every 3 hours
- **Step 1 - Search**: Finds emails received since this workflow's own last check
  (storage key `inbox-form-replies`)
- **Step 2 - Extract**: Reads the run id and request id out of the subject with
  `parseFormRequestSubject()` — the same function that builds the subject writes it, so the two
  sides cannot drift apart
- **Step 3 - Process**: For each email carrying the token:
  - Finds the run by asking each registered workflow whether it holds it
  - Hands the reply to the step that suspended, which checks the request id and the sender, and
    parses the free text with the email parsing agent
  - Counts the reply as resumed, rejected, or (no such run) an error
- **Step 4 - Register**: Registers the emails as a state change for the notification system
- **Step 5 - Summary**: Returns counts of emails processed, replies found, runs resumed and
  replies rejected

**Scheduled Execution:**
```typescript
scheduler.schedule({
  workflow: formRepliesDetectionWorkflow,
  schedule: CronPatterns.EVERY_3_HOURS,
  inputData: {},
  runOnStartup: true,
});
```

**When a reply is refused:**
A refused reply leaves the run suspended exactly where it was, so the person who was asked can
still answer. Replies are refused when they come from an address other than the one the request
was sent to, when they answer a request the run has already moved past, when the body is blank,
and when the parsing agent cannot read an answer out of them. Each is counted in
`repliesRejected` rather than reported as an error, because nothing has gone wrong with the
system. Only a token naming a run that does not exist is reported as an error.
