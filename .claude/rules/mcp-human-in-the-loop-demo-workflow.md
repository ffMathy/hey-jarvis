---
paths:
  - "mcp/**"
---

# Human-in-the-Loop Demo Workflow

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Demonstrates email-based workflow suspension and resumption with a 3-step approval process:
- **`humanInTheLoopDemoWorkflow`**: Multi-step approval workflow with email-based human input
- **Step 1 - Budget Approval**: Requests approval for project budget (Yes/No + comments)
- **Step 2 - Vendor Selection**: Requests vendor selection (Vendor name + justification)
- **Step 3 - Final Confirmation**: Requests final action confirmation (Confirm/Cancel + notes)
- **Email integration**: Sends form request emails carrying the id of the suspended run
- **Security validation**: Only a reply from the address that was asked is accepted
- **LLM parsing**: `parseEmailReply()` turns the free text of the reply into the typed response
- **No timeout**: A suspended request waits until it is answered — nothing expires it, and the
  email does not claim otherwise

**Email Format:**
- Subject: `Form Request [RUN-{runId}/REQ-{requestId}]: {question}`
- Body: Question + instructions + the request reference (`{runId}/{requestId}`)
- Resume trigger: A reply whose subject still carries both ids
- Header: every email `sendEmail` sends carries `X-Hey-Jarvis-Sent`. Jarvis and the household
  share one mailbox, so the request itself lands in the inbox the replies are read from, with
  the same subject token and the asked address as its sender; the header is the only thing that
  says it is not an answer, and the reply detector skips mail carrying it

**Workflow Steps:**
1. **Initialize**: Pass the recipient, project name and budget through
2. **Request Budget Approval**: Send email, suspend workflow, wait for reply
3. **Stop When Budget Is Rejected**: A "no" finishes the run with `approvalGranted: false`
4. **Request Vendor Selection**: Send email, suspend, wait for reply
5. **Request Final Confirmation**: Send email, suspend, wait for reply
6. **Format Output**: Generate final result with all collected data

**Security Features:**
- Run id embedded in the email subject: `[RUN-{runId}/...]` — unlike a workflow id, which is
  shared by every run and every recipient
- Request id alongside it: `[.../REQ-{requestId}]`, minted per question. Every stage of one run
  suspends under the same run id, so the request id is what says *which* question a reply
  answers; a reply is only accepted for the request the run is still waiting on
- Sender validated against the address the request was sent to; an empty sender is refused
  rather than skipped
- A reply that fails validation is refused and the request stays open, so a wrong-sender,
  duplicate or late reply cannot destroy a pending approval or answer the wrong question
- An empty reply body is refused rather than handed to the parsing agent
- `recipientEmail` is required: there is no default address a stray Studio run could mail

**Usage Example:**
```typescript
const run = await humanInTheLoopDemoWorkflow.createRun();
const result = await run.start({
  inputData: {
    recipientEmail: 'user@example.com',
    projectName: 'New Website',
    budgetAmount: 50000,
  },
});

// Workflow suspends and sends email
// User replies to email with answer
// formRepliesDetectionWorkflow (runs every 3 hours) finds the reply and resumes the run
```

**Helper Functions:**
- `getSendEmailAndAwaitResponseWorkflow(slug, responseSchema)`: Reusable send-and-wait workflow,
  embeddable in any parent workflow with `.then(...)`
- `parseEmailReply()`: Uses the email parsing agent to extract the typed answer from a reply
