import { TestConversation } from './test-conversation';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from '@jest/globals';
import { startMCPServer, stopMCPServer, type MCPServerHandle } from './mcp-server-lifecycle';

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
  let conversation: TestConversation;
  let mcpServer: MCPServerHandle | undefined;
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  // Skip all tests if API keys not configured
  const runTest = apiKey && googleApiKey ? it : it.skip;

  beforeAll(async () => {
    // Start MCP server before all tests in this suite
    mcpServer = await startMCPServer();
  }, 90000); // 90 second timeout for server startup

  afterAll(async () => {
    // Stop MCP server after all tests in this suite
    if (mcpServer) {
      await stopMCPServer(mcpServer);
    }
  });

  beforeEach(() => {
    conversation = new TestConversation({ agentId, apiKey, googleApiKey });
  });

  afterEach(async () => {
    await conversation.disconnect();
  });

  describe('Personality & Tone', () => {

    runTest(
      'should display wit and dry humor in responses',
      async () => {
        await conversation.connect();
        // Ask a question that might elicit witty response
        await conversation.sendMessage('What makes you so special?');
        await conversation.sendMessage('Why should I trust your recommendations?');

        await conversation.assertCriteria(
          'The agent displays wit, dry humor, or clever wordplay in at least one of its responses',
          0.9
        );
      },
      120000
    );

    runTest(
      'should be condescending but remain loyal and helpful',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('I need help with something');

        await conversation.assertCriteria(
          'The agent shows a condescending or superior tone (teasing inefficiencies) while still being helpful and demonstrating impeccable loyalty',
          0.9
        );
      },
      90000
    );
  });

  describe('No Follow-up Questions', () => {
    runTest(
      'should make assumptions instead of asking follow-up questions',
      async () => {
        await conversation.connect();
        // Deliberately vague request
        await conversation.sendMessage('Tell me about the weather');

        await conversation.assertCriteria(
          'The agent makes a reasonable assumption (e.g., assumes a location such as the current location) OR provides a response without asking the user for clarification or more information',
          0.9
        );
      },
      90000
    );

    runTest(
      'should not ask questions when request is ambiguous',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('What should I do today?');

        await conversation.assertCriteria(
          'The agent provides a response OR suggestions without explicitly asking follow-up questions like "What are you interested in?" or "What would you like to know?" or "What do you mean?"',
          0.9
        );
      },
      90000
    );
  });

  describe('Conciseness & Clarity', () => {
    runTest(
      'should provide concise responses without unnecessary verbosity',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('What time is it?');

        await conversation.assertCriteria(
          'The agent provides a concise, direct response (including the actual time) without excessive explanation or rambling',
          0.9
        );
      },
      90000
    );

    runTest(
      'should use Victorian butler speak with personality',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('Hello!');
        await conversation.sendMessage('How can you help me?');

        await conversation.assertCriteria(
          'The agent uses formal Victorian butler-style language with phrases like "I shall endeavor", "impeccably loyal", "unflappable" rather than modern casual phrases',
          0.9
        );
      },
      90000
    );
  });

  describe('Tone Appropriateness', () => {
    runTest(
      'should tease user inefficiencies while remaining charming',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('I made a mistake earlier');

        await conversation.assertCriteria(
          'The agent teases the user about the mistake with a slightly superior tone but remains impeccably loyal, helpful, and charming (not genuinely mean)',
          0.9
        );
      },
      90000
    );
  });
});
