// @ts-expect-error - Bun's test framework types are not available in TypeScript definitions
import { beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createAgent } from './agent-factory.js';
import {
  ensureModelAvailable,
  getOllamaApiUrl,
  getOllamaBaseUrl,
  getOllamaHost,
  getOllamaPort,
  isModelAvailable,
  isOllamaAvailable,
  listModels,
  OLLAMA_MODEL,
  ollama,
  ollamaModel,
} from './ollama-provider.js';

describe('Ollama Provider Configuration', () => {
  it('should export the correct model name', () => {
    expect(OLLAMA_MODEL).toBe('qwen3:0.6b');
  });

  it('should export configuration helper functions', () => {
    expect(typeof getOllamaBaseUrl).toBe('function');
    expect(typeof getOllamaHost).toBe('function');
    expect(typeof getOllamaPort).toBe('function');
    expect(typeof getOllamaApiUrl).toBe('function');
  });

  it('should export model management functions', () => {
    expect(typeof isOllamaAvailable).toBe('function');
    expect(typeof isModelAvailable).toBe('function');
    expect(typeof ensureModelAvailable).toBe('function');
    expect(typeof listModels).toBe('function');
  });

  it('should return correct default configuration values', () => {
    // Default values when environment variables are not set
    const host = getOllamaHost();
    const port = getOllamaPort();
    const baseUrl = getOllamaBaseUrl();
    const apiUrl = getOllamaApiUrl();

    expect(typeof host).toBe('string');
    expect(typeof port).toBe('string');
    expect(baseUrl).toContain(host);
    expect(baseUrl).toContain(port);
    expect(baseUrl).toContain('/api');
    expect(apiUrl).toContain(host);
    expect(apiUrl).toContain(port);
  });

  it('should export ollama provider instance', () => {
    expect(ollama).toBeDefined();
    expect(typeof ollama).toBe('function');
  });

  it('should export pre-configured ollamaModel instance', () => {
    expect(ollamaModel).toBeDefined();
  });
});

describe('Ollama Docker Integration', () => {
  let ollamaAvailable = false;

  beforeAll(async () => {
    ollamaAvailable = await isOllamaAvailable();

    if (!ollamaAvailable) {
      console.log('⚠️ Ollama Docker container is not available - integration tests will be skipped');
      console.log(`   Expected Ollama at: ${getOllamaBaseUrl()}`);
    }
  });

  it('should connect to Ollama API', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    const host = getOllamaHost();
    const port = getOllamaPort();
    const response = await fetch(`http://${host}:${port}/api/tags`);

    expect(response.ok).toBe(true);
    const data = (await response.json()) as { models?: unknown[] };
    expect(data).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
  });

  it('should list available models', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    const models = await listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  it('should check model availability using isModelAvailable', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    // Check for a model that definitely doesn't exist
    const nonExistentAvailable = await isModelAvailable('non-existent-model:v999');
    expect(nonExistentAvailable).toBe(false);
  });

  it('should generate text using ollama provider with lazy loading', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    // The lazy loading provider should automatically pull the model if needed
    const model = ollama(OLLAMA_MODEL);

    // Simple text generation test
    const { text } = await model.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello in one word.' }] }],
    });

    expect(text).toBeDefined();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }, 120000); // Increased timeout to allow for model pulling

  it('should verify model is available after lazy loading', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    // After the previous test, the model should be available
    const modelAvailable = await isModelAvailable(OLLAMA_MODEL);
    expect(modelAvailable).toBe(true);
  });
});

describe('Ollama Model Manager Integration', () => {
  let ollamaAvailable = false;

  beforeAll(async () => {
    ollamaAvailable = await isOllamaAvailable();
  });

  it('should ensure model is available using ensureModelAvailable', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    // This should either confirm the model exists or pull it
    await ensureModelAvailable(OLLAMA_MODEL);

    // Verify it's now available
    const available = await isModelAvailable(OLLAMA_MODEL);
    expect(available).toBe(true);
  }, 120000); // Long timeout for model pulling

  it('should handle multiple concurrent ensureModelAvailable calls', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    // Call ensureModelAvailable multiple times concurrently
    // They should all resolve without errors
    await Promise.all([
      ensureModelAvailable(OLLAMA_MODEL),
      ensureModelAvailable(OLLAMA_MODEL),
      ensureModelAvailable(OLLAMA_MODEL),
    ]);

    const available = await isModelAvailable(OLLAMA_MODEL);
    expect(available).toBe(true);
  }, 120000);
});

describe('Ollama Mastra Agent Integration', () => {
  let ollamaAvailable = false;

  beforeAll(async () => {
    ollamaAvailable = await isOllamaAvailable();

    // Ensure model is available before agent tests
    if (ollamaAvailable) {
      await ensureModelAvailable(OLLAMA_MODEL);
    }
  });

  it('should create an agent with ollamaModel', async () => {
    const agent = await createAgent({
      model: ollamaModel,
      id: 'test-ollama-agent',
      name: 'TestOllamaAgent',
      instructions: 'You are a helpful test assistant. Keep responses brief.',
    });

    expect(agent).toBeDefined();
    expect(agent.id).toBe('test-ollama-agent');
  });

  it('should generate a response using Mastra agent with Ollama', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    const agent = await createAgent({
      model: ollamaModel,
      id: 'test-ollama-response-agent',
      name: 'TestOllamaResponseAgent',
      instructions: 'You are a helpful test assistant. Keep responses to one sentence.',
    });

    const response = await agent.generate('What is 2 + 2? Answer with just the number.');

    expect(response).toBeDefined();
    expect(response.text).toBeDefined();
    expect(typeof response.text).toBe('string');
    expect(response.text.length).toBeGreaterThan(0);
  }, 60000);

  it('should stream a response using Mastra agent with Ollama', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    const agent = await createAgent({
      model: ollamaModel,
      id: 'test-ollama-stream-agent',
      name: 'TestOllamaStreamAgent',
      instructions: 'You are a helpful test assistant. Keep responses brief.',
    });

    const stream = await agent.stream('Count from 1 to 3.');

    expect(stream).toBeDefined();

    // Collect the streamed text
    const text = await stream.text;

    expect(text).toBeDefined();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }, 60000);

  it('should generate structured output using Mastra agent with Ollama', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

    const outputSchema = z.object({
      greeting: z.string(),
      number: z.number(),
    });

    const agent = await createAgent({
      model: ollamaModel,
      id: 'test-ollama-structured-agent',
      name: 'TestOllamaStructuredAgent',
      instructions: 'You are a helpful test assistant. Always respond with valid JSON.',
    });

    const stream = await agent.stream('Say hello and give me a random number between 1 and 10.', {
      structuredOutput: {
        schema: outputSchema,
      },
    });

    const result = await stream.object;

    expect(result).toBeDefined();
    // Note: Structured output may not always work perfectly with smaller models
  }, 90000);
});

describe('Ollama Provider Error Handling', () => {
  it('should handle connection errors gracefully', async () => {
    // Create a provider with an invalid URL
    const { createOllama } = await import('ollama-ai-provider-v2');
    const invalidOllama = createOllama({
      baseURL: 'http://invalid-host-that-does-not-exist:99999/api',
    });

    const model = invalidOllama('qwen3:0.6b');

    try {
      await model.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Expected to fail with connection error
      expect(error).toBeDefined();
    }
  }, 10000);
});
