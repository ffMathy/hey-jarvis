import { z } from 'zod';
import { createStep, createToolStep, createWorkflow } from '../../utils/workflow-factory.js';
import { notificationTools } from './tools.js';

// Step 1: Validate notification message
const validateMessage = createStep({
  id: 'validate-notification-message',
  description: 'Validate that the notification message is not empty and within reasonable length',
  inputSchema: z.object({
    message: z.string(),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { message } = context;

    if (!message || message.trim().length === 0) {
      return {
        valid: false,
        message,
        error: 'Notification message cannot be empty',
      };
    }

    if (message.length > 500) {
      return {
        valid: false,
        message,
        error: 'Notification message is too long (max 500 characters)',
      };
    }

    return {
      valid: true,
      message,
    };
  },
});

// Step 2: Send notification using tool-as-step pattern
const sendNotification = createToolStep({
  id: 'send-notification',
  description: 'Send notification to device(s) using the notify-device tool',
  tool: notificationTools.notifyDevice,
  inputSchema: z.object({
    message: z.string(),
    deviceName: z.string().optional(),
    conversationTimeout: z.number().optional(),
  }),
  inputTransform: ({ message, deviceName, conversationTimeout }) => ({
    message,
    deviceName,
    conversationTimeout,
  }),
});

// Main notification workflow
export const notificationWorkflow = createWorkflow({
  id: 'proactive-notification-workflow',
  inputSchema: z.object({
    message: z.string().describe('The notification message to deliver'),
    deviceName: z.string().optional().describe('Optional: Device name to notify (e.g., "hass_elevenlabs")'),
    conversationTimeout: z.number().optional().default(5000).describe('Timeout in ms (default: 5000)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    serviceCalled: z.string().optional(),
  }),
})
  .then(validateMessage)
  .branch([
    [({ ctx }) => ctx.valid === true, sendNotification],
    [
      ({ ctx }) => ctx.valid === false,
      createStep({
        id: 'validation-error',
        description: 'Return validation error',
        inputSchema: z.object({ error: z.string() }),
        outputSchema: z.object({
          success: z.boolean(),
          message: z.string(),
        }),
        execute: async ({ context }) => ({
          success: false,
          message: context.error,
        }),
      }),
    ],
  ]);

// Commit the workflow
notificationWorkflow.commit();
