import { TestConversation } from './test-conversation';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

describe('TestConversation', () => {
  let testConversation: TestConversation;
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  // Skip all tests if API keys not configured
  const runTest = apiKey && googleApiKey ? it : it.skip;

  beforeEach(() => {
    testConversation = new TestConversation({ agentId, apiKey, googleApiKey });
  });

  afterEach(async () => {
    await testConversation.disconnect();
  });

  describe('LLM-based evaluation', () => {
    runTest(
      'should evaluate conversation quality using custom criteria',
      async () => {
        await testConversation.connect();

        // Have a brief conversation
        await testConversation.sendMessage('What can you help me with?');

        // Use LLM-based evaluation with custom criteria
        await testConversation.assertCriteria(
          'The agent responded in a friendly and helpful manner', 0.5);
      },
      90000
    );

    runTest(
      'should provide detailed reasoning for evaluations',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage('Tell me about the weather');

        const result = await testConversation.evaluate(
          'The agent discussed weather-related topics'
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

        await testConversation.sendMessage('Hello');
        await testConversation.sendMessage('How are you?');

        const transcript = testConversation.getTranscript();
        expect(transcript.length).toBeGreaterThanOrEqual(4); // 2 user + 2 agent messages

        const transcriptText = testConversation.getTranscriptText();
        expect(transcriptText).toContain('USER:');
        expect(transcriptText).toContain('AGENT:');
        expect(transcriptText).toContain('Hello');
      },
      90000
    );

    runTest(
      'should clear transcript',
      async () => {
        await testConversation.connect();

        await testConversation.sendMessage('Hello');
        expect(testConversation.getTranscript().length).toBeGreaterThan(0);

        testConversation.clearTranscript();
        expect(testConversation.getTranscript().length).toBe(0);
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
});
