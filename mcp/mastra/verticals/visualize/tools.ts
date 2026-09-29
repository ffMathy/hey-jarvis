import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { markAsSlow } from '../../utils/slow-tasks.js';
import { createTool, executeTool } from '../../utils/tool-factory.js';
import { hostArtifact } from './artifact-hosting.js';
import { createArtifact, findArtifactHtml, openArtifactOnPhone } from './shortcuts.js';

/** How much of a session's answer is quoted back when it held no page, so a failure stays short. */
const MAXIMUM_QUOTED_ANSWER_LENGTH = 500;

/** The notification heading when the caller gave the page no name. */
const DEFAULT_NOTIFICATION_TITLE = 'Jarvis built something for you';

/**
 * Builds a page for a request and hands back its link, pushing it to the user's phone on the way.
 *
 * The vertical's two shortcuts, run in order: {@link createArtifact} has a Claude Code session
 * build the page, and {@link openArtifactOnPhone} sends it to the phone. In between, the page is
 * read out of the session's last message and hosted for a day by {@link hostArtifact}. It exists
 * as one tool rather than leaving the chaining to the agent because that is a job for code, not
 * for a model.
 *
 * Marked slow in its own right. The agent calls this tool, not the `createArtifact` shortcut
 * inside it, and routing only sees the tool the agent calls -- so without the mark the voice call
 * sat in silence for the minutes a build takes, instead of Jarvis offering at once to send it on
 * when it is ready (see `utils/slow-tasks.ts`).
 */
export const generateUserInterface = markAsSlow(
  createTool({
    id: 'generateUserInterface',
    description:
      "Visualize something or generate a user interface for it: a Claude Code session builds an interactive web page (an artifact), which is hosted for 24 hours, and its URL is returned. By default the URL is also pushed to the primary user's phone, so tapping the notification opens it in the phone's browser. Takes a few minutes.",
    inputSchema: z.object({
      request: z
        .string()
        .describe(
          'What to build, in full: the subject, any data the page should show, and anything the user said about how it should look. The builder sees nothing else, and cannot reach the calendar, the house or any other data of Jarvis — include it here.',
        ),
      title: z
        .string()
        .optional()
        .describe('Optional: a few words naming what is being built, e.g. "Electricity prices this week"'),
      sendToPhone: z
        .boolean()
        .optional()
        .describe(
          "Whether to push the finished page to the primary user's phone, so a tap opens it in the phone's browser. Defaults to true; set it to false only when the user is looking at a screen the link will be shown on.",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      artifactUrl: z.string().optional().describe('The HTTPS URL the page is hosted at'),
      expiresAt: z.string().optional().describe('When the link stops working, as an ISO 8601 timestamp'),
      sentToPhone: z.boolean().describe("Whether a push notification opening the page reached the user's phone"),
      message: z.string(),
    }),
    execute: async (inputData, context) => {
      const { request, title, sendToPhone = true } = inputData;

      const session = await executeTool(createArtifact, { task: request }, context);
      if (!session.success) {
        return { success: false, sentToPhone: false, message: session.message };
      }

      const answer = session.final_message ?? '';
      const html = findArtifactHtml(answer);
      if (!html) {
        return {
          success: false,
          sentToPhone: false,
          message: `The session finished without handing back a page. It said: ${
            answer.slice(0, MAXIMUM_QUOTED_ANSWER_LENGTH) || 'nothing'
          }`,
        };
      }

      let artifactUrl: string;
      let expiresAt: string;
      try {
        const hosted = await hostArtifact(html);
        artifactUrl = hosted.url;
        expiresAt = hosted.expiresAt.toISOString();
      } catch (error) {
        logger.error('[VISUALIZE] Failed to host the page', { error });

        return {
          success: false,
          sentToPhone: false,
          message: `The page was built, but hosting it failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (!sendToPhone) {
        return {
          success: true,
          artifactUrl,
          expiresAt,
          sentToPhone: false,
          message: `The page is hosted at ${artifactUrl} until ${expiresAt}.`,
        };
      }

      // The page exists either way, so a push that fails is reported next to its link rather than
      // thrown, which would lose the link along with the push.
      try {
        await executeTool(
          openArtifactOnPhone,
          {
            title: title?.trim() || DEFAULT_NOTIFICATION_TITLE,
            message: 'Tap to open it.',
            url: artifactUrl,
          },
          context,
        );

        return {
          success: true,
          artifactUrl,
          expiresAt,
          sentToPhone: true,
          message: `The page is hosted at ${artifactUrl} until ${expiresAt}, and a notification that opens it was pushed to the phone.`,
        };
      } catch (error) {
        logger.error('[VISUALIZE] Failed to push the artifact to the phone', { error });

        return {
          success: true,
          artifactUrl,
          expiresAt,
          sentToPhone: false,
          message: `The page is hosted at ${artifactUrl} until ${expiresAt}, but pushing it to the phone failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  }),
);

export const visualizeTools = {
  generateUserInterface,
};
