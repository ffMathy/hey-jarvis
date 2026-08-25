import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createAgent } from '../agent-factory.js';
import {
  getOllamaApiUrl,
  getOllamaBaseUrl,
  isModelAvailable,
  isOllamaAvailable,
  listModels,
  OLLAMA_MODEL,
  ollama,
  ollamaModel,
} from './ollama-provider.js';

/**
 * Everything here talks to a real Ollama instance, so it only runs when
 * HEY_JARVIS_OLLAMA_BASE_URL points at one. The offline half of this provider —
 * exports, URL helpers and connection-error handling — lives in
 * `ollama-provider.spec.ts` and runs on every push.
 */
const ollamaConfigured = Boolean(process.env.HEY_JARVIS_OLLAMA_BASE_URL);

function skipUnlessConfigured(): boolean {
  if (!ollamaConfigured) {
    console.log('Skipping: HEY_JARVIS_OLLAMA_BASE_URL is not set');
    return true;
  }
  return false;
}

describe('Ollama Provider Configuration', () => {
  it('should return correct URL values', () => {
    if (skipUnlessConfigured()) return;

    const ollamaBaseUrl = process.env.HEY_JARVIS_OLLAMA_BASE_URL;

    const baseUrl = getOllamaBaseUrl();
    const apiUrl = getOllamaApiUrl();

    expect(baseUrl).toBe(`${ollamaBaseUrl}/api`);
    expect(apiUrl).toBe(ollamaBaseUrl);
  });
});

describe('Ollama Docker Integration', () => {
  it('should connect to Ollama API', async () => {
    if (skipUnlessConfigured()) return;

    const available = await isOllamaAvailable();
    expect(available).toBe(true);

    const response = await fetch(`${getOllamaApiUrl()}/api/tags`);

    expect(response.ok).toBe(true);
    const data = (await response.json()) as { models?: unknown[] };
    expect(data).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
  });

  it('should list available models', async () => {
    if (skipUnlessConfigured()) return;

    const models = await listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  it('should check model availability using isModelAvailable', async () => {
    if (skipUnlessConfigured()) return;

    // Check for a model that definitely does not exist
    const nonExistentAvailable = await isModelAvailable('non-existent-model:v999');
    expect(nonExistentAvailable).toBe(false);
  });

  it('should generate text using ollama provider', async () => {
    if (skipUnlessConfigured()) return;

    const model = ollama(OLLAMA_MODEL);

    // LanguageModelV3 doGenerate returns a content array
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello in one word.' }] }],
    });

    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    // qwen models may return reasoning content instead of text content
    const hasContent = result.content.some(
      (c: { type: string; text?: string }) =>
        (c.type === 'text' || c.type === 'reasoning') && c.text && c.text.length > 0,
    );
    expect(hasContent).toBe(true);
  }, 120000);

  it('should verify default model is available', async () => {
    if (skipUnlessConfigured()) return;

    const modelAvailable = await isModelAvailable(OLLAMA_MODEL);
    expect(modelAvailable).toBe(true);
  });
});

describe('Ollama Mastra Agent Integration', () => {
  it('should generate a response using Mastra agent with Ollama', async () => {
    if (skipUnlessConfigured()) return;

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
    if (skipUnlessConfigured()) return;

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
    if (skipUnlessConfigured()) return;

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
  }, 90000);
});
