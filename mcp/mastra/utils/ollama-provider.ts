import {
  createLazyOllamaProvider,
  ensureModelAvailable,
  getOllamaApiUrl,
  isModelAvailable,
  isOllamaAvailable,
  listModels,
} from './ollama-model-manager.js';

/**
 * Creates an Ollama provider instance for local LLM inference.
 *
 * This provider connects to the local Ollama server running in the container.
 * The server runs on port 11434 by default and serves models like Qwen3.
 *
 * Uses ollama-ai-provider-v2 which is compatible with AI SDK v5 (LanguageModelV2).
 * This ensures compatibility with Mastra's .stream() method.
 *
 * **Lazy Model Loading**: Models are automatically pulled on first use if not already available.
 * This provides a seamless experience even if models aren't pre-installed.
 *
 * Environment variables:
 * - OLLAMA_HOST: The host where Ollama is running (default: localhost)
 * - OLLAMA_PORT: The port Ollama is listening on (default: 11434)
 */

// Get Ollama configuration from environment or use defaults
const ollamaHost = process.env.OLLAMA_HOST || 'localhost';
const ollamaPort = process.env.OLLAMA_PORT || '11434';
const ollamaBaseUrl = `http://${ollamaHost}:${ollamaPort}/api`;

/**
 * Ollama provider with lazy model loading.
 * Models are automatically pulled on first use if not already available.
 */
export const ollama = createLazyOllamaProvider();

/**
 * Default Ollama model for scheduled/automated workflows.
 * Uses Qwen3 with 0.6 billion parameters for optimal performance.
 * This model is used by the workflow scheduler for all internal operations.
 */
export const OLLAMA_MODEL = 'qwen3:0.6b';

/**
 * Pre-configured Ollama model instance for use in agents and workflows.
 * This is the recommended way to use Ollama in scheduled tasks.
 * Models are automatically pulled on first use if not available.
 */
export const ollamaModel = ollama(OLLAMA_MODEL);

/**
 * Get the Ollama base URL for health checks and API calls.
 */
export function getOllamaBaseUrl(): string {
  return ollamaBaseUrl;
}

/**
 * Get the Ollama host configuration.
 */
export function getOllamaHost(): string {
  return ollamaHost;
}

/**
 * Get the Ollama port configuration.
 */
export function getOllamaPort(): string {
  return ollamaPort;
}

// Re-export model manager functions for convenience
export { ensureModelAvailable, getOllamaApiUrl, isModelAvailable, isOllamaAvailable, listModels };
