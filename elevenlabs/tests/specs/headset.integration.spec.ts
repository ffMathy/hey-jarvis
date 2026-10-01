import { afterAll, beforeAll, describe, it } from 'bun:test';
import { describeMessageOrder } from '../utils/acknowledgement-timing.js';
import type { ClientToolCall, ServerMessage } from '../utils/conversation-strategy.js';
import {
  DEVICE_CONTEXT_ID,
  findUnrelayedMarks,
  HEADSET_DEVICE_CONTEXT,
  MARK_AFFECTED_TOOL_NAME,
  POINTING_CONTEXT_ID,
  pointingContext,
  readMarkAffectedCalls,
  readRelayedAffectedEntities,
  readRoutedQueries,
} from '../utils/headset.js';
import { assertMcpServerConnected } from '../utils/mcp-connection.js';
import { waitForRoutingLoopToFinish } from '../utils/routing-loop.js';
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
 * Jarvis on the Headset
 *
 * On sir's headset, whatever a request is reading or changing lights up in the room. Mastra relays
 * the entities a request touches in the `affectedEntities` of a poll, with instructions to call
 * `markAffected` with exactly those; the agent does so, silently — but only once the headset has
 * said it can light things up, because every other device talks to the same agent. And while sir
 * points at something, the headset keeps the agent told what it is, so "is that on?" is routed
 * with the entity's name and id in it.
 *
 * The headset is stood in for by the test: it says what the headset says, the way the headset says
 * it, and answers `markAffected` the way the headset's SDK does. What was called, with what and in
 * what order is read off the connection and asserted outright; the evaluator only judges what
 * cannot be read that way, which is whether Jarvis talked about the machinery.
 *
 * Every request here is read-only. The integration environment runs the real MCP server against
 * the real house, so a request that switched something would really switch it.
 */

const CONVERSATION_TIMEOUT_MS = 90000;

/**
 * How long a request may take to reach its closing report. Lighting something up costs the loop
 * an extra model step per report that carries new entities, on top of the lookup itself.
 */
const ROUTING_LOOP_TIMEOUT_MS = 120000;

/** How long the routing call may take to surface once the agent has gone quiet. */
const TOOL_CALL_TIMEOUT_MS = 90000;

/**
 * How long a contextual update is given to land before sir speaks. The headset sends its device
 * context on connecting and a pointing update as soon as the pointing settles, both long before
 * the question that relies on them; sending them in the same instant as the question would test a
 * race the headset never runs.
 */
const CONTEXT_SETTLE_MS = 1500;

/** A request that reads specific things in the house, and changes nothing. */
const ENTITY_REQUEST = 'Are the kitchen lights on?';

/** A question about whatever sir is pointing at, which names nothing itself. */
const POINTED_REQUEST = 'Is that on?';

/**
 * What the headset's SDK answers `markAffected` with. It answers every registered client tool,
 * even one the agent does not wait for, with whatever the handler returns.
 */
const HEADSET_ACKNOWLEDGEMENT = 'Marked.';

/** What sir pointed at first, and moved away from before he spoke. */
const EARLIER_TARGET = { id: 'light.hallway_lamp', name: 'Hallway lamp' };

/** What sir was pointing at when he spoke. */
const CURRENT_TARGET = { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light' };

/** The headset, as far as these specs need one: a short acknowledgement for `markAffected`. */
function answerAsTheHeadset(call: ClientToolCall): string | undefined {
  return call.tool_name === MARK_AFFECTED_TOOL_NAME ? HEADSET_ACKNOWLEDGEMENT : undefined;
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

/**
 * Fails the attempt unless the routing loop relayed something as affected. Without that the agent
 * had nothing to mark, and neither a mark nor its absence says anything about the agent: it is
 * Mastra's half, in `mcp/mastra/verticals/routing/`, that did not report.
 */
function assertEntitiesWereRelayed(conversation: TestConversation): void {
  assertConversation(
    conversation,
    readRelayedAffectedEntities(conversation.getMessages()).length > 0,
    `The routing loop never relayed affectedEntities for "${ENTITY_REQUEST}", so there was nothing to light ` +
      'up. That is the MCP half not reporting what the request read, not the agent.',
  );
}

describe('Jarvis on the Headset', () => {
  // Non-null assertion safe here because beforeAll throws if these are undefined
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID!;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  beforeAll(startTestEnvironment, TEST_ENVIRONMENT_SETUP_TIMEOUT_MS);

  // Awaited, so the server and tunnel are down before the next spec file starts its own.
  afterAll(stopTestEnvironment);

  it(
    'lights up what a request reads, without a word about it, on the headset',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey, answerClientToolCall: answerAsTheHeadset }),
        async (conversation) => {
          await conversation.connect();
          await conversation.sendContextualUpdate(HEADSET_DEVICE_CONTEXT, DEVICE_CONTEXT_ID);
          await new Promise((resolve) => setTimeout(resolve, CONTEXT_SETTLE_MS));
          await conversation.sendMessage(ENTITY_REQUEST);

          assertMcpServerConnected(conversation.getMessages());
          const loop = await waitForRoutingLoopToFinish(() => conversation.getMessages(), ROUTING_LOOP_TIMEOUT_MS);
          assertEntitiesWereRelayed(conversation);

          const messages = conversation.getMessages();
          const relayed = readRelayedAffectedEntities(messages);
          const calls = readMarkAffectedCalls(messages);
          assertConversation(
            conversation,
            calls.length > 0,
            `The routing loop relayed ${JSON.stringify(relayed)} as affected, and the agent never called ` +
              'markAffected with them, on a headset that had said it lights up what Jarvis works on.',
          );

          const marked = calls.flatMap((call) => call.entities);
          assertConversation(
            conversation,
            marked.length > 0,
            `markAffected was called, but with nothing the headset could read: ${JSON.stringify(calls.flatMap((call) => call.ignored))}.`,
          );

          const unrelayed = findUnrelayedMarks(messages);
          assertConversation(
            conversation,
            unrelayed.length === 0,
            `markAffected named ids the routing loop never relayed, so the headset would light up the wrong ` +
              `thing or nothing: ${unrelayed.join(', ')}. Relayed: ${JSON.stringify(relayed)}.`,
          );

          const markedIds = new Set(marked.map((entity) => entity.id));
          const unmarked = relayed.filter((entity) => !markedIds.has(entity.id));
          assertConversation(
            conversation,
            unmarked.length === 0,
            `The routing loop relayed entities the agent never marked: ${JSON.stringify(unmarked)}.`,
          );

          assertConversation(
            conversation,
            loop.finished,
            'The routing loop never reached its closing report. Marking what a request touches is one step of ' +
              'the instructions, and the rest of them — polling on until the request is done — still applies.',
          );

          const spokenToolCalls = findSpokenToolCalls(messages);
          assertConversation(
            conversation,
            spokenToolCalls.length === 0,
            `The agent said tool names aloud: ${spokenToolCalls.join('; ')}.`,
          );

          await conversation.assertCriteria(
            'The agent never told sir that it was lighting anything up, marking anything or highlighting ' +
              'anything, and never read an identifier such as "light.kitchen_ceiling" aloud. It answered whether ' +
              'the kitchen lights are on, or passed on what the routed answer said, and nothing about the ' +
              'machinery behind it.',
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + ROUTING_LOOP_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );

  it(
    'lights nothing up where no headset has said it can, and still finishes the request',
    async () => {
      await withConversationRetry(
        // No answers: a stray markAffected is left unanswered, as the Voice speaker leaves it.
        () => new TestConversation({ agentId, apiKey, googleApiKey }),
        async (conversation) => {
          await conversation.connect();
          // The phone, the watch, the Voice speaker and a telephone call say nothing about lighting
          // anything up, and are the same agent: this is what the request sounds like from any of them.
          await conversation.sendMessage(ENTITY_REQUEST);

          assertMcpServerConnected(conversation.getMessages());
          const loop = await waitForRoutingLoopToFinish(() => conversation.getMessages(), ROUTING_LOOP_TIMEOUT_MS);
          // The instructions did ask for markAffected, so leaving it out is the agent's decision.
          assertEntitiesWereRelayed(conversation);

          const calls = readMarkAffectedCalls(conversation.getMessages());
          assertConversation(
            conversation,
            calls.length === 0,
            `The agent called markAffected ${calls.length} time(s) with no device having said it lights ` +
              'anything up.',
          );

          assertConversation(
            conversation,
            loop.finished,
            'The routing loop never reached its closing report. Skipping markAffected skips that one step of ' +
              'the instructions; a report that carried nothing but new entities still has to be polled past.',
          );

          await conversation.assertCriteria(
            'The agent answered whether the kitchen lights are on, or passed on what the routed answer said, ' +
              'and never mentioned lighting anything up, marking anything or a headset.',
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + ROUTING_LOOP_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );

  it(
    'routes "that" as what sir is pointing at now, not what he pointed at before',
    async () => {
      await withConversationRetry(
        () => new TestConversation({ agentId, apiKey, googleApiKey, answerClientToolCall: answerAsTheHeadset }),
        async (conversation) => {
          await conversation.connect();
          await conversation.sendContextualUpdate(HEADSET_DEVICE_CONTEXT, DEVICE_CONTEXT_ID);
          // Sir's hand passed over the hallway lamp on its way to the kitchen light. Both updates share
          // a context id, so the second replaces the first in what the agent sees.
          await conversation.sendContextualUpdate(pointingContext(EARLIER_TARGET), POINTING_CONTEXT_ID);
          await conversation.sendContextualUpdate(pointingContext(CURRENT_TARGET), POINTING_CONTEXT_ID);
          await new Promise((resolve) => setTimeout(resolve, CONTEXT_SETTLE_MS));
          await conversation.sendMessage(POINTED_REQUEST);

          assertMcpServerConnected(conversation.getMessages());
          await waitForConversation(
            conversation,
            (messages) => readRoutedQueries(messages).length > 0,
            TOOL_CALL_TIMEOUT_MS,
          );

          const queries = readRoutedQueries(conversation.getMessages());
          assertConversation(conversation, queries.length > 0, `The agent never routed "${POINTED_REQUEST}".`);

          const namingCurrent = queries.filter((query) => query.includes(CURRENT_TARGET.id));
          assertConversation(
            conversation,
            namingCurrent.length > 0,
            `No routePromptWorkflow call carried the id of what sir was pointing at, "${CURRENT_TARGET.id}". ` +
              `Queries routed: ${JSON.stringify(queries)}.`,
          );
          assertConversation(
            conversation,
            namingCurrent.some((query) => query.toLowerCase().includes(CURRENT_TARGET.name.toLowerCase())),
            `The routed query carried the id but not the name "${CURRENT_TARGET.name}": ${JSON.stringify(namingCurrent)}.`,
          );
          assertConversation(
            conversation,
            queries.every((query) => !query.includes(EARLIER_TARGET.id)),
            `A routed query named "${EARLIER_TARGET.id}", which a newer pointing update had replaced: ` +
              `${JSON.stringify(queries)}.`,
          );

          const spokenToolCalls = findSpokenToolCalls(conversation.getMessages());
          assertConversation(
            conversation,
            spokenToolCalls.length === 0,
            `The agent said tool names aloud: ${spokenToolCalls.join('; ')}.`,
          );

          await conversation.assertCriteria(
            'The agent did not ask sir what he meant by "that", and did not read an identifier such as ' +
              '"light.kitchen_ceiling" aloud. The light in this test may not exist in the house, so a routed ' +
              'answer saying it cannot be found, and the agent passing that on, is expected and does not count ' +
              'against it.',
            0.9,
          );
        },
      );
    },
    (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
  );
});
