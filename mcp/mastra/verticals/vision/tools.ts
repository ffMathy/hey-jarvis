import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { withRetry } from '../../utils/retry.js';
import { createTool, type ToolMastra } from '../../utils/tool-factory.js';
import { getPhotoReaderAgent, PHOTO_READER_AGENT_ID } from './agents.js';
import { findPhoto, openUploadSlot } from './photos.js';

/**
 * The client tool on sir's phone that takes the photo. The phone's own spelling is
 * `OPEN_CAMERA_TOOL` in `hologram/src/camera-request.ts`, and the agent's is in
 * `elevenlabs/src/assets/agent-config.json`.
 */
export const OPEN_CAMERA_TOOL = 'openCamera';

/** The path a photo is sent to, with its slot's token as the last part. Served by `api/routes.ts`. */
export const PHOTO_UPLOAD_PATH = '/api/photos';

/**
 * What the voice agent is told once there is somewhere to send the photo.
 *
 * Only the next step, and why it cannot skip it. The URL itself is not something to repeat: the
 * phone takes it from this very answer, which ElevenLabs relays to it, and ignores anything the
 * model might pass on — so a model talked into naming some other address cannot send sir's photo
 * there.
 */
export const PHOTO_UPLOAD_READY = `Now call ${OPEN_CAMERA_TOOL}, with no parameters: sir's phone opens its camera, sends the photo here, and hands you back the photo's id. Then ask routePromptWorkflow what he wants to know about it, naming the photo by that id.`;

/** What the voice agent is told when this server cannot say where it is. */
export const PHOTO_UPLOAD_UNAVAILABLE =
  'Photos cannot be sent to Jarvis right now: the request did not say which address it came in on. Tell sir in one short sentence.';

/** A host header's value as far as it is trusted: a name or an address, and perhaps a port. */
const HOST = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/** One header of the HTTP request an MCP tool call arrived on, if the call came over HTTP. */
function requestHeader(mcpExtra: unknown, name: string): string | undefined {
  if (typeof mcpExtra !== 'object' || mcpExtra === null || !('http' in mcpExtra)) {
    return undefined;
  }
  const { http } = mcpExtra;
  if (typeof http !== 'object' || http === null || !('req' in http)) {
    return undefined;
  }
  const { req } = http;
  if (typeof req !== 'object' || req === null || !('headers' in req) || !(req.headers instanceof Headers)) {
    return undefined;
  }
  // A proxy that was itself proxied lists every hop; the first is the one the client asked for.
  return req.headers.get(name)?.split(',')[0]?.trim() || undefined;
}

/**
 * This server's own address, as the caller of this MCP request reached it.
 *
 * **Asked of the request, not configured.** Nothing in this server knows its public hostname — the
 * Cloudflare tunnel in front of it does — and the integration tests run a server of their own
 * behind a tunnel of their own. The request ElevenLabs sent this call on names the host it was sent
 * to either way: `cloudflared` passes the original `Host` through, and says the client spoke HTTPS
 * in `X-Forwarded-Proto`. Whoever sends a different host gets a URL for it back, which is only ever
 * the one they asked with.
 */
export function publicOrigin(mcpExtra: unknown): string | undefined {
  const host = requestHeader(mcpExtra, 'x-forwarded-host') ?? requestHeader(mcpExtra, 'host');
  if (!host || !HOST.test(host)) {
    return undefined;
  }
  const protocol = requestHeader(mcpExtra, 'x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

/**
 * Makes somewhere for sir's phone to send a photo, for the voice agent to call before `openCamera`.
 *
 * Published on the MCP server only (see `mcp-server.ts`), because the URL is built from the MCP
 * request it arrives on and the slot lives in that server's memory. See `photos.ts` for the slot,
 * and `camera-request.ts` in `hologram` for the device's half.
 */
export const preparePhotoUpload = createTool({
  id: 'preparePhotoUpload',
  description: `The first step of sir showing you something with his phone's camera — a receipt, a label, a document, anything he wants you to look at. Only in a conversation where a context update has said his device has a camera. It makes somewhere for the photo to go; then call ${OPEN_CAMERA_TOOL} as its instructions say.`,
  inputSchema: z.object({}),
  outputSchema: z.object({
    uploadUrl: z
      .string()
      .optional()
      .describe("Where sir's phone sends the photo. The phone reads it from here itself."),
    instructions: z.string().describe('What to do next'),
  }),
  execute: async (_inputData, context) => {
    const origin = publicOrigin(context?.mcp?.extra);
    if (!origin) {
      return { instructions: PHOTO_UPLOAD_UNAVAILABLE };
    }

    const { uploadToken } = openUploadSlot();
    return { uploadUrl: `${origin}${PHOTO_UPLOAD_PATH}/${uploadToken}`, instructions: PHOTO_UPLOAD_READY };
  },
});

/** What {@link lookAtPhoto} answers when there is nothing to look at. */
export const NO_PHOTO_TO_LOOK_AT =
  'There is no photo to look at: none has been shown in the last half hour. Sir can show one with the camera on his phone.';

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

    return { answer: `Photo ${photo.photoId} shows: «${reading.text.trim()}»` };
  },
});

export const visionTools = {
  lookAtPhoto,
};
