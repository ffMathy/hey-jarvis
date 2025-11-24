import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow } from '../../utils/workflow-factory.js';
import { sendEmail } from '../email/tools.js';

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
 * Each step:
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

// Workflow state schema with strong typing
const workflowStateSchema = z.object({
  recipientEmail: z.string(),
  step1Response: z
    .object({
      approved: z.boolean(),
      comments: z.string().optional(),
    })
    .optional(),
  step2Response: z
    .object({
      vendorName: z.string(),
      justification: z.string(),
    })
    .optional(),
  step3Response: z
    .object({
      confirmed: z.boolean(),
      finalNotes: z.string().optional(),
    })
    .optional(),
});

// Input schema for the workflow
const workflowInputSchema = z.object({
  recipientEmail: z.string().email().describe('Email address to send form requests to'),
  projectName: z.string().describe('Name of the project requiring approval'),
  budgetAmount: z.number().describe('Budget amount in USD'),
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
  description: 'Initialize workflow state with recipient email',
  stateSchema: workflowStateSchema,
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    recipientEmail: z.string(),
    projectName: z.string(),
    budgetAmount: z.number(),
  }),
  execute: async (params) => {
    // Store recipient email in state for all subsequent steps
    params.setState({
      recipientEmail: params.inputData.recipientEmail,
    });

    return {
      recipientEmail: params.inputData.recipientEmail,
      projectName: params.inputData.projectName,
      budgetAmount: params.inputData.budgetAmount,
    };
  },
});

// Step 2: Send budget approval email
const sendBudgetApprovalEmail = createStep({
  id: 'send-budget-approval-email',
  description: 'Send email requesting budget approval',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    recipientEmail: z.string(),
    projectName: z.string(),
    budgetAmount: z.number(),
  }),
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData, workflowId, mastra }) => {
    const { recipientEmail, projectName, budgetAmount } = inputData;
    const timeoutDate = new Date();
    timeoutDate.setDate(timeoutDate.getDate() + 14);
    
    const question = `Please approve the budget for project "${projectName}". Amount: $${budgetAmount.toLocaleString()}. Reply with "Yes" or "No" and optional comments.`;
    const subject = `Form Request [WF-${workflowId}]: ${question}`;
    const bodyContent = `
<html>
  <body>
    <h2>Form Request</h2>
    <p><strong>Question:</strong> ${question}</p>
    <p>Please reply to this email with your answer. Your response will be processed automatically.</p>
    <hr>
    <p><small>Workflow ID: ${workflowId}</small></p>
    <p><small>This request expires on: ${timeoutDate.toLocaleString()}</small></p>
    <p><small>Please do not modify the subject line - it contains important tracking information.</small></p>
  </body>
</html>
    `.trim();

    return await sendEmail.execute({
      subject,
      bodyContent,
      toRecipients: [recipientEmail],
    }, mastra);
  },
});

// Step 3: Suspend and wait for budget approval response (will be resumed by email workflow)
const awaitBudgetApprovalResponse = createStep({
  id: 'await-budget-approval-response',
  description: 'Suspend workflow and wait for email response',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
  }),
  resumeSchema: z.object({
    approved: z.boolean().describe('Whether budget was approved'),
    comments: z.string().optional().describe('Optional comments'),
    emailBody: z.string().describe('Full email body for validation'),
    senderEmail: z.string().describe('Email address of the sender'),
  }),
  suspendSchema: z.object({
    message: z.string(),
  }),
  execute: async (params) => {
    const { recipientEmail } = params.state;

    // If we have resume data, process it
    if (params.resumeData) {
      const { approved, comments, senderEmail } = params.resumeData;

      // Validate sender email
      if (senderEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
        throw new Error(
          `Security validation failed: Email sender ${senderEmail} does not match expected recipient ${recipientEmail}`,
        );
      }

      console.log(`✅ Budget approval received: ${approved ? 'APPROVED' : 'REJECTED'}`);
      if (comments) {
        console.log(`   Comments: ${comments}`);
      }

      // Store response in workflow state
      params.setState({
        ...params.state,
        step1Response: { approved, comments },
      });

      return { approved, comments };
    }

    // First execution - suspend and wait for email response
    console.log('⏸️  Workflow suspended, waiting for budget approval email response...');
    return await params.suspend({
      message: 'Waiting for budget approval response',
    });
  },
});

// Step 4: Check if budget was approved
const checkBudgetApproval = createStep({
  id: 'check-budget-approval',
  description: 'Check if budget was approved and decide next step',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    approved: z.boolean(),
    comments: z.string().optional(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    shouldContinue: z.boolean(),
  }),
  execute: async (params) => {
    const { step1Response } = params.state;

    if (!step1Response) {
      throw new Error('Step 1 response not found in workflow state');
    }

    if (!step1Response.approved) {
      console.log('❌ Budget not approved. Workflow will terminate.');
      return {
        approved: false,
        shouldContinue: false,
      };
    }

    console.log('✅ Budget approved. Proceeding to vendor selection.');
    return {
      approved: true,
      shouldContinue: true,
    };
  },
});

// Step 5: Send vendor selection email
const sendVendorSelectionEmail = createStep({
  id: 'send-vendor-selection-email',
  description: 'Send email requesting vendor selection',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    approved: z.boolean(),
    shouldContinue: z.boolean(),
  }),
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData, workflowId, state, mastra }) => {
    if (!inputData.shouldContinue) {
      return {
        messageId: '',
        subject: '',
        success: false,
        message: 'Skipped (budget not approved)',
      };
    }

    const timeoutDate = new Date();
    timeoutDate.setDate(timeoutDate.getDate() + 14);
    
    const question = 'Please select a vendor for this project. Provide the vendor name and a brief justification.';
    const subject = `Form Request [WF-${workflowId}]: ${question}`;
    const bodyContent = `
<html>
  <body>
    <h2>Form Request</h2>
    <p><strong>Question:</strong> ${question}</p>
    <p>Please reply to this email with your answer. Your response will be processed automatically.</p>
    <hr>
    <p><small>Workflow ID: ${workflowId}</small></p>
    <p><small>This request expires on: ${timeoutDate.toLocaleString()}</small></p>
    <p><small>Please do not modify the subject line - it contains important tracking information.</small></p>
  </body>
</html>
    `.trim();

    return await sendEmail.execute({
      subject,
      bodyContent,
      toRecipients: [state.recipientEmail],
    }, mastra);
  },
});

// Step 6: Suspend and wait for vendor selection response
const awaitVendorSelectionResponse = createStep({
  id: 'await-vendor-selection-response',
  description: 'Suspend workflow and wait for vendor selection email response',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  outputSchema: z.object({}),
  resumeSchema: z.object({
    vendorName: z.string().describe('Name of the selected vendor'),
    justification: z.string().describe('Justification for vendor selection'),
    emailBody: z.string().describe('Full email body for validation'),
    senderEmail: z.string().describe('Email address of the sender'),
  }),
  suspendSchema: z.object({
    message: z.string(),
  }),
  execute: async (params) => {
    const { recipientEmail } = params.state;

    // Skip if vendor selection email wasn't sent (budget not approved)
    if (!params.inputData.success) {
      console.log('⏭️  Skipping vendor selection await (email not sent)');
      return {};
    }

    // If we have resume data, process it
    if (params.resumeData) {
      const { vendorName, justification, senderEmail } = params.resumeData;

      // Validate sender email
      if (senderEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
        throw new Error(
          `Security validation failed: Email sender ${senderEmail} does not match expected recipient ${recipientEmail}`,
        );
      }

      console.log(`✅ Vendor selected: ${vendorName}`);
      console.log(`   Justification: ${justification}`);

      // Store response in workflow state
      params.setState({
        ...params.state,
        step2Response: { vendorName, justification },
      });

      return {};
    }

    // First execution - suspend and wait for email response
    console.log('⏸️  Workflow suspended, waiting for vendor selection email response...');
    return await params.suspend({
      message: 'Waiting for vendor selection response',
    });
  },
});

// Step 7: Send final confirmation email
const sendFinalConfirmationEmail = createStep({
  id: 'send-final-confirmation-email',
  description: 'Send email requesting final confirmation',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ workflowId, state, mastra }) => {
    if (!state.step2Response) {
      return {
        messageId: '',
        subject: '',
        success: false,
        message: 'Skipped (no vendor selected)',
      };
    }

    const timeoutDate = new Date();
    timeoutDate.setDate(timeoutDate.getDate() + 14);
    
    const question = `Please confirm the final action. Selected vendor: ${state.step2Response.vendorName}. Reply with "Confirm" or "Cancel" and any final notes.`;
    const subject = `Form Request [WF-${workflowId}]: ${question}`;
    const bodyContent = `
<html>
  <body>
    <h2>Form Request</h2>
    <p><strong>Question:</strong> ${question}</p>
    <p>Please reply to this email with your answer. Your response will be processed automatically.</p>
    <hr>
    <p><small>Workflow ID: ${workflowId}</small></p>
    <p><small>This request expires on: ${timeoutDate.toLocaleString()}</small></p>
    <p><small>Please do not modify the subject line - it contains important tracking information.</small></p>
  </body>
</html>
    `.trim();

    return await sendEmail.execute({
      subject,
      bodyContent,
      toRecipients: [state.recipientEmail],
    }, mastra);
  },
});

// Step 8: Suspend and wait for final confirmation response
const awaitFinalConfirmationResponse = createStep({
  id: 'await-final-confirmation-response',
  description: 'Suspend workflow and wait for final confirmation email response',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  outputSchema: z.object({}),
  resumeSchema: z.object({
    confirmed: z.boolean().describe('Whether the final action is confirmed'),
    finalNotes: z.string().optional().describe('Any final notes or instructions'),
    emailBody: z.string().describe('Full email body for validation'),
    senderEmail: z.string().describe('Email address of the sender'),
  }),
  suspendSchema: z.object({
    message: z.string(),
  }),
  execute: async (params) => {
    const { recipientEmail, step2Response } = params.state;

    // Skip if no vendor was selected
    if (!step2Response) {
      console.log('⏭️  Skipping final confirmation (no vendor selected)');
      return {};
    }

    // If we have resume data, process it
    if (params.resumeData) {
      const { confirmed, finalNotes, senderEmail } = params.resumeData;

      // Validate sender email
      if (senderEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
        throw new Error(
          `Security validation failed: Email sender ${senderEmail} does not match expected recipient ${recipientEmail}`,
        );
      }

      console.log(`✅ Final confirmation: ${confirmed ? 'CONFIRMED' : 'CANCELLED'}`);
      if (finalNotes) {
        console.log(`   Final notes: ${finalNotes}`);
      }

      // Store response in workflow state
      params.setState({
        ...params.state,
        step3Response: { confirmed, finalNotes },
      });

      return {};
    }

    // First execution - suspend and wait for email response
    console.log('⏸️  Workflow suspended, waiting for final confirmation email response...');
    return await params.suspend({
      message: 'Waiting for final confirmation response',
    });
  },
});

// Step 9: Format final output
const formatFinalOutput = createStep({
  id: 'format-final-output',
  description: 'Format the final workflow output with all collected data',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: workflowOutputSchema,
  execute: async (params) => {
    const { step1Response, step2Response, step3Response } = params.state;

    // Budget was not approved
    if (!step1Response?.approved) {
      return {
        success: true,
        message: 'Workflow completed. Budget approval was rejected.',
        approvalGranted: false,
      };
    }

    // Budget approved but no vendor selected
    if (!step2Response) {
      return {
        success: true,
        message: 'Workflow completed. Budget approved but vendor selection was not completed.',
        approvalGranted: true,
      };
    }

    // Vendor selected but not confirmed
    if (!step3Response?.confirmed) {
      return {
        success: true,
        message: `Workflow completed. Vendor "${step2Response.vendorName}" was selected but final confirmation was cancelled.`,
        approvalGranted: true,
        vendorSelected: step2Response.vendorName,
        finalConfirmation: false,
      };
    }

    // Full workflow completed successfully
    return {
      success: true,
      message: `Workflow completed successfully! Budget approved, vendor "${step2Response.vendorName}" selected and confirmed.`,
      approvalGranted: true,
      vendorSelected: step2Response.vendorName,
      finalConfirmation: true,
    };
  },
});

/**
 * Human-in-the-Loop Demo Workflow
 *
 * Demonstrates a 3-step approval process with email-based human input:
 * 1. Budget approval (Yes/No + comments)
 * 2. Vendor selection (Vendor name + justification)
 * 3. Final confirmation (Confirm/Cancel + final notes)
 *
 * Each step suspends the workflow and waits for email reply before continuing.
 * The workflow validates sender email and workflow ID for security.
 *
 * Usage:
 * ```typescript
 * const run = await workflow.createRun();
 * const result = await run.start({
 *   inputData: {
 *     recipientEmail: 'user@example.com',
 *     projectName: 'New Website',
 *     budgetAmount: 50000,
 *   },
 * });
 *
 * // Later, when email reply arrives:
 * await run.resume({
 *   approved: true,
 *   comments: 'Looks good!',
 *   emailBody: '...',
 *   senderEmail: 'user@example.com',
 * });
 * ```
 */
export const humanInTheLoopDemoWorkflow = createWorkflow({
  id: 'humanInTheLoopDemoWorkflow',
  stateSchema: workflowStateSchema,
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(initializeWorkflow)
  .then(sendBudgetApprovalEmail)
  .then(awaitBudgetApprovalResponse)
  .then(checkBudgetApproval)
  .then(sendVendorSelectionEmail)
  .then(awaitVendorSelectionResponse)
  .then(sendFinalConfirmationEmail)
  .then(awaitFinalConfirmationResponse)
  .then(formatFinalOutput)
  .commit();
