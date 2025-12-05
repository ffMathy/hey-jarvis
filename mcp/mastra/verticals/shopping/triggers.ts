import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { registerEmailTrigger } from '../email/triggers.js';
import { getNotificationAgent } from '../notification/agent.js';

// Email schema for incoming trigger emails (includes full HTML body)
const emailInputSchema = z.object({
  email: z.object({
    id: z.string(),
    subject: z.string(),
    bodyPreview: z.string(),
    body: z.object({
      contentType: z.string(),
      content: z.string(),
    }),
    from: z.object({
      name: z.string(),
      address: z.string(),
    }),
    receivedDateTime: z.string(),
  }),
});

// Schema for notification step output
const notificationOutputSchema = z.object({
  notificationSent: z.boolean(),
  message: z.string(),
});

// Step: Send notification about order changes via the notification agent
const notifyOrderChanges = createStep({
  id: 'notify-order-changes',
  description: 'Send notification about order changes via the notification agent',
  inputSchema: emailInputSchema,
  outputSchema: notificationOutputSchema,
  execute: async ({ inputData }) => {
    // Get the notification agent
    const notificationAgent = await getNotificationAgent();

    // Let the notification agent handle the notification with the full email content
    const notificationPrompt = `Send a notification to the user about this Bilka order change:

Subject: ${inputData.email.subject}

Email content (HTML):
${inputData.email.body.content}

Summarize the key changes and notify the user in Danish.`;

    try {
      // Execute the agent to handle notification
      const response = await notificationAgent.generate(notificationPrompt);

      return {
        notificationSent: true,
        message: response.text ?? 'Notification sent via agent',
      };
    } catch (error) {
      console.error('Failed to send notification via agent:', error);
      return {
        notificationSent: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

/**
 * Workflow that processes Bilka order change notification emails.
 *
 * This workflow is triggered when an email is received from Bilka's
 * customer service with a subject indicating order changes.
 *
 * Steps:
 * 1. Send notification via the notification agent with full HTML content
 */
export const orderChangedWorkflow = createWorkflow({
  id: 'orderChangedWorkflow',
  inputSchema: emailInputSchema,
  outputSchema: notificationOutputSchema,
})
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
