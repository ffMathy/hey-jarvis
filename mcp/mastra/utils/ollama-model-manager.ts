import os from 'node:os';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { createOllama } from 'ollama-ai-provider-v2';

/**
 * Ollama Model Manager
 *
 * Provides utilities for managing Ollama models including:
 * - Checking if models are available
 * - Lazy model pulling (pull on first use)
 * - Model status monitoring
 * - Request logging with timing information
 * - CPU usage limiting via num_thread
 *
 * This module ensures that Ollama models are automatically pulled when needed,
 * providing a seamless experience even if models aren't pre-installed.
 */

// Get Ollama configuration from environment or use defaults
const ollamaHost = process.env.OLLAMA_HOST || 'localhost';
const ollamaPort = process.env.OLLAMA_PORT || '11434';
const ollamaApiBaseUrl = `http://${ollamaHost}:${ollamaPort}`;

/**
 * Get the number of CPU threads to use for Ollama inference.
 * Defaults to 50% of available CPU cores to prevent system overload.
 * Can be overridden via OLLAMA_NUM_THREADS environment variable.
 */
function getOllamaNumThreads(): number {
  const envThreads = process.env.OLLAMA_NUM_THREADS;
  if (envThreads) {
    const parsed = Number.parseInt(envThreads, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const cpuCount = os.cpus().length;
  return Math.max(1, Math.floor(cpuCount / 2));
}

/**
 * Request body type for Ollama API calls
 */
interface OllamaRequestBody {
  model?: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: {
    num_thread?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Extracts URL string from various input types.
 */
function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Parses and modifies the request body to inject num_thread option.
 */
function processRequestBody(
  init: RequestInit | undefined,
  numThreads: number,
): { requestBody: OllamaRequestBody | null; modifiedInit: RequestInit | undefined } {
  if (!init?.body || typeof init.body !== 'string') {
    return { requestBody: null, modifiedInit: init };
  }

  try {
    const requestBody = JSON.parse(init.body) as OllamaRequestBody;
    requestBody.options = {
      ...requestBody.options,
      num_thread: numThreads,
    };

    return {
      requestBody,
      modifiedInit: {
        ...init,
        body: JSON.stringify(requestBody),
      },
    };
  } catch {
    return { requestBody: null, modifiedInit: init };
  }
}

/**
 * Logs the start of an inference call.
 */
function logInferenceStart(
  modelName: string,
  method: string,
  url: string,
  promptPreview: string | null,
  numThreads: number,
): void {
  console.log(`🤖 [OLLAMA] Starting inference call`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Endpoint: ${method} ${url}`);
  if (promptPreview) {
    console.log(`   Prompt: ${promptPreview}`);
  }
  console.log(`   Threads: ${numThreads}`);
}

/**
 * Logs the successful completion of an inference call.
 */
function logInferenceSuccess(modelName: string, duration: number, status: number, statusText: string): void {
  console.log(`✅ [OLLAMA] Inference completed in ${duration}ms`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Status: ${status} ${statusText}`);
}

/**
 * Logs a failed inference call.
 */
function logInferenceError(modelName: string, duration: number, errorMessage: string): void {
  console.error(`❌ [OLLAMA] Inference failed after ${duration}ms`);
  console.error(`   Model: ${modelName}`);
  console.error(`   Error: ${errorMessage}`);
}

/**
 * Creates a logging fetch wrapper that logs all Ollama API calls with timing information
 * and injects CPU thread limiting options.
 */
function createLoggingFetch(): FetchFunction {
  const numThreads = getOllamaNumThreads();
  console.log(`🔧 Ollama configured to use ${numThreads} CPU threads (of ${os.cpus().length} available)`);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now();
    const url = extractUrl(input);
    const method = init?.method || 'GET';

    const { requestBody, modifiedInit } = processRequestBody(init, numThreads);

    const modelName = requestBody?.model || 'unknown';
    const promptPreview = extractPromptPreview(requestBody);
    const isInferenceCall = url.includes('/chat') || url.includes('/generate');

    if (isInferenceCall) {
      logInferenceStart(modelName, method, url, promptPreview, numThreads);
    }

    try {
      const response = await fetch(input, modifiedInit);
      const duration = Date.now() - startTime;

      if (isInferenceCall) {
        logInferenceSuccess(modelName, duration, response.status, response.statusText);
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isInferenceCall) {
        logInferenceError(modelName, duration, errorMessage);
      }

      throw error;
    }
  };
}

/**
 * Extracts a preview of the prompt from the request body for logging.
 * Truncates long prompts to avoid log flooding.
 */
function extractPromptPreview(body: OllamaRequestBody | null): string | null {
  if (!body) return null;

  const maxLength = 100;

  if (body.prompt) {
    const prompt = body.prompt;
    return prompt.length > maxLength ? `${prompt.substring(0, maxLength)}...` : prompt;
  }

  if (body.messages && body.messages.length > 0) {
    const lastMessage = body.messages[body.messages.length - 1];
    if (lastMessage?.content) {
      const content = lastMessage.content;
      return content.length > maxLength ? `${content.substring(0, maxLength)}...` : content;
    }
  }

  return null;
}

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

  // When stream is false, Ollama returns the final status after pull completes.
  // The response format depends on the Ollama version:
  // - Newer versions may return: {"status": "success"} or {"digest": "sha256:..."}
  // - Some versions return empty object {} when model is already present
  // We consider the pull successful if:
  // 1. HTTP status was 200 OK (already checked above)
  // 2. Either status is 'success' OR we got a digest (indicates download complete)
  const result = (await response.json()) as OllamaPullResponse;

  // Only fail if we got an explicit non-success status without a digest
  // A missing status or empty response is acceptable (model may already exist)
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
 * This wraps the standard Ollama provider with automatic model pulling,
 * request logging with timing information, and CPU thread limiting.
 */
export function createLazyOllamaProvider() {
  const loggingFetch = createLoggingFetch();

  const baseOllama = createOllama({
    baseURL: `${ollamaApiBaseUrl}/api`,
    fetch: loggingFetch,
  });

  // Wrap the provider function to ensure model is available before use
  return function lazyOllama(modelId: string) {
    const model = baseOllama(modelId);

    // Methods that initiate model inference and need the model to be available.
    // These are the standard LanguageModelV2 interface methods from the AI SDK.
    // If the ollama-ai-provider-v2 library changes these method names, this code
    // will need to be updated accordingly.
    const inferenceMethodNames = new Set(['doGenerate', 'doStream']);

    // Create a proxy that intercepts method calls to ensure model is available
    return new Proxy(model, {
      get(target, prop, receiver) {
        const originalValue = Reflect.get(target, prop, receiver);

        // Intercept method calls that generate completions
        if (typeof originalValue === 'function' && typeof prop === 'string' && inferenceMethodNames.has(prop)) {
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
