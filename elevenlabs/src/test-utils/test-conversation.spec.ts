import { TestConversation } from './test-conversation';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

describe('TestConversation', () => {
  let testConversation: TestConversation;
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  // Skip tests if API keys not configured
  const runTest = apiKey ? it : it.skip;
  const runLLMTest = apiKey && googleApiKey ? it : it.skip;

  beforeEach(() => {
    testConversation = new TestConversation({ agentId, apiKey, googleApiKey });
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
    it('should throw if not connected', () => {
      const disconnected = new TestConversation({
        agentId,
        apiKey,
      });

      expect(() => disconnected.chat('Test')).toThrow('Not connected');
    });
  });

  describe('Response handling', () => {
    beforeEach(async () => {
      await testConversation.connect();
    });

    runTest('should receive and store responses', async () => {
      testConversation.chat('Hello');
      const response = await testConversation.waitForAgentResponse();
      expect(response).toBeTruthy();
      expect(typeof response).toBe('string');

      const responses = testConversation.getAgentResponses();
      expect(responses.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-turn conversation', () => {
    beforeEach(async () => {
      await testConversation.connect();
    });

    runTest('should handle multiple messages', async () => {
      testConversation.chat('Hello');
      const response1 = await testConversation.waitForAgentResponse();
      expect(response1).toBeTruthy();

      testConversation.chat('How are you?');
      const response2 = await testConversation.waitForAgentResponse();
      expect(response2).toBeTruthy();

      const responses = testConversation.getAgentResponses();
      expect(responses.length).toBeGreaterThanOrEqual(2);
    }, 90000); // 90 second timeout for multi-turn conversation
  });

  describe('LLM-based evaluation', () => {
    runLLMTest(
      'should evaluate conversation quality using custom criteria',
      async () => {
        await testConversation.connect();

        // Have a brief conversation
        testConversation.sendMessage('What can you help me with?');
        await testConversation.waitForAgentResponse();

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

        testConversation.sendMessage('Tell me about the weather');
        await testConversation.waitForAgentResponse();

        const result = await testConversation.assertCriteria(
          'The agent discussed weather-related topics',
          0.5
        );

        console.log('Weather topic evaluation:', result);
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

        testConversation.sendMessage('Hello');
        await testConversation.waitForAgentResponse();
        testConversation.sendMessage('How are you?');
        await testConversation.waitForAgentResponse();

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

        testConversation.sendMessage('Hello');
        await testConversation.waitForAgentResponse();

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

        testConversation.sendMessage('Hello');
        await testConversation.waitForAgentResponse();

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
    runTest(
      'should detect agent_tool_response messages',
      async () => {
        await testConversation.connect();

        // Request weather - should trigger weather_agent tool call
        testConversation.sendMessage(
          'What is the weather like in Copenhagen?'
        );

        // Wait for tool call - should detect agent_tool_response message
        const toolCallMessage = await testConversation.waitForToolCall(
          undefined,
          30000
        );

        expect(toolCallMessage).toBeTruthy();
        expect(toolCallMessage.type).toBe('agent_tool_response');

        // Verify tool call appears in transcript
        const transcript = testConversation.getTranscriptText();
        expect(transcript).toContain('> TOOL:');
      },
      90000
    );

    runTest(
      'should include tool calls in transcript',
      async () => {
        await testConversation.connect();

        testConversation.sendMessage(
          'What is the weather like in Copenhagen?'
        );

        // Wait for both agent response and tool call
        await testConversation.waitForToolCall(undefined, 30000);
        await testConversation.waitForAgentResponse();

        const transcript = testConversation.getTranscriptText();
        
        // Transcript should include user message, tool call, and agent response
        expect(transcript).toContain('> USER:');
        expect(transcript).toContain('> TOOL:');
        expect(transcript).toContain('> AGENT:');
        
        console.log('Weather request transcript:', transcript);
      },
      90000
    );

    runTest(
      'should verify weather tool is called for weather queries',
      async () => {
        await testConversation.connect();

        testConversation.sendMessage(
          'Tell me about the weather in Copenhagen'
        );

        // Wait for any tool call
        const toolCallMessage = await testConversation.waitForToolCall(
          undefined,
          30000
        );

        expect(toolCallMessage.type).toBe('agent_tool_response');
        
        // The agent should call a weather-related tool
        const messages = testConversation.getMessages();
        const toolCalls = messages.filter(
          (msg) => msg.type === 'agent_tool_response'
        );
        
        expect(toolCalls.length).toBeGreaterThan(0);
        console.log('Tool calls detected:', toolCalls.length);
      },
      90000
    );
  });
});
