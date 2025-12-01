import { createOllama } from 'ollama-ai-provider-v2';

/**
 * Ollama Model Manager
 *
 * Provides utilities for managing Ollama models including:
 * - Checking if models are available
 * - Lazy model pulling (pull on first use)
 * - Model status monitoring
 *
 * This module ensures that Ollama models are automatically pulled when needed,
 * providing a seamless experience even if models aren't pre-installed.
 */

// Get Ollama configuration from environment or use defaults
const ollamaHost = process.env.OLLAMA_HOST || 'localhost';
const ollamaPort = process.env.OLLAMA_PORT || '11434';
const ollamaApiBaseUrl = `http://${ollamaHost}:${ollamaPort}`;

// Track models that are currently being pulled to avoid duplicate pulls
const pullsInProgress = new Map<string, Promise<void>>();

// Track models that have been confirmed as available
const availableModels = new Set<string>();

/**
 * Response type for Ollama tags endpoint
 */
interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    modified_at?: string;
    size?: number;
  }>;
}

/**
 * Response type for Ollama pull endpoint
 */
interface OllamaPullResponse {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * Check if Ollama server is running and accessible.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaApiBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a specific model is available in Ollama.
 * @param modelName The name of the model to check (e.g., 'qwen3:0.6b')
 */
export async function isModelAvailable(modelName: string): Promise<boolean> {
  // Check cache first
  if (availableModels.has(modelName)) {
    return true;
  }

  try {
    const response = await fetch(`${ollamaApiBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return false;

    const data = (await response.json()) as OllamaTagsResponse;
    const models = data.models || [];

    // Check if model name matches (exact match or matches base name)
    const baseName = modelName.split(':')[0];
    const isAvailable = models.some((model) => model.name === modelName || model.name.startsWith(`${baseName}:`));

    if (isAvailable) {
      availableModels.add(modelName);
    }

    return isAvailable;
  } catch {
    return false;
  }
}

/**
 * Pull an Ollama model if it's not already available.
 * This function is idempotent and safe to call multiple times.
 *
 * @param modelName The name of the model to pull (e.g., 'qwen3:0.6b')
 * @returns Promise that resolves when the model is available
 */
export async function ensureModelAvailable(modelName: string): Promise<void> {
  // Check if model is already available
  if (await isModelAvailable(modelName)) {
    console.log(`✅ Ollama model ${modelName} is already available`);
    return;
  }

  // Check if a pull is already in progress
  const existingPull = pullsInProgress.get(modelName);
  if (existingPull) {
    console.log(`⏳ Waiting for ongoing pull of ${modelName}...`);
    await existingPull;
    return;
  }

  // Start a new pull
  console.log(`📥 Pulling Ollama model ${modelName}...`);
  const pullPromise = pullModel(modelName);
  pullsInProgress.set(modelName, pullPromise);

  try {
    await pullPromise;
    availableModels.add(modelName);
    console.log(`✅ Successfully pulled Ollama model ${modelName}`);
  } finally {
    pullsInProgress.delete(modelName);
  }
}

/**
 * Pull a model from Ollama registry.
 * @param modelName The name of the model to pull
 */
async function pullModel(modelName: string): Promise<void> {
  const response = await fetch(`${ollamaApiBaseUrl}/api/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: modelName, stream: false }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to pull model ${modelName}: ${response.status} ${errorText}`);
  }

  // When stream is false, Ollama returns the final status after pull completes
  // The response body contains the pull result
  const result = (await response.json()) as OllamaPullResponse;

  // A successful pull will have status 'success' at the end
  // But it might just return empty or with different status messages
  if (result.status && result.status !== 'success' && !result.digest) {
    throw new Error(`Model pull did not complete successfully: ${result.status}`);
  }
}

/**
 * List all available Ollama models.
 */
export async function listModels(): Promise<string[]> {
  try {
    const response = await fetch(`${ollamaApiBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models || []).map((model) => model.name);
  } catch {
    return [];
  }
}

/**
 * Create an Ollama provider that lazily pulls models on first use.
 * This wraps the standard Ollama provider with automatic model pulling.
 */
export function createLazyOllamaProvider() {
  const baseOllama = createOllama({
    baseURL: `${ollamaApiBaseUrl}/api`,
  });

  // Wrap the provider function to ensure model is available before use
  return function lazyOllama(modelId: string) {
    const model = baseOllama(modelId);

    // Create a proxy that intercepts method calls to ensure model is available
    return new Proxy(model, {
      get(target, prop, receiver) {
        const originalValue = Reflect.get(target, prop, receiver);

        // Intercept method calls that generate completions
        if (typeof originalValue === 'function' && (prop === 'doGenerate' || prop === 'doStream')) {
          return async (...args: unknown[]) => {
            await ensureModelAvailable(modelId);
            return (originalValue as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          };
        }

        return originalValue;
      },
    });
  };
}

/**
 * Get the Ollama API base URL.
 */
export function getOllamaApiUrl(): string {
  return ollamaApiBaseUrl;
}
