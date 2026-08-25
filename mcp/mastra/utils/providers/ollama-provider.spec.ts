import { describe, expect, it } from 'bun:test';
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
 * The offline half of the Ollama provider: what it exports, and how it behaves
 * when nothing answers. Everything that needs a real Ollama instance lives in
 * `ollama-provider.integration.spec.ts`.
 */
describe('Ollama Provider Configuration', () => {
  it('should export the correct model name', () => {
    expect(OLLAMA_MODEL).toBe(process.env.OLLAMA_MODEL ?? 'qwen2.5-instruct:1.5b');
  });

  it('should export configuration helper functions', () => {
    expect(typeof getOllamaBaseUrl).toBe('function');
    expect(typeof getOllamaApiUrl).toBe('function');
  });

  it('should export model management functions', () => {
    expect(typeof isOllamaAvailable).toBe('function');
    expect(typeof isModelAvailable).toBe('function');
    expect(typeof listModels).toBe('function');
  });

  it('should export ollama provider instance', () => {
    expect(ollama).toBeDefined();
    expect(typeof ollama).toBe('function');
  });

  it('should export pre-configured ollamaModel instance', () => {
    expect(ollamaModel).toBeDefined();
  });
});

describe('Ollama Mastra Agent Construction', () => {
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
});

describe('Ollama Provider Error Handling', () => {
  it('should handle connection errors gracefully', async () => {
    // Point at a closed port on loopback rather than an unresolvable hostname.
    // A bogus hostname makes the test hostage to DNS: under WSL an NXDOMAIN takes
    // ~20s to come back, so the connection never fails within the 10s budget and
    // the test times out instead of asserting. Loopback needs no DNS and refuses
    // immediately (~2ms), while still producing the connection error under test.
    const { createOllama } = await import('ai-sdk-ollama');
    const invalidOllama = createOllama({
      baseURL: 'http://127.0.0.1:9',
    });

    const model = invalidOllama('qwen3:0.6b');

    // Expected to fail with a connection error
    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      }),
    ).rejects.toBeDefined();
  }, 10000);
});
