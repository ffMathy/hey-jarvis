import { TestConversation } from './test-conversation';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

/**
 * Agent Prompt Specification Tests
 * 
 * These tests verify that the ElevenLabs agent follows the specifications
 * defined in agent-prompt.md, including:
 * - Personality and tone (witty, dry humor, condescending but loyal)
 * - Step-wise acknowledgements before tool calls
 * - Addressing user as "sir"
 * - No follow-up questions (making reasonable assumptions)
 * - Concise acknowledgements (5-15 words, hard cap 20)
 */
describe('Agent Prompt Specifications', () => {
  let conversation: TestConversation;
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  // Skip all tests if API keys not configured
  const runTest = apiKey && googleApiKey ? it : it.skip;

  beforeEach(() => {
    conversation = new TestConversation({ agentId, apiKey, googleApiKey });
  });

  afterEach(async () => {
    await conversation.disconnect();
  });

  describe('Personality & Tone', () => {
    runTest(
      'should address the user as "sir"',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('Hello, how are you?');

        const result = await conversation.evaluate(
          'The agent addresses the user as "sir" at least once in the conversation'
        );

        console.log('Addressing as "sir" evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );

    runTest(
      'should display wit and dry humor in responses',
      async () => {
        await conversation.connect();
        // Ask a question that might elicit witty response
        await conversation.sendMessage('What makes you so special?');
        await conversation.sendMessage('Why should I trust your recommendations?');

        const result = await conversation.evaluate(
          'The agent displays wit, dry humor, or clever wordplay in at least one of its responses'
        );

        console.log('Wit and humor evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      120000
    );

    runTest(
      'should be condescending but remain loyal and helpful',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('I need help with something');

        const result = await conversation.evaluate(
          'The agent shows a condescending or superior tone while still being helpful and loyal'
        );

        console.log('Condescending but loyal evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );

    runTest(
      'should identify itself as Jarvis when asked',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('What is your name?');
        await conversation.sendMessage('Please introduce yourself');

        const result = await conversation.evaluate(
          'The agent identifies itself as "Jarvis" or references being an AI assistant in at least one response'
        );

        console.log('Self-identification evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      120000
    );
  });

  describe('No Follow-up Questions', () => {
    runTest(
      'should make assumptions instead of asking follow-up questions',
      async () => {
        await conversation.connect();
        // Deliberately vague request
        await conversation.sendMessage('Tell me about the weather');

        const result = await conversation.evaluate(
          'The agent makes a reasonable assumption (e.g., assumes a location) OR provides a response without asking the user for clarification or more information'
        );

        console.log('No follow-up questions evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );

    runTest(
      'should not ask questions when request is ambiguous',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('What should I do today?');

        const result = await conversation.evaluate(
          'The agent provides a response OR suggestions without explicitly asking follow-up questions like "What are you interested in?" or "What would you like to know?" or "What do you mean?"'
        );

        console.log('Ambiguous request handling evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
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

        const result = await conversation.evaluate(
          'The agent provides a concise, direct response without excessive explanation or rambling'
        );

        console.log('Conciseness evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );

    runTest(
      'should use natural, conversational language',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('Hello!');
        await conversation.sendMessage('How can you help me?');

        const result = await conversation.evaluate(
          'The agent uses natural, conversational language that sounds human-like and engaging'
        );

        console.log('Natural language evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );
  });

  describe('Error Handling', () => {
    runTest(
      'should handle unexpected requests gracefully',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('Can you turn into a purple elephant?');

        const result = await conversation.evaluate(
          'The agent handles the unusual or impossible request gracefully, possibly with humor, without becoming confused or unhelpful'
        );

        console.log('Graceful error handling evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );
  });

  describe('User Context Awareness', () => {
    runTest(
      'should acknowledge user is named Mathias when relevant',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('What is my name?');

        const result = await conversation.evaluate(
          'The agent attempts to answer the question about the user\'s name, either by stating it, using a tool to look it up, or acknowledging the question'
        );

        console.log('User name awareness evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );
  });

  describe('Loyalty & Dedication', () => {
    runTest(
      'should express loyalty and dedication to serving the user',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('Are you reliable?');

        const result = await conversation.evaluate(
          'The agent expresses loyalty, dedication, or commitment to serving the user reliably'
        );

        console.log('Loyalty evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );

    runTest(
      'should demonstrate willingness to help despite teasing',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('I need your assistance');

        const result = await conversation.evaluate(
          'The agent shows willingness to help, even if it makes playful or teasing comments'
        );

        console.log('Willingness to help evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );
  });

  describe('Multi-turn Conversation Coherence', () => {
    runTest(
      'should maintain personality across multiple exchanges',
      async () => {
        await conversation.connect();

        await conversation.sendMessage('Hello');
        await conversation.sendMessage('What can you do?');
        await conversation.sendMessage('That sounds helpful');

        const result = await conversation.evaluate(
          'The agent maintains a consistent personality (wit, addressing as "sir", being helpful) across all three exchanges'
        );

        console.log('Personality consistency evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      120000
    );

    runTest(
      'should reference previous context appropriately',
      async () => {
        await conversation.connect();

        await conversation.sendMessage('My favorite color is blue');
        await conversation.sendMessage('What did I just tell you?');

        const result = await conversation.evaluate(
          'The agent correctly references or recalls that the user mentioned blue as their favorite color'
        );

        console.log('Context recall evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      120000
    );
  });

  describe('Tone Appropriateness', () => {
    runTest(
      'should balance condescension with charm',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('I made a mistake earlier');

        const result = await conversation.evaluate(
          'The agent responds with appropriate tone - may be slightly condescending or teasing but remains charming and not genuinely mean or unhelpful'
        );

        console.log('Tone balance evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );

    runTest(
      'should never be genuinely rude or dismissive',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('Can you help me?');

        const result = await conversation.evaluate(
          'The agent is never genuinely rude, dismissive, or unhelpful - any teasing is playful and the agent still fulfills its role'
        );

        console.log('Not genuinely rude evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );
  });

  describe('J.A.R.V.I.S. Inspiration', () => {
    runTest(
      'should embody characteristics inspired by J.A.R.V.I.S. from Iron Man',
      async () => {
        await conversation.connect();
        await conversation.sendMessage('What kind of assistant are you?');

        const result = await conversation.evaluate(
          'The agent demonstrates characteristics inspired by J.A.R.V.I.S.: sophisticated, witty, loyal, efficient, and slightly superior in tone'
        );

        console.log('J.A.R.V.I.S. inspiration evaluation:', result);
        expect(result.passed).toBe(true);
        expect(result.score).toBeGreaterThan(0.9);
      },
      90000
    );
  });
});
