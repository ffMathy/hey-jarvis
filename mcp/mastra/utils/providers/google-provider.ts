import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Creates a Google Generative AI provider instance.
 *
 * Prefers HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY and falls back to
 * HEY_JARVIS_GOOGLE_API_KEY, matching the precedence mastra/index.ts already
 * documents. This provider previously read only the latter, so the two entry points
 * could authenticate with different keys — which is exactly what happened: the
 * generative-AI key was valid while the plain one was not, and every embedding call
 * through here failed with API_KEY_INVALID even though the service was reachable.
 *
 * This shared provider ensures consistency across all agents and scorers
 * in the Hey Jarvis system.
 *
 * Uses lazy validation so that missing API key doesn't crash the server
 * at module load time — the error surfaces when an actual API call is made.
 */

const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || process.env.HEY_JARVIS_GOOGLE_API_KEY;

if (!googleApiKey) {
  console.warn(
    '⚠️ Neither HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY nor HEY_JARVIS_GOOGLE_API_KEY is set. Google AI features will not work.',
  );
}

export const google = createGoogleGenerativeAI({
  apiKey: googleApiKey || 'not-configured',
});

/**
 * Resolves the language model to use for a given Gemini model name.
 *
 * Kept as a single indirection point for every agent, scorer and workflow so
 * that model selection can change in one place. CI used to be routed to GitHub
 * Models here to save tokens; that service has been deprecated, so every
 * environment now talks to Gemini directly.
 *
 * @param geminiModel - Gemini model name, e.g. `gemini-flash-latest`
 */
export function getModel(geminiModel: string) {
  return google(geminiModel);
}
