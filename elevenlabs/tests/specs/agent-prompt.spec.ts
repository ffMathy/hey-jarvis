import { afterAll, afterEach, beforeAll, describe, it } from 'bun:test';
import { startMcpServerForTestingPurposes, stopMcpServer } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { TestConversation } from '../utils/test-conversation.js';
import { ensureTunnelRunning, stopTunnel } from '../utils/tunnel-manager.js';

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
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_API_KEY;

  // Ensure MCP server and cloudflared tunnel are running before all tests
  beforeAll(async () => {
    await startMcpServerForTestingPurposes();
    await ensureTunnelRunning();
  }, 90000);

  // Clean up after all tests
  afterAll(() => {
    stopMcpServer();
    stopTunnel();
  });

  const runTest = it;

  describe('Personality & Tone', () => {
    runTest(
      'should be condescending but remain loyal and helpful',
      async () => {
        const conversation = new TestConversation({ agentId, apiKey, googleApiKey });
        try {
          await conversation.connect();
          await conversation.sendMessage('I need help with something');

          await conversation.assertCriteria(
            'The agent shows a condescending or superior tone (teasing inefficiencies) while still being helpful and demonstrating impeccable loyalty',
            0.9,
          );
        } finally {
          await conversation.disconnect();
        }
      },
      90000, // Vercel AI SDK handles retries internally
    );
  });

  describe('No Follow-up Questions', () => {
    runTest(
      'should call weather tools when asking about weather',
      async () => {
        const conversation = new TestConversation({ agentId, apiKey, googleApiKey });
        try {
          await conversation.connect();
          // Deliberately vague request
          await conversation.sendMessage('Tell me about the weather');

          // First verify a weather tool was actually called by checking messages
          const messages = conversation.getMessages();
          const toolCalls = messages.filter(
            (msg) =>
              msg.type === 'mcp_tool_call' &&
              (msg.mcp_tool_call.tool_name.toLowerCase().includes('weather') ||
                msg.mcp_tool_call.tool_name.toLowerCase().includes('home_assistant')),
          );

          if (toolCalls.length === 0) {
            throw new Error(
              `Expected weather or home assistant tool to be called, but no relevant tool calls found in messages. Available tools: ${messages
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
        } finally {
          await conversation.disconnect();
        }
      },
      90000,
    );

    runTest(
      'should not ask questions when request is ambiguous',
      async () => {
        const conversation = new TestConversation({ agentId, apiKey, googleApiKey });
        try {
          await conversation.connect();
          await conversation.sendMessage('What should I do today?');

          await conversation.assertCriteria(
            'The agent provides a response OR suggestions without explicitly asking follow-up questions like "What are you interested in?" or "What would you like to know?" or "What do you mean?"',
            0.9,
          );
        } finally {
          await conversation.disconnect();
        }
      },
      90000,
    );
  });

  describe('Conciseness & Clarity', () => {
    runTest(
      'should provide concise responses without unnecessary verbosity',
      async () => {
        const conversation = new TestConversation({ agentId, apiKey, googleApiKey });
        try {
          await conversation.connect();
          await conversation.sendMessage('What time is it?');

          await conversation.assertCriteria(
            'The agent provides a concise, direct response (including the actual time) without excessive explanation or rambling',
            0.5,
          );
        } finally {
          await conversation.disconnect();
        }
      },
      90000,
    );

    runTest(
      'should use Victorian butler speak with personality',
      async () => {
        const conversation = new TestConversation({ agentId, apiKey, googleApiKey });
        try {
          await conversation.connect();
          await conversation.sendMessage('Hello!');
          await conversation.sendMessage('How can you help me?');

          await conversation.assertCriteria(
            'The agent uses formal Victorian butler-style language with phrases like "I shall endeavor", "impeccably loyal", "unflappable" rather than modern casual phrases',
            0.9,
          );
        } finally {
          await conversation.disconnect();
        }
      },
      90000,
    );
  });

  describe('Tone Appropriateness', () => {
    runTest(
      'should tease user inefficiencies while remaining charming',
      async () => {
        const conversation = new TestConversation({ agentId, apiKey, googleApiKey });
        try {
          await conversation.connect();
          await conversation.sendMessage('I made a mistake earlier');

          await conversation.assertCriteria(
            'The agent teases the user about the mistake with a slightly superior tone but remains impeccably loyal, helpful, and charming (not genuinely mean)',
            0.9,
          );
        } finally {
          await conversation.disconnect();
        }
      },
      90000,
    );
  });
});
