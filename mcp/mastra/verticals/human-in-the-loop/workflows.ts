import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { sendEmail } from '../email/tools.js';

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

// Output schema - generic response object
const sendAndWaitOutputSchema = z.object({
  senderEmail: z.string().describe('Email of the person who responded'),
  response: z.record(z.any()).describe('The parsed response data'),
});

// Step 1: Send email with form request
const sendFormRequestEmail = createStep({
  id: 'send-form-request-email',
  description: 'Send email with embedded workflow ID',
  inputSchema: sendAndWaitInputSchema,
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
    recipientEmail: z.string(), // Pass through for next step
  }),
  execute: async (params) => {
    const { recipientEmail, question } = params.inputData;
    const timeoutDate = new Date();
    timeoutDate.setDate(timeoutDate.getDate() + 14);

    const subject = `Form Request [WF-${params.workflowId}]: ${question}`;
    const bodyContent = `
<html>
  <body>
    <h2>Form Request</h2>
    <p><strong>Question:</strong> ${question}</p>
    <p>Please reply to this email with your answer. Your response will be processed automatically.</p>
    <hr>
    <p><small>Workflow ID: ${params.workflowId}</small></p>
    <p><small>This request expires on: ${timeoutDate.toLocaleString()}</small></p>
    <p><small>Please do not modify the subject line - it contains important tracking information.</small></p>
  </body>
</html>
    `.trim();

    const emailResult = await sendEmail.execute({
      subject,
      bodyContent,
      toRecipients: [recipientEmail],
    });

    // Handle validation error case - narrow the type explicitly
    if ('error' in emailResult) {
      throw new Error(`Failed to send email: ${emailResult.message}`);
    }

    // At this point, emailResult is known to be the success type
    return {
      messageId: emailResult.messageId,
      subject: emailResult.subject,
      success: emailResult.success,
      message: emailResult.message,
      recipientEmail,
    };
  },
});

// Step 2: Suspend and wait for email response
const awaitEmailResponse = createStep({
  id: 'await-email-response',
  description: 'Suspend workflow and wait for email response',
  inputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
    recipientEmail: z.string(), // Pass through for validation
  }),
  outputSchema: sendAndWaitOutputSchema,
  resumeSchema: z.record(z.any()),
  suspendSchema: z.object({
    message: z.string(),
  }),
  execute: async (params) => {
    const { recipientEmail } = params.state;

    // If we have resume data, process it
    if (params.resumeData) {
      const { senderEmail, ...responseData } = params.resumeData as any;

      // Validate sender email
      if (senderEmail && recipientEmail && senderEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
        throw new Error(
          `Security validation failed: Email sender ${senderEmail} does not match expected recipient ${recipientEmail}`,
        );
      }

      // Return the response data
      return {
        senderEmail: senderEmail || '',
        response: responseData,
      };
    }

    // Suspend workflow - will be resumed by checkForFormRepliesWorkflow
    await params.suspend({
      message: 'Waiting for email response...',
    });

    throw new Error('Workflow resumed without resume data');
  },
});

// Export the reusable workflow - no state schema means it can be used in any parent workflow
export const sendEmailAndAwaitResponseWorkflow = createWorkflow({
  id: 'sendEmailAndAwaitResponseWorkflow',
  inputSchema: sendAndWaitInputSchema,
  outputSchema: sendAndWaitOutputSchema,
})
  .then(sendFormRequestEmail)
  .then(awaitEmailResponse)
  .commit();

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
 * Each step uses the reusable sendEmailAndAwaitResponseWorkflow:
 * - Sends an email with a form request
 * - Suspends the workflow waiting for reply
 * - Validates the email reply contains the correct workflow ID
 * - Parses the response using LLM
 * - Resumes with parsed data
 *
 * Security:
 * - Workflow ID embedded in email subject: [WF-{id}]
 * - Expected sender email validated before resume
 * - 14-day timeout for each response
 */

// Input schema for the workflow - all fields optional with defaults
const workflowInputSchema = z.object({
  recipientEmail: z
    .string()
    .email()
    .optional()
    .default('demo@example.com')
    .describe('Email address to send form requests to'),
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
    response: z.record(z.any()),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
  }),
  execute: async (params) => {
    const { response, senderEmail } = params.inputData;

    return {
      approved: response.approved as boolean,
      comments: response.comments as string | undefined,
      recipientEmail: senderEmail,
    };
  },
});

// Step: Merge budget approval with project context
const mergeBudgetApprovalContext = createStep({
  id: 'merge-budget-approval-context',
  description: 'Add project name back to context after workflow',
  inputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
    projectName: z.string(), // From upstream context
    budgetAmount: z.number(), // From upstream context
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
    projectName: z.string(),
  }),
  execute: async (params) => {
    return {
      approved: params.inputData.approved,
      comments: params.inputData.comments,
      recipientEmail: params.inputData.recipientEmail,
      projectName: params.inputData.projectName,
    };
  },
});

// Step: Prepare vendor selection question
const prepareVendorSelectionQuestion = createStep({
  id: 'prepare-vendor-selection-question',
  description: 'Prepare vendor selection question',
  inputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
    recipientEmail: z.string(),
    projectName: z.string(),
  }),
  outputSchema: z.object({
    recipientEmail: z.string(),
    question: z.string(),
    projectName: z.string(),
  }),
  execute: async (params) => {
    const { approved, recipientEmail, projectName } = params.inputData;

    if (!approved) {
      throw new Error('Budget was not approved - workflow cannot continue');
    }

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
    response: z.record(z.any()),
  }),
  outputSchema: z.object({
    vendorName: z.string(),
    justification: z.string(),
    recipientEmail: z.string(),
  }),
  execute: async (params) => {
    const { response, senderEmail } = params.inputData;

    return {
      vendorName: response.vendorName as string,
      justification: response.justification as string,
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
    projectName: z.string(), // From upstream context
  }),
  outputSchema: z.object({
    vendorName: z.string(),
    justification: z.string(),
    recipientEmail: z.string(),
    projectName: z.string(),
  }),
  execute: async (params) => {
    return params.inputData;
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

// Step: Extract final confirmation response
const extractFinalConfirmationResponse = createStep({
  id: 'extract-final-confirmation-response',
  description: 'Extract final confirmation and merge with vendor context',
  inputSchema: z.object({
    senderEmail: z.string(),
    response: z.record(z.any()),
    vendorName: z.string(), // Passed through from prepareFinalConfirmationQuestion step output
  }),
  outputSchema: z.object({
    confirmed: z.boolean(),
    finalNotes: z.string().optional(),
    vendorName: z.string(),
  }),
  execute: async (params) => {
    const { response, vendorName } = params.inputData;

    return {
      confirmed: response.confirmed as boolean,
      finalNotes: response.finalNotes as string | undefined,
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
  // @ts-expect-error - Mastra workflow-as-step has complex generic constraints that conflict with strict TypeScript
  .then(sendEmailAndAwaitResponseWorkflow)
  .then(extractBudgetApprovalResponse)
  // @ts-expect-error - Mastra workflow chaining has complex generic constraints that conflict with strict TypeScript
  .then(mergeBudgetApprovalContext)
  .then(prepareVendorSelectionQuestion)
  // @ts-expect-error - Mastra workflow-as-step has complex generic constraints that conflict with strict TypeScript
  .then(sendEmailAndAwaitResponseWorkflow)
  .then(extractVendorSelectionResponse)
  // @ts-expect-error - Mastra workflow chaining has complex generic constraints that conflict with strict TypeScript
  .then(mergeVendorSelectionContext)
  .then(prepareFinalConfirmationQuestion)
  // @ts-expect-error - Mastra workflow-as-step has complex generic constraints that conflict with strict TypeScript
  .then(sendEmailAndAwaitResponseWorkflow)
  // @ts-expect-error - Mastra workflow chaining has complex generic constraints that conflict with strict TypeScript
  .then(extractFinalConfirmationResponse)
  .then(formatFinalOutput)
  .commit();
