import { z } from 'zod';

/**
 * Who a notification is for.
 *
 * Everything the notification vertical does hangs off this distinction, so it is modelled as a
 * discriminated union rather than a bag of optional fields:
 *
 * - a **user** target is the household's primary user — always Mathias. It carries no contact
 *   details at all, because the whole point is that Jarvis works out how to reach him from where
 *   he is right now (in the car, at home, out) rather than from what the caller happened to know.
 * - a **contact** target is anybody else, and it carries the only thing Jarvis knows about them:
 *   a phone number, an email address, or both.
 */
export const userTargetSchema = z.object({
  type: z
    .literal('user')
    .describe('Marks this target as the primary user of the house. Always resolves to Mathias, whoever asked.'),
});

export const contactTargetSchema = z.object({
  type: z.literal('contact').describe('Marks this target as somebody other than the primary user.'),
  name: z.string().optional().describe('The contact\'s name, used for wording the message ("Hi Julie, ...").'),
  email: z.string().optional().describe("The contact's email address. Required if no phone number is given."),
  phoneNumber: z
    .string()
    .optional()
    .describe(
      'The contact\'s phone number in E.164 format (e.g. "+4512345678"). Required if no email address is given.',
    ),
});

export const notificationTargetSchema = z
  .discriminatedUnion('type', [userTargetSchema, contactTargetSchema])
  .describe(
    'Who to notify. Either {"type":"user"} for the primary user (Mathias), or {"type":"contact"} with an email address and/or a phone number for anybody else.',
  );

export type UserTarget = z.infer<typeof userTargetSchema>;
export type ContactTarget = z.infer<typeof contactTargetSchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

/**
 * The person a `user` target means.
 *
 * Read through a function rather than captured in a module constant so tests -- and a future
 * household with a different primary user -- can change it without reloading the module.
 */
export function getPrimaryUserName(): string {
  return process.env.HEY_JARVIS_PRIMARY_USER_NAME?.trim() || 'Mathias';
}

/**
 * The primary user's own phone number, used when he has to be called or texted.
 *
 * Unlike a contact, a `user` target carries no number of its own, so it has to come from
 * configuration.
 */
export function getPrimaryUserPhoneNumber(): string | undefined {
  return process.env.HEY_JARVIS_PRIMARY_USER_PHONE_NUMBER?.trim() || undefined;
}

export function isUserTarget(target: NotificationTarget): target is UserTarget {
  return target.type === 'user';
}

export function isContactTarget(target: NotificationTarget): target is ContactTarget {
  return target.type === 'contact';
}

/**
 * A contact has to be reachable somehow. A contact object with neither a phone number nor an
 * email address is a caller bug, and failing here says so plainly instead of silently doing
 * nothing.
 */
export function assertContactIsReachable(contact: ContactTarget): void {
  if (!contact.phoneNumber?.trim() && !contact.email?.trim()) {
    throw new Error(
      `Contact target ${describeNotificationTarget(contact)} has neither a phone number nor an email address, so there is no way to reach them.`,
    );
  }
}

/**
 * A human-readable name for a target, for log lines and confirmation messages.
 */
export function describeNotificationTarget(target: NotificationTarget): string {
  if (isUserTarget(target)) {
    return getPrimaryUserName();
  }

  return target.name?.trim() || target.phoneNumber?.trim() || target.email?.trim() || 'an unnamed contact';
}
