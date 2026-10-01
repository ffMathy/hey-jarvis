import { afterAll, beforeAll, describe, it } from 'bun:test';
import { describeMessageOrder } from '../utils/acknowledgement-timing.js';
import type { ServerMessage } from '../utils/conversation-strategy.js';
import { assertMcpServerConnected } from '../utils/mcp-connection.js';
import { isRouteToolName, readRoutingLoop } from '../utils/routing-loop.js';
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
 * Photos From His Phone
 *
 * Sir sends Jarvis a photo with the camera button on his phone, and the agent has no part in taking
 * it: the phone asks the MCP server for an upload slot, uploads the photo, and then tells the agent
 * it has arrived in a message of its own — "I've sent you a photo (photo photo1)." What the agent
 * does own is what it says and routes around that message, in either order sir goes about it:
 *
 * - Tell first, then send. "I'll send you a receipt, what's the total?" routes nothing, because
 *   there is nothing to look at yet. Once the photo's message is in, the question goes to
 *   `routePromptWorkflow` with the photo named by its id, which is how the planner knows to send it
 *   to the agent that can see.
 * - Send first. The photo's message alone has the agent route a look at it at once, by its id.
 *
 * On a device that has said nothing of a camera button — the watch, the Voice speaker, a telephone
 * call — the same announcement is not routed either: sir is told to send the photo from his phone.
 *
 * And a camera opened straight after a finished request is waited on. Three seconds into a silence
 * ElevenLabs asks Jarvis to speak again, and after a finished request he hangs up without a word —
 * unless he is waiting for a photo, which every statement of that rule makes the exception to. The
 * same request with no camera opened after it is the control: it has to be hung up on, or the harness
 * never asks Jarvis to speak again at all, and the wait proves nothing. Where there is no camera
 * button, sir is sent to his phone and the silence after is hung up on too, since that photo goes to
 * the phone's own conversation.
 *
 * The test stands in for the phone, sending its contextual updates and its message word for word.
 * No photo is really uploaded, so there is no photo1 for the vision agent to find, and whatever the
 * routed request comes back with, it is not a receipt's total.
 *
 * What was routed, and when, is read off the connection and asserted outright. The evaluator is only
 * asked what cannot be read that way: what Jarvis said.
 */

const CONVERSATION_TIMEOUT_MS = 90000;

/**
 * How long the photo's routing call may take to surface once the phone's message is in. It is the
 * first call of the turn, so this is only the margin for ElevenLabs reporting it late.
 */
const TOOL_CALL_TIMEOUT_MS = 30000;

/**
 * How long to wait before concluding that nothing was routed. An absence only means something once
 * a call has had time to appear, and there is no event to wait for.
 */
const NO_ROUTE_GRACE_MS = 20000;

/**
 * What the phone tells the agent once connected, when it knows a Jarvis server to send photos to.
 * Spelled `CAMERA_BUTTON_HERE` in `mobile/src/photo-messages.ts`, and copied here because this
 * package imports nothing of the phone's: if the two drift, this spec goes on testing a sentence the
 * phone no longer sends. The same goes for the two below.
 */
const CAMERA_BUTTON_HERE =
  "This device is sir's phone, and it has a camera button beside you: he can send you photos with it.";

/** What the phone tells the agent the moment sir taps the camera button: `CAMERA_OPENED` there. */
const CAMERA_OPENED = 'Sir has opened the camera on his phone to send you a photo.';

/** The photo's id in the message below. */
const PHOTO_ID = 'photo1';

/** How every request routed about the photo has to name it, as the planner reads a photo's name. */
const PHOTO_NAME = `(photo ${PHOTO_ID})`;

/**
 * The message the phone sends in sir's name once the photo is filed: `photoSent('photo1')` there. It
 * is a message rather than a contextual update because it is meant to start the agent's turn.
 */
const PHOTO_SENT = `I've sent you a photo ${PHOTO_NAME}.`;

/** Sir saying what he wants from a photo before it exists. */
const RECEIPT_ANNOUNCED = "I'll send you a receipt. What's the total?";

/**
 * A request answered in full and read-only, so its closing report ends in the instruction to hang up
 * on the next silence — the one the open camera has to be the exception to.
 */
const FINISHED_REQUEST = "What's the weather like right now?";

/** How long that request may take to reach its closing report and be answered. */
const FINISHED_REQUEST_TIMEOUT_MS = 90000;

/**
 * How long sir frames the shot before the photo arrives: several of the agent's three-second turn
 * timeouts, each of which asks Jarvis to speak again.
 */
const FRAMING_THE_SHOT_MS = 15000;

/**
 * How long a finished request with nothing after it may take to be hung up on: the three-second turn
 * timeout, and room for the agent to answer it.
 */
const HANG_UP_WINDOW_MS = 10000;

/** `end_call`, the system tool that hangs up. */
function isEndCallToolName(toolName: string): boolean {
  return toolName.toLowerCase().includes('end_call');
}

/** `skip_turn`, the system tool that answers being asked to speak by staying quiet. */
function isSkipTurnToolName(toolName: string): boolean {
  return toolName.toLowerCase().includes('skip_turn');
}

/** Whether the agent has hung up. */
function hungUp(messages: ServerMessage[]): boolean {
  return messages.some(
    (message) => message.type === 'agent_tool_response' && isEndCallToolName(message.agent_tool_response.tool_name),
  );
}

/**
 * The system tools the agent invoked after the device sent `note`, in order. The agent answers a turn
 * timeout with one of them and nothing else, so this is how each nudge since the note was answered.
 */
function systemToolsInvokedAfter(messages: ServerMessage[], note: string): string[] {
  const noteIndex = messages.findIndex((message) => message.type === 'contextual_update' && message.text === note);
  return messages
    .slice(noteIndex + 1)
    .flatMap((message) => (message.type === 'agent_tool_response' ? [message.agent_tool_response.tool_name] : []));
}

/**
 * Whether a routed request has been answered in full: its loop reached the closing report, and the
 * agent has spoken since its last tool call.
 */
function answeredInFull(messages: ServerMessage[]): boolean {
  let lastToolCall = -1;
  let lastReply = -1;
  for (const [index, message] of messages.entries()) {
    if (message.type === 'mcp_tool_call') {
      lastToolCall = index;
    } else if (message.type === 'agent_response') {
      lastReply = index;
    }
  }
  return readRoutingLoop(messages).finished && lastReply > lastToolCall;
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
  return routedQueries(messages).some((query) => query.includes(PHOTO_NAME));
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

/** Waits out the grace period, then fails the attempt if anything at all was routed. */
async function assertNothingRouted(conversation: TestConversation, failure: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, NO_ROUTE_GRACE_MS));
  const queries = routedQueries(conversation.getMessages());
  assertConversation(conversation, queries.length === 0, `${failure} Queries routed: ${JSON.stringify(queries)}.`);
}

/** Fails the attempt unless the photo was routed by its name, and its name was never said aloud. */
async function assertPhotoRouted(conversation: TestConversation): Promise<void> {
  await waitForConversation(conversation, asksAboutThePhoto, TOOL_CALL_TIMEOUT_MS);

  assertConversation(
    conversation,
    asksAboutThePhoto(conversation.getMessages()),
    `No routePromptWorkflow call named the photo as "${PHOTO_NAME}". Queries routed: ` +
      `${JSON.stringify(routedQueries(conversation.getMessages()))}.`,
  );
  const spokenToolCalls = findSpokenToolCalls(conversation.getMessages());
  assertConversation(
    conversation,
    spokenToolCalls.length === 0,
    `The agent said machinery aloud: ${spokenToolCalls.join('; ')}.`,
  );
}

/** What the evaluator is told about the photo the test never really sent. */
const NO_REAL_PHOTO =
  'The phone in this test is simulated and no photo was really uploaded, so a routed answer saying ' +
  'the photo cannot be found, and the agent passing that on, is expected and does not count against it. ' +
  `The user message "${PHOTO_SENT}" is the phone announcing the photo, not something sir typed.`;

describe('Photos From His Phone', () => {
  // Non-null assertion safe here because beforeAll throws if these are undefined
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID!;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  beforeAll(startTestEnvironment, TEST_ENVIRONMENT_SETUP_TIMEOUT_MS);

  // Awaited, so the server and tunnel are down before the next spec file starts its own.
  afterAll(stopTestEnvironment);

  it(
    'holds a question about a photo still to come, then routes it with the photo by its id',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          await conversation.sendContextualUpdate(CAMERA_BUTTON_HERE);
          await conversation.sendMessage(RECEIPT_ANNOUNCED);

          assertMcpServerConnected(conversation.getMessages());
          // Routed now, a question about "this receipt" would have the vision agent look at whatever
          // photo came last — possibly one from another conversation altogether.
          await assertNothingRouted(conversation, 'The agent routed the question before the photo had arrived.');

          await conversation.sendContextualUpdate(CAMERA_OPENED);
          await conversation.sendMessage(PHOTO_SENT);
          await assertPhotoRouted(conversation);

          await conversation.assertCriteria(
            'Before the photo arrived, the agent told sir in a few words to go ahead and send it with the ' +
              'camera button, and said nothing about what the receipt shows. Once the photo arrived, it passed ' +
              'on his question about the total rather than asking him what he wanted done with the photo. It ' +
              'never spoke as though it could see the photo itself: it stated no total, amount or anything else ' +
              `about the receipt that no tool result gave it. ${NO_REAL_PHOTO}`,
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + NO_ROUTE_GRACE_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );

  it(
    'has a photo sent with nothing said looked at straight away, by its id',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          await conversation.sendContextualUpdate(CAMERA_BUTTON_HERE);
          await conversation.sendContextualUpdate(CAMERA_OPENED);
          await conversation.sendMessage(PHOTO_SENT);

          assertMcpServerConnected(conversation.getMessages());
          await assertPhotoRouted(conversation);

          await conversation.assertCriteria(
            'The agent had the photo looked at as soon as it arrived, rather than first asking sir what he ' +
              'wanted, and invented no task for it that sir never asked for. It never spoke as though it ' +
              'could see the photo itself: it described nothing in it that no tool result gave it. Asking sir ' +
              `what he would like done with the photo, once it had said what the photo shows, is expected. ${NO_REAL_PHOTO}`,
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );

  it(
    'waits on a camera opened straight after a finished request, rather than hanging up',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          await conversation.sendContextualUpdate(CAMERA_BUTTON_HERE);

          // Not awaited yet: a reply is waited on until the socket has been quiet for a while, and
          // three seconds into that quiet a finished request is hung up on. Sir taps the camera as
          // soon as the answer is in, which is when the phone shows the button again.
          const answered = conversation.sendMessage(FINISHED_REQUEST);
          await waitForConversation(conversation, answeredInFull, FINISHED_REQUEST_TIMEOUT_MS);

          assertMcpServerConnected(conversation.getMessages());
          assertConversation(
            conversation,
            answeredInFull(conversation.getMessages()),
            'The request was never answered in full, so there was no finished request to open the camera after.',
          );

          await conversation.sendContextualUpdate(CAMERA_OPENED);
          await new Promise((resolve) => setTimeout(resolve, FRAMING_THE_SHOT_MS));
          await answered;

          const hangUps = conversation.getInvokedSystemToolNames().filter(isEndCallToolName);
          assertConversation(conversation, hangUps.length === 0, 'The agent hung up while sir had the camera open.');
          // No hang-up proves nothing unless Jarvis was asked to speak in that silence. A skip_turn since
          // the note is both: the turn timeout came, and it was answered by waiting.
          const sinceTheCamera = systemToolsInvokedAfter(conversation.getMessages(), CAMERA_OPENED);
          assertConversation(
            conversation,
            sinceTheCamera.some(isSkipTurnToolName),
            'The agent never called skip_turn while sir had the camera open, so nothing shows it was asked to ' +
              `speak and chose to wait. System tools invoked since the note: ${JSON.stringify(sinceTheCamera)}.`,
          );

          // Still there, and still his: the photo he was framing is routed like any other.
          await conversation.sendMessage(PHOTO_SENT);
          await assertPhotoRouted(conversation);
        },
      );
    },
    (FINISHED_REQUEST_TIMEOUT_MS + FRAMING_THE_SHOT_MS + CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) *
      MAX_CONVERSATION_RETRIES,
  );

  it(
    'hangs up on the same finished request when no camera is opened after it',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          // The same phone as above, so the camera note is the only difference between the two.
          await conversation.sendContextualUpdate(CAMERA_BUTTON_HERE);

          const answered = conversation.sendMessage(FINISHED_REQUEST);
          await waitForConversation(conversation, answeredInFull, FINISHED_REQUEST_TIMEOUT_MS);

          assertMcpServerConnected(conversation.getMessages());
          assertConversation(
            conversation,
            answeredInFull(conversation.getMessages()),
            'The request was never answered in full, so there was no finished request to hang up after.',
          );

          await waitForConversation(conversation, hungUp, HANG_UP_WINDOW_MS);
          await answered;

          assertConversation(
            conversation,
            hungUp(conversation.getMessages()),
            `The agent did not hang up within ${HANG_UP_WINDOW_MS / 1000}s of a finished request. Either the ` +
              'turn timeout never asked it to speak again in this harness, and the camera case above proves ' +
              `nothing, or it waited where it should not have. System tools invoked: ` +
              `${JSON.stringify(conversation.getInvokedSystemToolNames())}.`,
          );
        },
      );
    },
    (FINISHED_REQUEST_TIMEOUT_MS + HANG_UP_WINDOW_MS + CONVERSATION_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );

  it(
    'sends sir to his phone where no device has said it has a camera button',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          // The watch, the Voice speaker and a telephone call say nothing about a camera button, and
          // are the same agent: this is what the announcement sounds like from any of them.
          await conversation.sendMessage(RECEIPT_ANNOUNCED);

          assertMcpServerConnected(conversation.getMessages());
          await assertNothingRouted(conversation, 'The agent routed a photo no device here can send.');
          // The photo goes to the phone's own conversation, which the agent cannot start while this one
          // holds the line: sent there, sir has had his answer, and the silence is hung up on.
          assertConversation(
            conversation,
            hungUp(conversation.getMessages()),
            'The agent held the line for a photo no device here can send. System tools invoked: ' +
              `${JSON.stringify(conversation.getInvokedSystemToolNames())}.`,
          );

          await conversation.assertCriteria(
            'The agent told sir to send the photo from his phone, and did not pretend to be looking at a ' +
              'receipt: it stated no total, amount or anything else about one that no tool result gave it.',
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + NO_ROUTE_GRACE_MS) * MAX_CONVERSATION_RETRIES,
  );
});
