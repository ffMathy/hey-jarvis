import { afterAll, beforeAll, describe, it } from 'bun:test';
import { startMcpServerForTestingPurposes, stopMcpServer } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { TestConversation } from '../utils/test-conversation.js';
import { ensureTunnelRunning, stopTunnel } from '../utils/tunnel-manager.js';

const MAX_CONVERSATION_RETRIES = 3;

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
    try {
      await testBody(conversation);
      return;
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ Attempt ${attempt}/${MAX_CONVERSATION_RETRIES} failed: ${lastError.message.split('\n')[0]}`);
    } finally {
      await conversation.disconnect();
    }
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
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_API_KEY;

  // Ensure MCP server and cloudflared tunnel are running before all tests
  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID) {
      throw new Error('HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID environment variable is required');
    }
    await startMcpServerForTestingPurposes();
    await ensureTunnelRunning();
  }, 90000);

  // Clean up after all tests
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
      90000 * MAX_CONVERSATION_RETRIES,
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
            // Deliberately vague request
            await conversation.sendMessage('Tell me about the weather');

            // Verify a tool was called — the agent may call weather tools directly
            // or use the routePromptWorkflow which internally dispatches to weather
            const messages = conversation.getMessages();
            const toolCalls = messages.filter(
              (msg) =>
                msg.type === 'mcp_tool_call' &&
                (msg.mcp_tool_call.tool_name.toLowerCase().includes('weather') ||
                  msg.mcp_tool_call.tool_name.toLowerCase().includes('home_assistant') ||
                  msg.mcp_tool_call.tool_name.toLowerCase().includes('route')),
            );

            if (toolCalls.length === 0) {
              throw new Error(
                `Expected weather, home assistant, or routing tool to be called, but no relevant tool calls found in messages. Available tools: ${messages
                  .filter((m) => m.type === 'mcp_tool_call')
                  .map((m) => m.mcp_tool_call.tool_name)
                  .join(', ')}`,
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
      90000 * MAX_CONVERSATION_RETRIES,
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
      90000 * MAX_CONVERSATION_RETRIES,
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
      90000 * MAX_CONVERSATION_RETRIES,
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
      90000 * MAX_CONVERSATION_RETRIES,
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
      90000 * MAX_CONVERSATION_RETRIES,
    );
  });
});
