import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { sendEmail } from '../email/tools.js';
import { parseEmailReply } from './agents.js';

/**
 * Send Email and Await Response Workflow
 *
 * Reusable workflow that can be used as a step in other workflows.
 * It sends an email with a form request, suspends, and waits for a reply.
 *
 * This workflow implements the human-in-the-loop pattern and can be
 * embedded in parent workflows using .then(sendEmailAndAwaitResponseWorkflow)
 */

// No state schema for the send-and-wait workflow - it operates independently
// All data flows through input/output, not state

// Input schema
const sendAndWaitInputSchema = z.object({
  recipientEmail: z.string().email().describe('Email address to send request to'),
  question: z.string().describe('Question to ask in the email'),
});

// Intermediate schema for email sending step output.
//
// There is no `messageId`: Graph's sendMail answers 202 with no body, so the tool has
// nothing to report but the literal string 'sent', and a constant cannot correlate
// anything. `requestId` is the handle that can -- it is minted here and quoted by the
// reply that answers this exact email.
const emailSentSchema = z.object({
  requestId: z.string(),
  subject: z.string(),
  success: z.boolean(),
  message: z.string(),
  recipientEmail: z.string(),
  question: z.string(),
});

/**
 * Builds the subject token that lets an inbound reply be matched back to the exact
 * question it answers.
 *
 * Two identifiers, because neither is enough alone:
 *
 * - The run id says *which suspended run* the reply belongs to. Not the workflow id: that
 *   is a constant shared by every run and every recipient, which is why the reply handler
 *   used to parse it back out and then give up. The run id seen by a step inside a nested
 *   workflow is the id of the top-level run, so it is exactly what
 *   `Workflow.getWorkflowRunById()` needs on the way back in.
 * - The request id says *which question of that run* was asked. A run that asks three
 *   questions in sequence suspends three times under the same run id, so a run id on its
 *   own matches a reply to whichever question happens to be open now -- which meant a
 *   duplicate reply to question one was recorded as the answer to question two.
 *
 * Both halves are checked at resume time, so a reply can only ever answer the request it
 * was sent for.
 */
export function buildFormRequestSubject({
  runId,
  requestId,
  question,
}: {
  runId: string;
  requestId: string;
  question: string;
}): string {
  return `Form Request [RUN-${runId}/REQ-${requestId}]: ${question}`;
}

/**
 * Matches the token {@link buildFormRequestSubject} writes, in a subject that has usually
 * had "Re: " prefixed to it by the replying mail client.
 */
const FORM_REQUEST_SUBJECT_REGEX = /\[RUN-([^\]\s/]+)\/REQ-([^\]\s/]+)\]/;

/**
 * Reads the run and request ids back out of a reply's subject.
 *
 * One definition of the token's shape, shared by the side that writes it and the side
 * that reads it, so the two cannot drift apart.
 *
 * @returns Both ids, or `undefined` when the subject carries no complete token -- which
 * is the case for ordinary mail, and for anything whose token was mangled in transit.
 */
export function parseFormRequestSubject(subject: string): { runId: string; requestId: string } | undefined {
  const match = subject.match(FORM_REQUEST_SUBJECT_REGEX);
  if (!match) {
    return undefined;
  }

  return { runId: match[1], requestId: match[2] };
}

// Step 1: Send email with form request (static, not dependent on response schema)
const sendFormRequestEmail = createStep({
  id: 'send-form-request-email',
  description: 'Send email carrying the run and request ids that identify this question',
  inputSchema: sendAndWaitInputSchema,
  outputSchema: emailSentSchema,
  execute: async (params) => {
    const { recipientEmail, question } = params.inputData;

    // A fresh id per request, minted here rather than derived from the run: every
    // send-and-wait stage of a parent workflow shares the parent's run id, so this is
    // the only thing that tells one stage's email apart from the next one's.
    const requestId = crypto.randomUUID();

    // No expiry is advertised, because nothing expires the suspension: the graph is
    // send -> await, and a suspended run waits until it is resumed or deleted. The email
    // used to promise a 14-day deadline that no code enforced.
    const subject = buildFormRequestSubject({ runId: params.runId, requestId, question });
    const bodyContent = `
<html>
  <body>
    <h2>Form Request</h2>
    <p><strong>Question:</strong> ${question}</p>
    <p>Please reply to this email with your answer. Your response will be processed automatically.</p>
    <hr>
    <p><small>Request reference: ${params.runId}/${requestId}</small></p>
    <p><small>Please do not modify the subject line - it contains important tracking information.</small></p>
  </body>
</html>
    `.trim();

    const emailResult = await executeTool(sendEmail, {
      subject,
      bodyContent,
      toRecipients: [recipientEmail],
    });

    return {
      requestId,
      subject: emailResult.subject,
      success: emailResult.success,
      message: emailResult.message,
      recipientEmail,
      question,
    };
  },
});

/**
 * What a suspended request tells whoever finds it.
 *
 * The payload used to be `{}`, which left a resumer with no way to know whose reply the
 * run was waiting for, which request it was waiting on, what it had asked, or what an
 * acceptable answer looks like. All four are needed: the address to match an inbound
 * sender against, the id an answering reply has to quote, the question to give a parser
 * context, and the shape the answer has to take.
 */
const pendingEmailRequestSchema = z.object({
  recipientEmail: z.string().describe('The only address whose reply will be accepted'),
  question: z.string().describe('The question that was asked'),
  requestId: z.string().describe('Id of this request; only a reply quoting it will be accepted'),
  responseSchema: z.record(z.string(), z.unknown()).describe('JSON Schema of the answer this step accepts'),
  rejectedReply: z
    .object({
      senderEmail: z.string().describe('Address the refused reply came from'),
      reason: z.string().describe('Why the reply was not accepted'),
    })
    .optional()
    .describe('Set when a reply arrived and was refused; the request is still open'),
});

/**
 * Decides whether a reply may be treated as coming from the person who was asked.
 *
 * Fails closed in both directions: an empty sender is refused rather than skipped (the
 * guard used to read `senderEmail && ...`, so a falsy sender disabled the check and an
 * approval was accepted from nobody), and a request that records no recipient can verify
 * nothing, so it refuses too.
 */
function describeSenderProblem(senderEmail: string, recipientEmail: string): string | undefined {
  if (!recipientEmail) {
    return 'the request records no expected recipient, so no reply can be verified against it';
  }

  if (!senderEmail) {
    return `the reply carried no sender address, and the request was sent to ${recipientEmail}`;
  }

  if (senderEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
    return `the reply came from ${senderEmail}, and the request was sent to ${recipientEmail}`;
  }

  return undefined;
}

/**
 * Decides whether a reply may be treated as an answer to the question that is still open.
 *
 * The reply quotes the request id of the email it answers; the step knows the id of the
 * request it is suspended on. Anything else -- a duplicate reply to a question already
 * answered, or a late reply to stage one arriving while stage two waits -- names a
 * request that is no longer open, and answering the wrong question with it records a
 * decision nobody made.
 */
function describeStaleReplyProblem(quotedRequestId: string, requestId: string): string | undefined {
  if (quotedRequestId === requestId) {
    return undefined;
  }

  return `the reply answers request ${quotedRequestId}, and the question still open is request ${requestId}`;
}

/**
 * Creates the await email response step with a typed response schema.
 * This is a factory function that generates a step with the correct output types.
 *
 * A reply that cannot be accepted -- one answering a request that is no longer open,
 * a wrong or missing sender, or text the parsing agent cannot turn into the expected
 * answer -- suspends the step again instead of throwing.
 * Throwing killed the run, and with it the pending request: a single forwarded or
 * aliased reply permanently destroyed an approval nobody had answered yet. Re-suspending
 * refuses the reply and leaves the question open for the person who was actually asked.
 */
function createAwaitEmailResponseStep<TResponseSchema extends z.ZodObject<z.ZodRawShape>>(
  responseSchema: TResponseSchema,
) {
  const outputSchema = z.object({
    senderEmail: z.string().describe('Email of the person who responded'),
    response: responseSchema,
  });

  const resumeSchema = z.object({
    requestId: z.string().describe('Id of the request being answered, taken from the subject of the reply'),
    senderEmail: z.string().describe('Email of the person who responded'),
    replyBody: z.string().optional().describe('Raw text of the reply, to be parsed by the email parsing agent'),
    response: responseSchema.optional().describe('An already structured answer, when the caller parsed it itself'),
  });

  // Fixed the moment the step is created, so it is built once per step rather than once
  // per run and once more on every re-suspension.
  const responseJsonSchema = z.toJSONSchema(responseSchema);

  return createStep({
    id: 'await-email-response',
    description: 'Suspend workflow and wait for email response',
    inputSchema: emailSentSchema,
    outputSchema,
    resumeSchema,
    suspendSchema: pendingEmailRequestSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      const { recipientEmail, question, requestId } = inputData;
      const pendingRequest = {
        recipientEmail,
        question,
        requestId,
        responseSchema: responseJsonSchema,
      };

      if (!resumeData) {
        return await suspend(pendingRequest);
      }

      const { requestId: quotedRequestId, senderEmail, replyBody, response } = resumeData;

      const staleReplyProblem = describeStaleReplyProblem(quotedRequestId, requestId);
      if (staleReplyProblem) {
        console.warn(`🚫 Refusing a reply to "${question}": ${staleReplyProblem}`);
        return await suspend({ ...pendingRequest, rejectedReply: { senderEmail, reason: staleReplyProblem } });
      }

      const senderProblem = describeSenderProblem(senderEmail, recipientEmail);
      if (senderProblem) {
        console.warn(`🚫 Refusing a reply to "${question}": ${senderProblem}`);
        return await suspend({ ...pendingRequest, rejectedReply: { senderEmail, reason: senderProblem } });
      }

      if (response !== undefined) {
        return { senderEmail, response };
      }

      // Blankness, not absence: an empty body and a missing one are the same non-answer,
      // and handing the model an empty string only invites it to invent a decision.
      if (!replyBody?.trim()) {
        const reason = 'the resume carried neither a structured response nor a reply body to parse';
        console.warn(`🚫 Refusing a reply to "${question}": ${reason}`);
        return await suspend({ ...pendingRequest, rejectedReply: { senderEmail, reason } });
      }

      try {
        return { senderEmail, response: await parseEmailReply({ question, replyBody, responseSchema }) };
      } catch (error) {
        const reason = `the reply could not be read as an answer: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`🚫 Refusing a reply to "${question}": ${reason}`);
        return await suspend({ ...pendingRequest, rejectedReply: { senderEmail, reason } });
      }
    },
  });
}

/**
 * Creates a reusable send-email-and-await-response workflow with strongly-typed response.
 *
 * @param slug - Unique identifier for this workflow instance
 * @param responseSchema - Zod schema defining the expected response structure
 * @returns A workflow that sends an email and waits for a typed response
 *
 * @example
 * ```typescript
 * const budgetApprovalResponseSchema = z.object({
 *   approved: z.boolean(),
 *   comments: z.string().optional(),
 * });
 *
 * const workflow = getSendEmailAndAwaitResponseWorkflow(
 *   'budgetApproval',
 *   budgetApprovalResponseSchema
 * );
 * // Output type is { senderEmail: string; response: { approved: boolean; comments?: string } }
 * ```
 */
export function getSendEmailAndAwaitResponseWorkflow<TResponseSchema extends z.ZodObject<z.ZodRawShape>>(
  slug: string,
  responseSchema: TResponseSchema,
) {
  const outputSchema = z.object({
    senderEmail: z.string().describe('Email of the person who responded'),
    response: responseSchema,
  });

  return createWorkflow({
    id: `sendEmailAndAwaitResponseWorkflow-${slug}`,
    inputSchema: sendAndWaitInputSchema,
    outputSchema: outputSchema as z.ZodType<z.infer<typeof outputSchema>>,
  })
    .then(sendFormRequestEmail)
    .then(createAwaitEmailResponseStep(responseSchema))
    .commit();
}

/**
 * Human-in-the-Loop Demo Workflow
 *
 * This workflow demonstrates the human-in-the-loop pattern with email-based
 * workflow suspension and resumption. It simulates a 3-step approval process
 * where each step requires human input via email.
 *
 * Flow:
 * 1. Request budget approval (Yes/No with optional comments)
 * 2. If approved, request vendor selection (Vendor name + justification)
 * 3. If vendor selected, request final confirmation (Confirm/Cancel)
 *
 * A rejected budget is an outcome rather than an error: the run finishes with
 * `approvalGranted: false` and the remaining questions are never asked.
 *
 * Each step uses the reusable sendEmailAndAwaitResponseWorkflow:
 * - Sends an email with a form request
 * - Suspends the workflow waiting for reply
 * - Validates the reply came from the address that was asked
 * - Parses the reply with the email parsing agent
 * - Resumes with the parsed answer
 *
 * Security:
 * - Run id and per-request id embedded in the email subject: [RUN-{runId}/REQ-{requestId}]
 * - A reply is only accepted for the request it quotes, so a duplicate or late reply
 *   cannot be recorded as the answer to whichever question is open now
 * - Expected sender validated before an answer is accepted
 * - A reply that fails validation is refused and the request stays open
 */

// Input schema for the workflow.
//
// `recipientEmail` deliberately has no default. It used to fall back to a placeholder
// address, which meant pressing "run" on this workflow in Mastra Studio sent real mail
// through the Graph API to whoever that address belonged to. Requiring it turns a stray
// run into a validation error instead of an email.
const workflowInputSchema = z.object({
  recipientEmail: z.string().email().describe('Email address to send form requests to'),
  projectName: z.string().optional().default('Demo Project').describe('Name of the project requiring approval'),
  budgetAmount: z.number().optional().default(10000).describe('Budget amount in USD'),
});

// Output schema for the workflow
const workflowOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  approvalGranted: z.boolean().optional(),
  vendorSelected: z.string().optional(),
  finalConfirmation: z.boolean().optional(),
});

// Response schemas for each human-in-the-loop step
const budgetApprovalResponseSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional(),
});

const vendorSelectionResponseSchema = z.object({
  vendorName: z.string(),
  justification: z.string(),
});

const finalConfirmationResponseSchema = z.object({
  confirmed: z.boolean(),
  finalNotes: z.string().optional(),
});

// Step 1: Initialize workflow state
const initializeWorkflow = createStep({
  id: 'initialize-workflow',
  description: 'Pass through input data without modification',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    recipientEmail: z.string(),
    projectName: z.string(),
    budgetAmount: z.number(),
  }),
  execute: async (params) => {
    // Just pass through - no state needed
    return params.inputData;
  },
});

// Step: Prepare budget approval question
const prepareBudgetApprovalQuestion = createStep({
  id: 'prepare-budget-approval-question',
  description: 'Prepare budget approval question',
  inputSchema: z.object({
    recipientEmail: z.string(),
    projectName: z.string(),
    budgetAmount: z.number(),
  }),
  outputSchema: z.object({
    recipientEmail: z.string(),
    question: z.string(),
    projectName: z.string(),
    budgetAmount: z.number(),
  }),
  execute: async (params) => {
    const { recipientEmail, projectName, budgetAmount } = params.inputData;
    return {
      recipientEmail,
      question: `Please approve the budget for project "${projectName}". Amount: $${budgetAmount.toLocaleString()}. Reply with "Yes" or "No" and optional comments.`,
      projectName,
      budgetAmount,
    };
  },
});

// Step: Extract budget approval response
const extractBudgetApprovalResponse = createStep({
  id: 'extract-budget-approval-response',
  description: 'Extract approval decision and merge with context',
  inputSchema: z.object({
    senderEmail: z.string(),
    response: budgetApprovalResponseSchema,
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
  }),
  execute: async (params) => {
    const { response, senderEmail } = params.inputData;

    return {
      approved: response.approved,
      comments: response.comments,
      recipientEmail: senderEmail,
    };
  },
});

const budgetApprovalContextSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional(),
  recipientEmail: z.string(),
  projectName: z.string(),
});

// Step: Merge budget approval with project context
const mergeBudgetApprovalContext = createStep({
  id: 'merge-budget-approval-context',
  description: 'Add project name back to context after workflow',
  inputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
  }),
  outputSchema: budgetApprovalContextSchema,
  execute: async (params) => {
    const initData = params.getInitData<{ projectName: string; budgetAmount: number }>();
    return {
      approved: params.inputData.approved,
      comments: params.inputData.comments,
      recipientEmail: params.inputData.recipientEmail,
      projectName: initData.projectName,
    };
  },
});

/**
 * Step: Finish the run early when the budget was rejected.
 *
 * "No" is one of the two answers the question invites, and the output schema already
 * models it through `approvalGranted`. This used to throw
 * "Budget was not approved - workflow cannot continue", reporting an ordinary decision
 * as a failed run.
 */
const stopWhenBudgetIsRejected = createStep({
  id: 'stop-when-budget-is-rejected',
  description: 'Finish the run with a rejection result when the budget was not approved',
  inputSchema: budgetApprovalContextSchema,
  outputSchema: budgetApprovalContextSchema,
  execute: async (params) => {
    const { approved, comments, projectName } = params.inputData;

    if (approved) {
      return params.inputData;
    }

    return params.bail<z.infer<typeof workflowOutputSchema>>({
      success: true,
      message: comments
        ? `Workflow completed. The budget for project "${projectName}" was not approved: ${comments}`
        : `Workflow completed. The budget for project "${projectName}" was not approved.`,
      approvalGranted: false,
    });
  },
});

// Step: Prepare vendor selection question
const prepareVendorSelectionQuestion = createStep({
  id: 'prepare-vendor-selection-question',
  description: 'Prepare vendor selection question',
  inputSchema: budgetApprovalContextSchema,
  outputSchema: z.object({
    recipientEmail: z.string(),
    question: z.string(),
    projectName: z.string(),
  }),
  execute: async (params) => {
    const { recipientEmail, projectName } = params.inputData;

    return {
      recipientEmail,
      question: `Please select a vendor for project "${projectName}". Reply with the vendor name and justification.`,
      projectName,
    };
  },
});

// Step: Extract vendor selection response
const extractVendorSelectionResponse = createStep({
  id: 'extract-vendor-selection-response',
  description: 'Extract vendor selection and merge with context',
  inputSchema: z.object({
    senderEmail: z.string(),
    response: vendorSelectionResponseSchema,
  }),
  outputSchema: z.object({
    vendorName: z.string(),
    justification: z.string(),
    recipientEmail: z.string(),
  }),
  execute: async (params) => {
    const { response, senderEmail } = params.inputData;

    return {
      vendorName: response.vendorName,
      justification: response.justification,
      recipientEmail: senderEmail,
    };
  },
});

// Step: Merge vendor selection with project context
const mergeVendorSelectionContext = createStep({
  id: 'merge-vendor-selection-context',
  description: 'Add project name back to context after workflow',
  inputSchema: z.object({
    vendorName: z.string(),
    justification: z.string(),
    recipientEmail: z.string(),
  }),
  outputSchema: z.object({
    vendorName: z.string(),
    justification: z.string(),
    recipientEmail: z.string(),
    projectName: z.string(),
  }),
  execute: async (params) => {
    const initData = params.getInitData<{ projectName: string }>();
    return {
      ...params.inputData,
      projectName: initData.projectName,
    };
  },
});

// Step: Prepare final confirmation question
const prepareFinalConfirmationQuestion = createStep({
  id: 'prepare-final-confirmation-question',
  description: 'Prepare final confirmation question',
  inputSchema: z.object({
    vendorName: z.string(),
    justification: z.string(),
    recipientEmail: z.string(),
    projectName: z.string(),
  }),
  outputSchema: z.object({
    recipientEmail: z.string(),
    question: z.string(),
    vendorName: z.string(),
  }),
  execute: async (params) => {
    const { recipientEmail, projectName, vendorName } = params.inputData;

    return {
      recipientEmail,
      question: `Final confirmation for project "${projectName}" with vendor "${vendorName}". Reply with "Confirm" or "Cancel" and optional notes.`,
      vendorName,
    };
  },
});

/**
 * Step: Put the selected vendor back on the context after the nested workflow.
 *
 * The budget and vendor stages each have a merge step for the same reason: a nested
 * send-and-wait workflow emits only `{ senderEmail, response }`, so everything the
 * surrounding graph knew is gone by the time the answer comes back. This stage had none,
 * and `extract-final-confirmation-response` demanded a `vendorName` nothing could supply,
 * so every run of the demo died on its last hop. The vendor is not workflow input, so
 * unlike the other two merges it is read back from the step that chose it rather than
 * from `getInitData()`.
 */
const mergeFinalConfirmationContext = createStep({
  id: 'merge-final-confirmation-context',
  description: 'Add the selected vendor back to context after workflow',
  inputSchema: z.object({
    senderEmail: z.string(),
    response: finalConfirmationResponseSchema,
  }),
  outputSchema: z.object({
    senderEmail: z.string(),
    response: finalConfirmationResponseSchema,
    vendorName: z.string(),
  }),
  execute: async (params) => ({
    ...params.inputData,
    vendorName: params.getStepResult(prepareFinalConfirmationQuestion).vendorName,
  }),
});

// Step: Extract final confirmation response
const extractFinalConfirmationResponse = createStep({
  id: 'extract-final-confirmation-response',
  description: 'Extract final confirmation and merge with vendor context',
  inputSchema: z.object({
    senderEmail: z.string(),
    response: finalConfirmationResponseSchema,
    vendorName: z.string(), // Put back by merge-final-confirmation-context
  }),
  outputSchema: z.object({
    confirmed: z.boolean(),
    finalNotes: z.string().optional(),
    vendorName: z.string(),
  }),
  execute: async (params) => {
    const { response, vendorName } = params.inputData;

    return {
      confirmed: response.confirmed,
      finalNotes: response.finalNotes,
      vendorName,
    };
  },
});

// Step: Format final output
const formatFinalOutput = createStep({
  id: 'format-final-output',
  description: 'Format the final workflow output with all collected data',
  inputSchema: z.object({
    confirmed: z.boolean(),
    finalNotes: z.string().optional(),
    vendorName: z.string(),
  }),
  outputSchema: workflowOutputSchema,
  execute: async (params) => {
    const { confirmed, vendorName } = params.inputData;

    // Format the final output based on confirmation status
    if (!confirmed) {
      return {
        success: true,
        message: `Workflow completed. Vendor "${vendorName}" was selected but final confirmation was cancelled.`,
        approvalGranted: true,
        vendorSelected: vendorName,
        finalConfirmation: false,
      };
    }

    // Full workflow completed successfully
    return {
      success: true,
      message: `Workflow completed successfully! Budget approved, vendor "${vendorName}" selected and confirmed.`,
      approvalGranted: true,
      vendorSelected: vendorName,
      finalConfirmation: true,
    };
  },
});

export const humanInTheLoopDemoWorkflow = createWorkflow({
  id: 'humanInTheLoopDemoWorkflow',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(initializeWorkflow)
  .then(prepareBudgetApprovalQuestion)
  .then(getSendEmailAndAwaitResponseWorkflow('budgetApproval', budgetApprovalResponseSchema)) // Send email and wait for human response
  .then(extractBudgetApprovalResponse)
  .then(mergeBudgetApprovalContext)
  .then(stopWhenBudgetIsRejected)
  .then(prepareVendorSelectionQuestion)
  .then(getSendEmailAndAwaitResponseWorkflow('vendorSelection', vendorSelectionResponseSchema))
  .then(extractVendorSelectionResponse)
  .then(mergeVendorSelectionContext)
  .then(prepareFinalConfirmationQuestion)
  .then(getSendEmailAndAwaitResponseWorkflow('finalConfirmation', finalConfirmationResponseSchema))
  .then(mergeFinalConfirmationContext)
  .then(extractFinalConfirmationResponse)
  .then(formatFinalOutput)
  .commit();
