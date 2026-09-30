import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { withRetry } from '../../utils/retry.js';
import { createTool, type ToolMastra } from '../../utils/tool-factory.js';
import { getPhotoReaderAgent, PHOTO_READER_AGENT_ID } from './agents.js';
import { findPhoto, howLongAgo, markPhotoLookedAt } from './photos.js';

/** What {@link lookAtPhoto} answers when there is nothing to look at. */
export const NO_PHOTO_TO_LOOK_AT =
  'There is no such photo to look at: photos are kept for half an hour, and a question that names none only means one shown in the last few minutes. Sir can send one with the camera button on his phone.';

/**
 * The photo reader, as registered on this Mastra instance — or a fresh one, where there is none.
 *
 * Registered so its calls are traced like every other agent's; built on the spot when a caller
 * has no Mastra to ask, as the routing planner is.
 */
async function resolvePhotoReader(mastra: ToolMastra | undefined): Promise<Agent> {
  try {
    const registered = mastra?.getAgentById(PHOTO_READER_AGENT_ID);
    if (registered) {
      return registered;
    }
  } catch {
    // Not registered: build one below.
  }
  return getPhotoReaderAgent();
}

/**
 * Looks at a photo sir has shown Jarvis and answers a question about it.
 *
 * **The only way an agent here sees a photo.** A routed agent is handed text and nothing else
 * (`routing/plan.ts`), so the photo is fetched by its id inside this tool and shown to the photo
 * reader, a model that can see, beside the question. What it reads is handed back *as the photo's
 * content*, quoted, because text in a photo is written by whoever made the thing photographed — a
 * flyer, a letter, a sign — and must reach the agents after this one as something to report, never
 * as something to do.
 *
 * **A reading is what stops a photo waiting** (see `photosWaiting` in `photos.ts`). Only once the
 * reader has answered: a reading that failed has told sir nothing about his photo, so it is still
 * worth bringing up.
 */
export const lookAtPhoto = createTool({
  id: 'lookAtPhoto',
  description:
    "Looks at a photo sir took with his phone's camera and answers a question about it: reading a receipt's total, a label, a document or a screen, or saying what something is.",
  inputSchema: z.object({
    photoId: z
      .string()
      .optional()
      .describe('The photo\'s id exactly as the request gave it, such as "photo3". Leave it out for the latest photo.'),
    question: z.string().describe('What to find out from the photo, as a complete question.'),
  }),
  outputSchema: z.object({
    answer: z.string().describe("What the photo shows that answers the question, quoted as the photo's content"),
  }),
  execute: async ({ photoId, question }, context) => {
    const photo = findPhoto(photoId);
    if (!photo) {
      return { answer: NO_PHOTO_TO_LOOK_AT };
    }

    const reader = await resolvePhotoReader(context?.mastra);
    const reading = await withRetry(
      () =>
        reader.generate([
          {
            role: 'user',
            content: [
              { type: 'image', image: photo.data, mediaType: photo.mediaType },
              { type: 'text', text: question },
            ],
          },
        ]),
      { label: 'lookAtPhoto' },
    );
    markPhotoLookedAt(photo.photoId);

    // Its age too, so the agent reading this can tell a photo just taken from one shown earlier.
    return {
      answer: `Photo ${photo.photoId}, taken ${howLongAgo(Date.now() - photo.keptAt)}, shows: «${reading.text.trim()}»`,
    };
  },
});

export const visionTools = {
  lookAtPhoto,
};
