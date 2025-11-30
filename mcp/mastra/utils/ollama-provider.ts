import { createOllama } from 'ollama-ai-provider-v2';

/**
 * Creates an Ollama provider instance for local LLM inference.
 *
 * This provider connects to the local Ollama server running in the container.
 * The server runs on port 11434 by default and serves models like Gemma 3.
 *
 * Uses ollama-ai-provider-v2 which is compatible with AI SDK v5 (LanguageModelV2).
 * This ensures compatibility with Mastra's .stream() method.
 *
 * Environment variables:
 * - OLLAMA_HOST: The host where Ollama is running (default: localhost)
 * - OLLAMA_PORT: The port Ollama is listening on (default: 11434)
 */

// Get Ollama configuration from environment or use defaults
const ollamaHost = process.env.OLLAMA_HOST || 'localhost';
const ollamaPort = process.env.OLLAMA_PORT || '11434';
const ollamaBaseUrl = `http://${ollamaHost}:${ollamaPort}/api`;

// Create and export the configured Ollama provider instance
export const ollama = createOllama({
  baseURL: ollamaBaseUrl,
});
