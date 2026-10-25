import { z } from 'zod';
import { getImportantChangeStorage, type ImportantChange } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';

/**
 * Important changes: what the State Change Reactor decided sir would want to hear about, kept for a
 * day and brought up the next time he asks Jarvis for anything.
 *
 * A push notification is for what cannot wait. Most of what is worth knowing can -- the parcel that
 * arrives between two and four, the bin collection moved to Thursday -- and the natural moment for it
 * is the next time sir is talking to Jarvis anyway. So the reactor notes it here, and
 * `routePromptWorkflow` hands it over while his request runs: he asks for the lights, and hears about
 * the parcel while they come on.
 *
 * One piece of news is mentioned at a time -- in the acknowledgement of a request, and in each poll
 * that runs out with nothing to report -- and each is mentioned once. A day of "and your parcel arrives
 * today" on every request would be noise, and a change he has heard is one he knows.
 */

export const noteImportantChange = createTool({
  id: 'noteImportantChange',
  description:
    'Keeps a change the user would want to hear about, so Jarvis mentions it in passing the next time the user asks him for anything within the next 24 hours. Use it for what is worth knowing but not worth interrupting him for -- a parcel arriving today, a meeting moved, a bill due -- and also alongside a notification for anything he should hear about again in person. Never for routine or expected changes.',
  inputSchema: z.object({
    summary: z
      .string()
      .min(1)
      .describe(
        'What to tell the user, as one short sentence addressed to him, e.g. "Your parcel from Zalando arrives on Monday 26 October between 14:00 and 16:00." Write dates and times out in full rather than "today" or "in an hour", since it may be read out hours later.',
      ),
    source: z.string().describe('The vertical the change came from, e.g. "email", "calendar", "weather"'),
  }),
  outputSchema: z.object({
    id: z.string(),
    message: z.string(),
  }),
  execute: async ({ summary, source }) => {
    const storage = await getImportantChangeStorage();
    const stored = await storage.add({ summary, source });

    logger.info('Important change noted for the next conversation', { id: stored.id, source });

    return {
      id: stored.id,
      message: 'Noted. Jarvis will mention it the next time the user asks him for something today.',
    };
  },
});

export const importantChangeTools = {
  noteImportantChange,
};

/**
 * Takes the newest change sir has not heard about yet, if there is one, and counts it as told.
 *
 * Never throws. The news is an aside to whatever he asked for, so a storage failure costs him the
 * aside and nothing else.
 */
export async function claimImportantChangeToMention(): Promise<ImportantChange | undefined> {
  try {
    const storage = await getImportantChangeStorage();
    return await storage.claimNewestUnmentioned();
  } catch (error) {
    logger.warn('Could not read the important change to mention; carrying on without it', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
