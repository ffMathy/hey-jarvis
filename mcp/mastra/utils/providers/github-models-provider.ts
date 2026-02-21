import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { google } from './google-provider.js';

/**
 * Creates a GitHub Models provider instance for use in CI/testing environments.
 *
 * GitHub Models uses an OpenAI-compatible API endpoint at models.inference.ai.azure.com.
 * Authentication is via GITHUB_TOKEN (automatically available in GitHub Actions).
 *
 * This provider is used during GitHub Actions CI runs to reduce token usage
 * costs by using GitHub's free model inference service instead of paid APIs.
 *
 * Available models: https://github.com/marketplace/models
 * - gpt-4o, gpt-4o-mini (OpenAI)
 * - Phi-3, Phi-3.5 (Microsoft)
 * - Mistral, Mixtral (Mistral AI)
 * - Llama 3.x (Meta)
 * - And more...
 */

const GITHUB_MODELS_BASE_URL = 'https://models.inference.ai.azure.com';

/**
 * Checks if GitHub Models should be used based on environment.
 * Returns true if:
 * - Running in GitHub Actions (GITHUB_ACTIONS === 'true'), OR
 * - Running in a DevContainer (IS_DEVCONTAINER === 'true')
 * - AND HEY_JARVIS_GITHUB_API_TOKEN is available
 */
export function shouldUseGitHubModels(): boolean {
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  const isDevContainer = process.env.IS_DEVCONTAINER === 'true';
  const hasGitHubToken = Boolean(process.env.HEY_JARVIS_GITHUB_API_TOKEN);
  return (isGitHubActions || isDevContainer) && hasGitHubToken;
}

/**
 * Gets the GitHub Models token from environment variables.
 * Uses HEY_JARVIS_GITHUB_API_TOKEN for authentication.
 */
function getGitHubModelsToken(): string {
  const token = process.env.HEY_JARVIS_GITHUB_API_TOKEN;
  if (!token) {
    throw new Error('GitHub Models token not found. Set HEY_JARVIS_GITHUB_API_TOKEN.');
  }
  return token;
}

/**
 * Creates and exports the configured GitHub Models provider instance.
 * Uses lazy initialization to avoid errors when token is not available.
 */
let githubModelsProvider: ReturnType<typeof createOpenAI> | null = null;

export function getGitHubModelsProvider(): ReturnType<typeof createOpenAI> {
  if (!githubModelsProvider) {
    githubModelsProvider = createOpenAI({
      baseURL: GITHUB_MODELS_BASE_URL,
      apiKey: getGitHubModelsToken(),
    });
  }
  return githubModelsProvider;
}

/**
 * Default model ID for GitHub Models.
 * gpt-4o-mini offers a good balance of capability and speed for testing.
 */
export const GITHUB_MODELS_DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Mapping of Gemini model names to equivalent GitHub Models.
 * Used to translate model requests when running in CI.
 */
export const GEMINI_TO_GITHUB_MODEL_MAP: Record<string, string> = {
  'gemini-flash-latest': 'gpt-4o-mini',
  // Use gpt-4o for the lite model because gpt-4o-mini lacks the reasoning needed
  // for the routing agent to correctly avoid unnecessary tasks (e.g. location lookup
  // when the location is already provided in the query).
  'gemini-flash-lite-latest': 'gpt-4o',
  'gemini-pro-latest': 'gpt-4o',
};

/**
 * Gets the equivalent GitHub model for a given Gemini model name.
 */
export function getEquivalentGitHubModel(geminiModel: string): string {
  return GEMINI_TO_GITHUB_MODEL_MAP[geminiModel] || GITHUB_MODELS_DEFAULT_MODEL;
}

/**
 * Gets the appropriate model based on environment.
 * Uses GitHub Models in CI environments, falls back to Google Gemini otherwise.
 *
 * @param geminiModel - The Gemini model name to use in production
 * @returns The appropriate model instance for the current environment
 */
export function getModel(geminiModel: string): LanguageModelV3 {
  if (shouldUseGitHubModels()) {
    const githubProvider = getGitHubModelsProvider();
    const modelId = getEquivalentGitHubModel(geminiModel);
    // GitHub Models only supports the chat completions API, not the responses API
    return githubProvider.chat(modelId);
  }
  return google(geminiModel);
}
