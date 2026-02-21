import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createOllama } from 'ai-sdk-ollama';

/**
 * Ollama provider for local LLM inference.
 *
 * Connects to the Ollama cluster configured via HEY_JARVIS_OLLAMA_BASE_URL
 * (defaults to http://jarvis.local:8000).
 *
 * Uses a custom fetch wrapper that:
 * - Strips tools / tool_choice (no function-calling support on Hailo)
 * - Passes `format` through to Ollama for native JSON schema enforcement
 * - Falls back to injecting the schema into the prompt if the server
 *   rejects the `format` field (e.g. older oatpp-based Hailo firmware)
 */

/**
 * Ollama base URL. When undefined, Ollama helper functions (isOllamaAvailable, etc.)
 * return false/empty results, and Ollama tests are skipped.
 */
const HEY_JARVIS_OLLAMA_BASE_URL = process.env.HEY_JARVIS_OLLAMA_BASE_URL;

/**
 * Default Ollama model. Pre-loaded on the Jarvis Hailo cluster.
 * Configurable via OLLAMA_MODEL environment variable.
 */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-instruct:1.5b';

/**
 * Inject a JSON schema into the last user message so the model knows what
 * structure to produce when the server lacks native `format` support.
 */
function injectSchemaIntoMessages(
  messages: Array<{ role: string; content: string }>,
  schema: unknown,
): Array<{ role: string; content: string }> {
  const schemaStr = JSON.stringify(schema, null, 2);
  const instruction = [
    '\n\n[IMPORTANT: You MUST respond with valid JSON that conforms to this schema exactly.',
    'Use the EXACT field names shown. Do not add extra fields.',
    `Schema:\n${schemaStr}\n]`,
  ].join(' ');

  const result = [...messages];
  let lastUserIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx >= 0) {
    result[lastUserIdx] = {
      ...result[lastUserIdx],
      content: result[lastUserIdx].content + instruction,
    };
  } else {
    result.push({ role: 'user', content: instruction });
  }
  return result;
}

/**
 * Custom fetch wrapper for the Hailo cluster.
 *
 * - Always strips `tools` / `tool_choice` (unsupported by Hailo)
 * - When `format` is a JSON schema object, replaces it with `"json"` (Hailo's
 *   oatpp server only accepts the string form) and injects the schema into the
 *   prompt messages so the model still knows what structure to produce
 *
 * Bun's `typeof fetch` includes a `preconnect` property for DNS prefetching.
 * We copy it from the global fetch so the wrapper satisfies the type at runtime.
 */
const strippingFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const { tools: _t, tool_choice: _tc, ...stripped } = body;

        // Hailo's oatpp server only accepts format:"json", not a schema object.
        // Downgrade to the string form and inject the schema into messages.
        if (stripped.format && typeof stripped.format === 'object') {
          const schema = stripped.format;
          stripped.format = 'json';

          if (Array.isArray(stripped.messages)) {
            stripped.messages = injectSchemaIntoMessages(
              stripped.messages as Array<{ role: string; content: string }>,
              schema,
            );
          }
        }

        init = { ...init, body: JSON.stringify(stripped) };
      } catch {
        // Not JSON — pass through as-is
      }
    }
    return fetch(input, init);
  },
  // Copy Bun's preconnect and any other static properties from global fetch
  { preconnect: fetch.preconnect },
) as typeof fetch;

/**
 * Ollama provider instance pointing at the Jarvis cluster.
 * Call as `ollama('model-id')` or `ollama.chat('model-id')` to get a language model.
 */
export const ollama = createOllama({
  baseURL: HEY_JARVIS_OLLAMA_BASE_URL,
  fetch: strippingFetch,
});

/**
 * Pre-configured default model for use in agents and workflows.
 */
export const ollamaModel: LanguageModelV3 = ollama(OLLAMA_MODEL);

/**
 * Returns the Ollama API base URL including /api path (for health checks etc.).
 */
export function getOllamaBaseUrl(): string {
  return `${HEY_JARVIS_OLLAMA_BASE_URL}/api`;
}

/**
 * Returns the Ollama base URL (without /api path).
 */
export function getOllamaApiUrl() {
  return HEY_JARVIS_OLLAMA_BASE_URL;
}

/**
 * Returns true if the Ollama server is reachable.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  if (!getOllamaApiUrl()) return false;

  try {
    const response = await fetch(`${HEY_JARVIS_OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Returns true if the given model is available on the Ollama server.
 */
export async function isModelAvailable(modelName: string): Promise<boolean> {
  if (!(await isOllamaAvailable())) return false;

  try {
    const response = await fetch(`${HEY_JARVIS_OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    const baseName = modelName.split(':')[0];
    return models.some((m) => m.name === modelName || m.name.startsWith(`${baseName}:`));
  } catch {
    return false;
  }
}

/**
 * Returns the list of model names available on the Ollama server.
 */
export async function listModels(): Promise<string[]> {
  if (!(await isOllamaAvailable())) return [];

  try {
    const response = await fetch(`${HEY_JARVIS_OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
