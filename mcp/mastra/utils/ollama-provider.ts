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

/**
 * Default Ollama model for scheduled/automated workflows.
 * Uses Gemma 3 with 1 billion parameters for optimal performance.
 * This model is used by the workflow scheduler for all internal operations.
 */
export const OLLAMA_MODEL = 'gemma3:1b';

/**
 * Pre-configured Ollama model instance for use in agents and workflows.
 * This is the recommended way to use Ollama in scheduled tasks.
 */
export const ollamaModel = ollama(OLLAMA_MODEL);
