import { TestConversation } from './test-conversation';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { startMCPServer, stopMCPServer, type MCPServerHandle } from './mcp-server-lifecycle';

describe('TestConversation', () => {
  let testConversation: TestConversation;
  let mcpServer: MCPServerHandle | undefined;

  // Helper function to get required environment variable
  const getRequiredEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  const agentId = getRequiredEnv('HEY_JARVIS_ELEVENLABS_AGENT_ID');
  const apiKey = getRequiredEnv('HEY_JARVIS_ELEVENLABS_API_KEY');
  const googleApiKey = getRequiredEnv('HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY');

  // Skip tests if API keys not configured
  const runTest = apiKey ? it : it.skip;
  const runLLMTest = apiKey && googleApiKey ? it : it.skip;

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
    testConversation = new TestConversation({
      agentId,
      apiKey,
      googleApiKey,
    });
  });

  afterEach(async () => {
    await testConversation.disconnect();
  });

  describe('Connection', () => {
    runTest('should connect', async () => {
      await expect(testConversation.connect()).resolves.not.toThrow();
    });
  });

  describe('Messaging', () => {
    it('should throw if not connected', async () => {
      const disconnected = new TestConversation({
        agentId,
        apiKey,
      });

      await expect(disconnected.sendMessage('Test')).rejects.toThrow('Not connected');
    });
  });

  describe('Response handling', () => {
    beforeEach(async () => {
      await testConversation.connect();
    });

    runTest('should receive and store responses', async () => {
      const response = await testConversation.sendMessage('Hello');
      expect(response).toBeTruthy();
      expect(typeof response).toBe('string');

      const responses = testConversation.getMessages();
      expect(responses.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-turn conversation', () => {
    beforeEach(async () => {
      await testConversation.connect();
    });

    runTest('should handle multiple messages', async () => {
      const response1 = await testConversation.sendMessage('Hello');
      expect(response1).toBeTruthy();

      const response2 = await testConversation.sendMessage('How are you?');
      expect(response2).toBeTruthy();

      const responses = testConversation.getMessages();
      expect(responses.length).toBeGreaterThanOrEqual(2);
    }, 90000); // 90 second timeout for multi-turn conversation
  });

  describe('LLM-based evaluation', () => {
    runLLMTest(
      'should evaluate conversation quality using custom criteria',
      async () => {
        await testConversation.connect();

        // Have a brief conversation
        await testConversation.sendMessage('What can you help me with?');

        // Use LLM-based evaluation with custom criteria
        await testConversation.assertCriteria(
          'The agent responded in a friendly and helpful manner',
          0.5
        );
      },
      90000
    );

    runLLMTest(
      'should provide detailed reasoning for evaluations',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage('Tell me about the weather');

        const result = await testConversation.assertCriteria(
          'The agent discussed weather-related topics',
          0.5
        );

        expect(result.reasoning).toBeTruthy();
        expect(typeof result.reasoning).toBe('string');
        expect(result.reasoning.length).toBeGreaterThan(10);
      },
      90000
    );
  });

  describe('Transcript management', () => {
    runTest(
      'should track conversation transcript',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage('Hello');
        await testConversation.sendMessage('How are you?');

        const messages = testConversation.getMessages();
        expect(messages.length).toBeGreaterThanOrEqual(2); // At least 2 agent responses

        const transcriptText = testConversation.getTranscriptText();
        expect(transcriptText).toContain('AGENT:');
        expect(transcriptText.length).toBeGreaterThan(0);
      },
      90000
    );
  });

  describe('Assertion helpers', () => {
    runTest(
      'should throw error when criteria not met',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage('Hello');

        // This should fail because the agent likely didn't discuss quantum physics
        await expect(
          testConversation.assertCriteria(
            'The agent provided detailed quantum physics explanations',
            0.8
          )
        ).rejects.toThrow(/failed to meet criteria/i);
      },
      90000
    );

    runTest(
      'should pass when criteria is met',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage('Hello');

        // This should pass - the agent likely greeted the user
        const result = await testConversation.assertCriteria(
          'The agent acknowledged or greeted the user',
          0.5
        );

        expect(result.passed).toBe(true);
      },
      90000
    );
  });

  describe('Tool call detection', () => {
    // Tool calls only work with ElevenLabs in CI, not with local Gemini strategy
    const runToolTest = apiKey && process.env.GITHUB_ACTIONS === 'true' ? it : it.skip;

    runToolTest(
      'should include tool calls in transcript',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage(
          'What is the weather like in Copenhagen?'
        );

        // Wait for both agent response and tool call
        const transcript = testConversation.getTranscriptText();

        // Transcript should include user message, tool call, and agent response
        expect(transcript).toContain('> USER:');
        expect(transcript).toContain('> TOOL:');
        expect(transcript).toContain('> AGENT:');
      },
      90000
    );
  });
});
