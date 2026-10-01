import { asFacts, createDirectLookup } from '../../utils/direct-lookup-factory.js';
import { findEmails } from './tools.js';

/**
 * "Any new emails?" answered without the agent: the unread mail in the inbox, newest first.
 *
 * Sender and subject only. The preview can run to hundreds of characters per email, and a spoken
 * answer to this question is who wrote and about what. Like the agent's call, it reports the inbox
 * as what it read.
 */

/** The most emails a lookup reports. */
const MAX_EMAILS = 10;

export const emailLookups = [
  createDirectLookup({
    id: 'email.unread',
    agentId: 'email',
    description: 'Whether there are new or unread emails, and who they are from',
    answer: async (callTool) => {
      const { emails } = await callTool(findEmails, { folder: 'inbox', isRead: false, limit: MAX_EMAILS });
      return asFacts({
        unreadShown: emails.length,
        emails: emails.map(({ from, subject, receivedDateTime }) => ({
          from: from.name || from.address,
          subject,
          receivedDateTime,
        })),
      });
    },
  }),
];
