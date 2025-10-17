import { ElevenLabsConversationClient } from './websocket-client';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

describe('ElevenLabsConversationClient', () => {
  let client: ElevenLabsConversationClient;
  const agentId =
    process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;

  // Skip all tests if API key not configured
  const runTest = apiKey ? it : it.skip;

  beforeEach(() => {
    client = new ElevenLabsConversationClient({ agentId, apiKey });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe('Connection', () => {
    runTest('should connect', async () => {
      await expect(client.connect()).resolves.not.toThrow();
    });
  });

  describe('Messaging', () => {
    it('should throw if not connected', async () => {
      const disconnected = new ElevenLabsConversationClient({
        agentId,
        apiKey,
      });

      await expect(disconnected.chat('Test')).rejects.toThrow(
        'Not connected'
      );
    });
  });

  describe('Response handling', () => {
    beforeEach(async () => {
      await client.connect();
    });

    runTest('should receive and store responses', async () => {
      const response = await client.chat('Hello');
      expect(response).toBeTruthy();
      expect(typeof response).toBe('string');

      const responses = client.getAgentResponses();
      expect(responses.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-turn conversation', () => {
    beforeEach(async () => {
      await client.connect();
    });

    runTest('should handle multiple messages', async () => {
      const response1 = await client.chat('Hello');
      expect(response1).toBeTruthy();

      // const response2 = await client.chat('How are you?');
      // expect(response2).toBeTruthy();

      const responses = client.getAgentResponses();
      expect(responses.length).toBe(2);
    });
  });
});
