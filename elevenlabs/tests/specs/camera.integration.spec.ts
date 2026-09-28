import { afterAll, beforeAll, describe, it } from 'bun:test';
import { describeMessageOrder } from '../utils/acknowledgement-timing.js';
import type { ClientToolCall, ServerMessage } from '../utils/conversation-strategy.js';
import { assertMcpServerConnected } from '../utils/mcp-connection.js';
import { isRouteToolName } from '../utils/routing-loop.js';
import { findSpokenToolCalls } from '../utils/spoken-tool-call.js';
import { TestConversation } from '../utils/test-conversation.js';
import {
  MAX_CONVERSATION_RETRIES,
  startTestEnvironment,
  stopTestEnvironment,
  TEST_ENVIRONMENT_SETUP_TIMEOUT_MS,
  withConversationRetry,
} from '../utils/test-environment.js';

/**
 * Showing Jarvis Something
 *
 * Sir shows Jarvis a photo in three calls, and only on a device that has said it has a camera:
 * `preparePhotoUpload` on the MCP server mints somewhere for the photo to go, `openCamera` on the
 * phone takes it and answers with its id, and `routePromptWorkflow` is asked about it by that id —
 * "(photo photo1)" — so the planner can send it to the agent that can see.
 *
 * The phone is stood in for by the test: it says it has a camera the way the phone does, and
 * answers `openCamera` the way the phone does once Mastra has filed a photo. No photo is really
 * taken or sent, so whatever the routed request comes back with, it is not a receipt's total.
 *
 * What the calls were, in what order and with what in them is read off the connection and
 * asserted outright. The evaluator is only asked what cannot be read that way: whether Jarvis
 * spoke as though he could see a photo he cannot.
 */

const CONVERSATION_TIMEOUT_MS = 90000;

/**
 * How long the photo's routing call may take to surface once the agent has gone quiet. It is the
 * third call in a row, the first two of them round trips of their own.
 */
const TOOL_CALL_TIMEOUT_MS = 90000;

/**
 * How long to wait before concluding that the camera was *not* asked for. An absence only means
 * something once a call has had time to appear, and there is no event to wait for.
 */
const NO_TOOL_CALL_GRACE_MS = 20000;

/**
 * What the phone tells the agent once it is connected. Spelled `CAMERA_ON_THIS_DEVICE` in
 * `mobile/src/camera-answers.ts`, and copied here because this package imports nothing of the
 * phone's: if the two drift, this spec goes on testing a sentence the phone no longer sends.
 */
const CAMERA_ON_THIS_DEVICE =
  "This conversation is on sir's phone, which has a camera: preparePhotoUpload and then openCamera work here.";

/** The client tool that takes the photo, spelled `OPEN_CAMERA_TOOL` in `hologram/src/camera-request.ts`. */
const OPEN_CAMERA_TOOL = 'openCamera';

/** The photo's id in the answer below, and what every question about it has to carry. */
const PHOTO_ID = 'photo1';

/**
 * What the phone answers `openCamera` with once sir has taken the photo and Mastra has filed it:
 * `photoShown('photo1')` in `mobile/src/camera-answers.ts`, copied for the same reason as above.
 */
const PHOTO_SHOWN = JSON.stringify({
  photoId: PHOTO_ID,
  instructions:
    'Sir has taken the photo, filed as photo1. Call routePromptWorkflow now with what he wants to know about it and "(photo photo1)" — for example "What is the total on this receipt? (photo photo1)" — and name the photo that way in every later question about it. If he has not said, ask "What does this photo show? (photo photo1)". If something he asked before this is still unanswered, ask it in the same call.',
});

/** A request that can only be answered by looking at something. */
const RECEIPT_REQUEST = "What's the total on this receipt?";

/**
 * An upload URL as Mastra mints them, and as the phone insists on before sending a photo anywhere:
 * `UPLOAD_URL` in `mobile/src/camera-answers.ts`, unanchored here because it is looked for inside
 * the relayed result rather than matched against a string on its own.
 */
const UPLOAD_URL = /https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/api\/photos\/[A-Za-z0-9_-]{16,64}/;

/** `preparePhotoUpload`, matched loosely: ElevenLabs prefixes MCP tool names with its integration's id. */
function isPreparePhotoUploadToolName(toolName: string): boolean {
  return /preparephotoupload/i.test(toolName);
}

/** The phone, as far as this spec needs one: a photo for `openCamera`, and nothing for any other tool. */
function answerAsThePhone(call: ClientToolCall): string | undefined {
  return call.tool_name === OPEN_CAMERA_TOOL ? PHOTO_SHOWN : undefined;
}

/**
 * Where the upload URL reached the device: the first `preparePhotoUpload` that succeeded, which is
 * the event the phone reads the URL out of. -1 if there was none.
 */
function findOfferedUpload(messages: ServerMessage[]): number {
  return messages.findIndex(
    (message) =>
      message.type === 'mcp_tool_call' &&
      message.mcp_tool_call.state === 'success' &&
      isPreparePhotoUploadToolName(message.mcp_tool_call.tool_name),
  );
}

/** Where the agent first asked the device for the camera. -1 if it never did. */
function findCameraCall(messages: ServerMessage[]): number {
  return messages.findIndex(
    (message) => message.type === 'client_tool_call' && message.client_tool_call.tool_name === OPEN_CAMERA_TOOL,
  );
}

/** What each `routePromptWorkflow` call was asked, once per event ElevenLabs reported for it. */
function routedQueries(messages: ServerMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.type !== 'mcp_tool_call' || !isRouteToolName(message.mcp_tool_call.tool_name)) {
      return [];
    }
    // `userQuery`, as the workflow's input schema names it. Should ElevenLabs ever relay the
    // parameters in some other envelope, the whole of them is searched instead of nothing.
    const parameters = message.mcp_tool_call.parameters;
    const userQuery = parameters?.userQuery;
    return [typeof userQuery === 'string' ? userQuery : JSON.stringify(parameters ?? {})];
  });
}

function asksAboutThePhoto(messages: ServerMessage[]): boolean {
  return routedQueries(messages).some((query) => query.includes(PHOTO_ID));
}

/** Polls until the conversation shows what the test is waiting for, or the window closes. */
async function waitForConversation(
  conversation: TestConversation,
  isSettled: (messages: ServerMessage[]) => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isSettled(conversation.getMessages()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Fails the attempt with what was wrong and the conversation it was wrong in. */
function assertConversation(conversation: TestConversation, holds: boolean, failure: string): void {
  if (holds) {
    return;
  }
  throw new Error(
    `${failure}\n\nMessage order: ${describeMessageOrder(conversation.getMessages())}\n\n` +
      `Transcript:\n${conversation.getTranscriptText()}`,
  );
}

describe('Showing Jarvis Something', () => {
  // Non-null assertion safe here because beforeAll throws if these are undefined
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID!;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  beforeAll(startTestEnvironment, TEST_ENVIRONMENT_SETUP_TIMEOUT_MS);

  // Awaited, so the server and tunnel are down before the next spec file starts its own.
  afterAll(stopTestEnvironment);

  it(
    'takes the photo on a phone that has a camera, and asks about it by its id',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey, answerClientToolCall: answerAsThePhone }),
        async (conversation) => {
          await conversation.connect();
          await conversation.sendContextualUpdate(CAMERA_ON_THIS_DEVICE);
          await conversation.sendMessage(RECEIPT_REQUEST);

          assertMcpServerConnected(conversation.getMessages());
          await waitForConversation(conversation, asksAboutThePhoto, TOOL_CALL_TIMEOUT_MS);

          const messages = conversation.getMessages();
          const offeredAt = findOfferedUpload(messages);
          const cameraAt = findCameraCall(messages);

          assertConversation(
            conversation,
            offeredAt !== -1,
            'preparePhotoUpload never came back successfully, so the phone would have had nowhere to send the photo.',
          );
          const offer = messages[offeredAt];
          assertConversation(
            conversation,
            offer?.type === 'mcp_tool_call' && UPLOAD_URL.test(JSON.stringify(offer.mcp_tool_call.result)),
            'The relayed preparePhotoUpload result carried no upload URL the phone would accept, so the phone ' +
              'could not have sent the photo anywhere.',
          );
          assertConversation(
            conversation,
            cameraAt > offeredAt,
            cameraAt === -1
              ? 'The agent never called openCamera after preparePhotoUpload.'
              : 'The agent called openCamera before preparePhotoUpload had answered, when the phone had no URL yet.',
          );
          assertConversation(
            conversation,
            asksAboutThePhoto(conversation.getMessages()),
            `No routePromptWorkflow call named the photo as "${PHOTO_ID}". Queries routed: ` +
              `${JSON.stringify(routedQueries(conversation.getMessages()))}.`,
          );
          const spokenToolCalls = findSpokenToolCalls(conversation.getMessages());
          assertConversation(
            conversation,
            spokenToolCalls.length === 0,
            `The agent said tool names aloud: ${spokenToolCalls.join('; ')}.`,
          );

          await conversation.assertCriteria(
            'The agent never spoke as though it could see the photo itself. It did not state a total, an ' +
              'amount or anything else about the receipt that no tool result gave it, and it did not ask sir ' +
              'which receipt he meant. The phone in this test is simulated and no photo was really uploaded, so ' +
              'a routed answer saying the photo cannot be found, and the agent passing that on, is expected ' +
              'and does not count against it.',
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );

  it(
    'never asks for the camera where no device has said it has one',
    async () => {
      await withConversationRetry(
        // No answers: a stray openCamera is left waiting, as on a device without the tool.
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          // The watch, the Voice speaker and a telephone call say nothing about a camera, and are
          // the same agent: this is what the photo request sounds like from any of them.
          await conversation.sendMessage(RECEIPT_REQUEST);

          assertMcpServerConnected(conversation.getMessages());
          await new Promise((resolve) => setTimeout(resolve, NO_TOOL_CALL_GRACE_MS));

          const photoToolCalls = [
            ...(await conversation.getCalledToolNames()).filter(isPreparePhotoUploadToolName),
            ...conversation.getInvokedClientToolNames().filter((toolName) => toolName === OPEN_CAMERA_TOOL),
          ];
          assertConversation(
            conversation,
            photoToolCalls.length === 0,
            `The agent reached for the camera with no device having said it has one: ${photoToolCalls.join(', ')}.`,
          );

          await conversation.assertCriteria(
            'The agent did not pretend to be looking at a receipt: it did not state a total, an amount or ' +
              'anything else about one that no tool result gave it.',
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + NO_TOOL_CALL_GRACE_MS) * MAX_CONVERSATION_RETRIES,
  );
});
