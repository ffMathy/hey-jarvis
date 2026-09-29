import type { StateChange } from '../synapse/state-change.js';

/**
 * The companion app's sensor whose state is the text of the phone's latest notification, and
 * whose attributes carry the rest of it.
 */
const LAST_NOTIFICATION_SENSOR = /^sensor\..+_last_notification$/;

/**
 * The companion app's sensor for the latest notification the user dismissed. It carries the
 * same text as the one it was posted with, so it has nothing new to report.
 */
const LAST_REMOVED_NOTIFICATION_SENSOR = /^sensor\..+_last_removed_notification$/;

/** Whether an entity is the companion app's last-notification sensor. */
export function isLastNotificationSensor(entityId: string): boolean {
  return LAST_NOTIFICATION_SENSOR.test(entityId);
}

/**
 * Whether an entity's state is the text of a notification, and so must never be reported as
 * an ordinary device state.
 */
export function isNotificationSensor(entityId: string): boolean {
  return isLastNotificationSensor(entityId) || LAST_REMOVED_NOTIFICATION_SENSOR.test(entityId);
}

/** An Android notification, as the companion app reports it. */
export interface PhoneNotification {
  /** Package name of the app that posted it, e.g. "com.whatsapp". */
  app: string;
  title?: string;
  text?: string;
  /** The expanded text, when the app sets one. */
  bigText?: string;
  /** Milliseconds since the epoch. */
  postedAt?: number;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads a notification out of the last-notification sensor's attributes, or `null` when they
 * do not name the app that posted it.
 */
export function readNotificationAttributes(attributes: Record<string, unknown>): PhoneNotification | null {
  const app = asText(attributes.package);
  if (!app) {
    return null;
  }

  return {
    app,
    title: asText(attributes['android.title']),
    text: asText(attributes['android.text']),
    bigText: asText(attributes['android.bigText']),
    postedAt: typeof attributes.post_time === 'number' ? attributes.post_time : undefined,
  };
}

/**
 * Turns a phone notification into a Synapse state change, or `null` when there is nothing in
 * it to reason about.
 *
 * A notification with neither a title nor any text is a progress bar, a media player or a
 * foreground-service placeholder. Those still update the sensor, but nothing a subscription
 * could match is in them.
 *
 * The expanded text wins over the short one, since the short one is usually its truncation.
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
