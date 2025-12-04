import { z } from 'zod';
import { createAgentStep, createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { registerEmailTrigger } from '../email/triggers.js';
import { notifyDevice } from '../notification/tools.js';

// Email schema for incoming trigger emails
const emailInputSchema = z.object({
  email: z.object({
    id: z.string(),
    subject: z.string(),
    bodyPreview: z.string(),
    from: z.object({
      name: z.string(),
      address: z.string(),
    }),
    receivedDateTime: z.string(),
  }),
});

// Schema for extracted order changes
const orderChangesSchema = z.object({
  hasChanges: z.boolean(),
  changes: z.array(z.string()),
  summary: z.string(),
});

// Step 1: Extract order changes from email body
const extractOrderChanges = createAgentStep({
  id: 'extract-order-changes',
  description: 'Extract order changes from the Bilka order notification email',
  agentConfig: {
    id: 'order-change-extractor',
    name: 'OrderChangeExtractor',
    instructions: `You are an expert at extracting order change information from Danish Bilka order notification emails.

Your job is to analyze the email body and extract what items or order details have changed.

Look for patterns like:
- Items that were replaced with alternatives
- Items that were removed from the order
- Quantity changes
- Price changes
- Delivery time changes

Always respond in Danish with a clear, concise summary.`,
    description: 'Specialized agent for extracting order changes from Bilka notification emails',
    tools: undefined,
  },
  inputSchema: emailInputSchema,
  outputSchema: orderChangesSchema,
  prompt: ({ inputData }) => {
    return `Analyser denne e-mail fra Bilka kundeservice og udtræk ændringerne i ordren:

E-mail emne: ${inputData.email.subject}

E-mail indhold:
${inputData.email.bodyPreview}

Besvar med:
1. hasChanges: true hvis der er ændringer, false hvis ikke
2. changes: En liste af specifikke ændringer (på dansk)
3. summary: En kort opsummering af ændringerne (på dansk)

Hvis du ikke kan identificere specifikke ændringer, så beskriv generelt hvad e-mailen handler om.`;
  },
});

// Step 2: Send notification about order changes
const notifyOrderChanges = createStep({
  id: 'notify-order-changes',
  description: 'Send notification about order changes via Home Assistant',
  inputSchema: orderChangesSchema,
  outputSchema: z.object({
    notificationSent: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData.hasChanges) {
      return {
        notificationSent: false,
        message: 'No order changes detected, skipping notification',
      };
    }

    const notificationMessage =
      inputData.changes.length > 0
        ? `Sir, din Bilka ordre har følgende ændringer: ${inputData.changes.join('. ')}`
        : `Sir, ${inputData.summary}`;

    const result = await notifyDevice.execute({
      message: notificationMessage,
      conversationTimeout: 10000,
    });

    return {
      notificationSent: result.success,
      message: result.message,
    };
  },
});

/**
 * Workflow that processes Bilka order change notification emails.
 *
 * This workflow is triggered when an email is received from Bilka's
 * customer service with a subject indicating order changes.
 *
 * Steps:
 * 1. Extract order changes from the email body using AI
 * 2. Send a notification via Home Assistant if changes are detected
 */
export const orderChangedWorkflow = createWorkflow({
  id: 'orderChangedWorkflow',
  inputSchema: emailInputSchema,
  outputSchema: z.object({
    notificationSent: z.boolean(),
    message: z.string(),
  }),
})
  .then(extractOrderChanges)
  .then(notifyOrderChanges)
  .commit();

/**
 * Registers all shopping-related email triggers.
 *
 * This function should be called during MCP server initialization
 * to set up email triggers for shopping-related notifications.
 *
 * Currently registers:
 * - Bilka order change notifications: Triggers when an email from
 *   "info@kundeservice.bilkatogo.dk" with subject containing
 *   "Din ordre er klar med følgende ændringer" is received.
 */
export function registerShoppingTriggers(): void {
  console.log('🛒 Registering shopping email triggers...');

  registerEmailTrigger({
    sender: 'info@kundeservice.bilkatogo.dk',
    subjectFilter: (subject) => subject.includes('Din ordre er klar med følgende ændringer'),
    workflow: orderChangedWorkflow,
  });

  console.log('✅ Shopping email triggers registered');
}
