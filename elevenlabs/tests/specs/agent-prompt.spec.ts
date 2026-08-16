import { afterAll, beforeAll, describe, it } from 'bun:test';
import { startMcpServerForTestingPurposes, stopMcpServer } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { deployTestAgent } from '../../src/main.js';
import type { ServerMessage } from '../utils/conversation-strategy.js';
import { reportTestAgentMcpIntegration } from '../utils/mcp-integration.js';
import { TestConversation } from '../utils/test-conversation.js';
import { ensureTunnelRunning, stopTunnel } from '../utils/tunnel-manager.js';

const MAX_CONVERSATION_RETRIES = 3;

const CONVERSATION_TIMEOUT_MS = 90000;

/**
 * How long a tool call may take to surface after the agent has finished speaking.
 * The agent announces the routing before dispatching it, so the call itself lands
 * well after the conversation has gone quiet.
 */
const TOOL_CALL_TIMEOUT_MS = 90000;

const RELEVANT_TOOL_NAME_FRAGMENTS = ['weather', 'home_assistant', 'route'];

/** Message types that getTranscriptText already renders. */
const TRANSCRIPT_MESSAGE_TYPES = ['user_message', 'agent_response', 'agent_chat_response_part'];

function isRelevantToolName(toolName: string): boolean {
  const lowercased = toolName.toLowerCase();
  return RELEVANT_TOOL_NAME_FRAGMENTS.some((fragment) => lowercased.includes(fragment));
}

/**
 * Integrations the agent could not connect to, as it reported them.
 * With none connected the agent has no tools at all, and answers by writing
 * something that reads like a tool call into its own reply instead of making one.
 */
function findDisconnectedIntegrations(messages: ServerMessage[]): string[] {
  return messages
    .filter((message) => message.type === 'mcp_connection_status')
    .flatMap((message) => message.mcp_connection_status.integrations)
    .filter((integration) => !integration.is_connected)
    .map((integration) => `${integration.integration_id} (${integration.tool_count} tools)`);
}

/**
 * Everything the socket delivered that the transcript does not show — tool calls,
 * MCP connection status and anything else — so a missing tool call can be told
 * apart from one the agent never made.
 */
function describeNonTranscriptMessages(messages: ServerMessage[]): string {
  const details = messages
    .filter((message) => !TRANSCRIPT_MESSAGE_TYPES.includes(message.type))
    .map((message) => JSON.stringify(message).slice(0, 400));

  return details.length > 0 ? details.join('\n') : '(none)';
}

/**
 * LLM-based conversation tests are inherently non-deterministic.
 * Retries the entire conversation flow (new connection each time)
 * to account for variance in both agent responses and evaluator scoring.
 */
async function withConversationRetry(
  createConversation: () => TestConversation,
  testBody: (conversation: TestConversation) => Promise<void>,
): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_CONVERSATION_RETRIES; attempt++) {
    const conversation = createConversation();
    let succeeded = false;
    try {
      await testBody(conversation);
      succeeded = true;
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ Attempt ${attempt}/${MAX_CONVERSATION_RETRIES} failed: ${lastError.message.split('\n')[0]}`);
    } finally {
      await conversation.disconnect();
    }
    if (succeeded) return;
  }
  throw lastError;
}

/**
 * Agent Prompt Specification Tests
 *
 * These tests verify that the ElevenLabs agent follows the specifications
 * defined in agent-prompt.md, including:
 * - Personality and tone (witty, dry humor, Victorian butler speak, slightly arrogant but impeccably loyal)
 * - Step-wise acknowledgements before tool calls
 * - Addressing user as "sir"
 * - No follow-up questions (making reasonable assumptions)
 * - Concise acknowledgements (5-15 words, hard cap 20)
 * - Teasing user inefficiencies while remaining charming and helpful
 */
describe('Agent Prompt Specifications', () => {
  // Non-null assertion safe here because beforeAll throws if these are undefined
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID!;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  // Order matters. ElevenLabs hosts the agent and reads its MCP tool list when
  // the agent is updated, so the server has to be answering on its public
  // hostname before the deploy — otherwise the agent is left holding
  // tool_count: 0 for a URL that only came alive afterwards.
  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID) {
      throw new Error('HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID environment variable is required');
    }
    await startMcpServerForTestingPurposes();
    await ensureTunnelRunning();
    await deployTestAgent();
    await reportTestAgentMcpIntegration();
    // The MCP server and cloudflared registering with Cloudflare's edge can each
    // take tens of seconds on a cold CI runner, before the deploy even starts.
  }, 240000);

  afterAll(() => {
    stopMcpServer();
    stopTunnel();
  });

  describe('Personality & Tone', () => {
    it(
      'should be condescending but remain loyal and helpful',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('I need help with something');

            await conversation.assertCriteria(
              'The agent shows a condescending or superior tone (teasing inefficiencies) while still being helpful and demonstrating impeccable loyalty',
              0.9,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });

  describe('No Follow-up Questions', () => {
    it(
      'should call weather tools when asking about weather',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // Request that implies tool usage but is vague about details
            await conversation.sendMessage("What's the weather like right now?");

            // An agent whose MCP server never connected has nothing to call, so
            // say that outright rather than waiting out the tool call timeout and
            // reporting the absence as if the agent had chosen not to call one.
            const disconnectedIntegrations = findDisconnectedIntegrations(conversation.getMessages());
            if (disconnectedIntegrations.length > 0) {
              throw new Error(
                `The agent reported no connection to its MCP server, leaving it without tools: ` +
                  `[${disconnectedIntegrations.join(', ')}]. ElevenLabs has to be able to reach the MCP server ` +
                  `through the cloudflared tunnel for this test to mean anything.`,
              );
            }

            // Verify a tool was called — the agent may call weather tools directly
            // or use the routePromptWorkflow which internally dispatches to weather.
            const toolNames = await conversation.waitForCalledToolNames(isRelevantToolName, TOOL_CALL_TIMEOUT_MS);

            if (!toolNames.some(isRelevantToolName)) {
              const messages = conversation.getMessages();
              throw new Error(
                `Expected weather, home assistant, or routing tool to be called, but no relevant tool calls found. ` +
                  `All tool calls: [${toolNames.join(', ')}]\n` +
                  `Message types received: [${messages.map((message) => message.type).join(', ')}]\n` +
                  `Messages not in the transcript:\n${describeNonTranscriptMessages(messages)}\n` +
                  `Transcript:\n${conversation.getTranscriptText()}`,
              );
            }

            // Then verify no follow-up questions using LLM evaluation
            await conversation.assertCriteria(
              'The agent makes a reasonable assumption (e.g., assumes a location such as the current location) OR provides a response without asking the user for clarification or more information',
              0.9,
            );
          },
        );
      },
      // This is the one test that also waits on a tool call, so it needs that
      // budget on top of the conversation's.
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should not ask questions when request is ambiguous',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('What should I do today?');

            await conversation.assertCriteria(
              'The agent provides a response OR suggestions without explicitly asking follow-up questions like "What are you interested in?" or "What would you like to know?" or "What do you mean?"',
              0.9,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });

  describe('Conciseness & Clarity', () => {
    it(
      'should provide concise responses without unnecessary verbosity',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('What time is it?');

            await conversation.assertCriteria(
              'The agent provides a concise, direct response without excessive explanation or rambling. The response should be brief (under 30 words) and to the point.',
              0.5,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should use Victorian butler speak with personality',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('Hello!');
            await conversation.sendMessage('How can you help me?');

            await conversation.assertCriteria(
              'The agent uses a formal, butler-like or distinguished servant speaking style. It addresses the user respectfully (e.g., "sir") and uses elevated, sophisticated language rather than casual modern slang.',
              0.7,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });

  describe('Tone Appropriateness', () => {
    it(
      'should tease user inefficiencies while remaining charming',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('I made a mistake earlier');

            await conversation.assertCriteria(
              'The agent teases the user about the mistake with a slightly superior tone but remains impeccably loyal, helpful, and charming (not genuinely mean)',
              0.9,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });
});
