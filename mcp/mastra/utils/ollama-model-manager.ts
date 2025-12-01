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
 * - Request queue for serial processing to prevent Ollama overload
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
 * Response type for Ollama API inference calls
 */
interface OllamaInferenceResponse {
  model?: string;
  response?: string;
  done?: boolean;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
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
 * Creates a new object to avoid mutating the original request body.
 */
function processRequestBody(
  init: RequestInit | undefined,
  numThreads: number,
): { requestBody: OllamaRequestBody | null; modifiedInit: RequestInit | undefined } {
  if (!init?.body || typeof init.body !== 'string') {
    return { requestBody: null, modifiedInit: init };
  }

  try {
    const parsedBody = JSON.parse(init.body) as OllamaRequestBody;
    const modifiedBody: OllamaRequestBody = {
      ...parsedBody,
      options: {
        ...parsedBody.options,
        num_thread: numThreads,
      },
    };

    return {
      requestBody: modifiedBody,
      modifiedInit: {
        ...init,
        body: JSON.stringify(modifiedBody),
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
 * Token metrics from Ollama inference response
 */
interface TokenMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokensPerSecond: number | null;
}

/**
 * Extracts token metrics from Ollama response body.
 */
function extractTokenMetrics(responseBody: OllamaInferenceResponse | null, durationMs: number): TokenMetrics {
  if (!responseBody) {
    return { inputTokens: null, outputTokens: null, totalTokens: null, tokensPerSecond: null };
  }

  const inputTokens = responseBody.prompt_eval_count ?? null;
  const outputTokens = responseBody.eval_count ?? null;
  const totalTokens = inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null;

  let tokensPerSecond: number | null = null;
  if (outputTokens !== null && durationMs > 0) {
    tokensPerSecond = Math.round((outputTokens / durationMs) * 1000 * 10) / 10;
  }

  return { inputTokens, outputTokens, totalTokens, tokensPerSecond };
}

/**
 * Logs the successful completion of an inference call with token metrics.
 */
function logInferenceSuccess(
  modelName: string,
  duration: number,
  status: number,
  statusText: string,
  metrics: TokenMetrics,
): void {
  console.log(`✅ [OLLAMA] Inference completed in ${duration}ms`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Status: ${status} ${statusText}`);

  if (metrics.inputTokens !== null || metrics.outputTokens !== null) {
    const inputStr = metrics.inputTokens !== null ? `${metrics.inputTokens} input` : '';
    const outputStr = metrics.outputTokens !== null ? `${metrics.outputTokens} output` : '';
    const separator = inputStr && outputStr ? ', ' : '';
    console.log(`   Tokens: ${inputStr}${separator}${outputStr}`);
  }

  if (metrics.tokensPerSecond !== null) {
    console.log(`   Speed: ${metrics.tokensPerSecond} tokens/sec`);
  }
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
 * Extracts token metrics from a cloned response body.
 * Returns null if the response cannot be parsed.
 */
async function parseResponseForMetrics(response: Response): Promise<OllamaInferenceResponse | null> {
  try {
    const clonedResponse = response.clone();
    const body = await clonedResponse.json();
    return body as OllamaInferenceResponse;
  } catch {
    return null;
  }
}

/**
 * Maximum number of pending requests in the Ollama queue.
 * When the queue is full, new requests will be dropped.
 */
const MAX_QUEUE_LENGTH = 10;

/**
 * A queued request waiting to be processed.
 */
interface QueuedRequest {
  url: string;
  init: RequestInit | undefined;
  resolve: (value: Response) => void;
  reject: (error: Error) => void;
}

/**
 * Statistics about dropped requests for monitoring.
 */
interface QueueStats {
  droppedCount: number;
  processedCount: number;
}

/**
 * Queue for serial processing of Ollama inference requests.
 * Processes one request at a time and drops requests when the queue is full.
 */
class OllamaQueue {
  private queue: QueuedRequest[] = [];
  private isProcessing = false;
  private stats: QueueStats = { droppedCount: 0, processedCount: 0 };

  /**
   * Add a request to the queue.
   * Returns a promise that resolves with the response or rejects if dropped/failed.
   */
  async enqueue(url: string, init: RequestInit | undefined): Promise<Response> {
    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      this.stats.droppedCount++;
      const errorMessage = `Queue full (${MAX_QUEUE_LENGTH} pending). Request dropped. Total dropped: ${this.stats.droppedCount}`;
      console.error(`⚠️ [OLLAMA QUEUE] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    return new Promise<Response>((resolve, reject) => {
      this.queue.push({ url, init, resolve, reject });
      console.log(`📥 [OLLAMA QUEUE] Request queued. Queue size: ${this.queue.length}/${MAX_QUEUE_LENGTH}`);
      this.processNext();
    });
  }

  /**
   * Process the next request in the queue if not already processing.
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const request = this.queue.shift();

    if (!request) {
      this.isProcessing = false;
      return;
    }

    try {
      console.log(`🔄 [OLLAMA QUEUE] Processing request. Remaining in queue: ${this.queue.length}`);
      const response = await fetch(request.url, request.init);
      this.stats.processedCount++;
      request.resolve(response);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  /**
   * Get current queue statistics.
   */
  getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * Get current queue length.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is currently processing a request.
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}

/**
 * Global Ollama request queue instance for serial processing.
 */
const ollamaQueue = new OllamaQueue();

/**
 * Get the current Ollama queue statistics.
 */
export function getOllamaQueueStats(): QueueStats {
  return ollamaQueue.getStats();
}

/**
 * Get the current Ollama queue length.
 */
export function getOllamaQueueLength(): number {
  return ollamaQueue.getQueueLength();
}

/**
 * Creates a logging fetch wrapper that logs all Ollama API calls with timing information,
 * injects CPU thread limiting options, and uses a queue for serial processing of inference calls.
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
      // Inference calls go through the queue for serial processing
      // Non-inference calls (like model list, pull) bypass the queue
      const response = isInferenceCall ? await ollamaQueue.enqueue(url, modifiedInit) : await fetch(url, modifiedInit);
      const duration = Date.now() - startTime;

      if (isInferenceCall) {
        const responseBody = await parseResponseForMetrics(response);
        const metrics = extractTokenMetrics(responseBody, duration);
        logInferenceSuccess(modelName, duration, response.status, response.statusText, metrics);
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
