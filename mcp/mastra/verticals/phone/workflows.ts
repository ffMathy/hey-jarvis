import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import type { StateChange } from '../synapse/state-change.js';
import { registerStateChange } from '../synapse/tools.js';

/**
 * An Android notification, as Home Assistant forwards it from the companion app's
 * `sensor.<phone>_last_notification`.
 *
 * Every field but `app` is nullish because Home Assistant renders a missing attribute as
 * `null` through `to_json`, and an app is free to post a notification without a title or
 * without body text.
 */
export const phoneNotificationSchema = z.object({
  app: z.string().min(1).describe('Package name of the app that posted it, e.g. "com.whatsapp"'),
  title: z.string().nullish().describe('The `android.title` attribute'),
  text: z.string().nullish().describe('The `android.text` attribute'),
  bigText: z.string().nullish().describe('The `android.bigText` attribute: the expanded text, when the app sets one'),
  postedAt: z.number().nullish().describe('The `post_time` attribute, in milliseconds since the epoch'),
});

export type PhoneNotification = z.infer<typeof phoneNotificationSchema>;

/**
 * Turns a phone notification into a Synapse state change, or `null` when there is nothing in
 * it to reason about.
 *
 * A notification with neither a title nor any text is a progress bar, a media player or a
 * foreground-service placeholder. Those still update the sensor, but nothing a subscription
 * could match is in them.
 *
 * The expanded text wins over the short one, since the short one is usually its truncation.
 *
 * Exported for testing.
 */
export function toNotificationStateChange(notification: PhoneNotification): StateChange | null {
  const title = notification.title?.trim() || undefined;
  const text = notification.bigText?.trim() || notification.text?.trim() || undefined;

  if (!title && !text) {
    return null;
  }

  const stateData: Record<string, unknown> = { app: notification.app };
  if (title) {
    stateData.title = title;
  }
  if (text) {
    stateData.text = text;
  }
  if (notification.postedAt) {
    stateData.postedAt = new Date(notification.postedAt).toISOString();
  }

  return { source: 'phone', stateType: 'notification_posted', stateData };
}

const registerPhoneNotification = createStep({
  id: 'register-phone-notification',
  description: 'Files an Android notification with Synapse as a state change',
  inputSchema: phoneNotificationSchema,
  outputSchema: z.object({
    registered: z.boolean(),
    duplicate: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const stateChange = toNotificationStateChange(inputData);

    if (!stateChange) {
      return {
        registered: false,
        duplicate: false,
        message: `Notification from ${inputData.app} has no title or text; nothing was registered.`,
      };
    }

    return await executeTool(registerStateChange, stateChange, { mastra });
  },
});

/**
 * Receives the phone's notifications from Home Assistant and hands them to Synapse.
 *
 * Exposed as `POST /api/phone-notification`, which a Home Assistant automation calls through
 * a `rest_command` whenever the companion app's last-notification sensor changes. It is pushed
 * rather than polled because the sensor only ever holds the latest notification: a poll sees
 * one per interval and loses the rest.
 */
export const phoneNotificationWorkflow = createWorkflow({
  id: 'phoneNotificationWorkflow',
  inputSchema: phoneNotificationSchema,
  outputSchema: z.object({
    registered: z.boolean(),
    duplicate: z.boolean(),
    message: z.string(),
  }),
})
  .then(registerPhoneNotification)
  .commit();
