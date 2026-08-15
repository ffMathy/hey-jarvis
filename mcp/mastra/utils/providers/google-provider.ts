import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Creates a Google Generative AI provider instance using
 * HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY.
 *
 * There is deliberately no fallback to a general "Google" key. This used to read
 * HEY_JARVIS_GOOGLE_API_KEY, which is a Google MAPS key restricted to the Maps APIs,
 * so every call here failed with API_KEY_INVALID against a service that was
 * perfectly reachable. Maps credentials now live under HEY_JARVIS_GOOGLE_MAPS_API_KEY
 * and the two cannot be confused again. Failing outright beats silently
 * authenticating with a key scoped to the wrong product.
 *
 * This shared provider ensures consistency across all agents and scorers
 * in the Hey Jarvis system.
 *
 * Uses lazy validation so that missing API key doesn't crash the server
 * at module load time — the error surfaces when an actual API call is made.
 */

const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

if (!googleApiKey) {
  console.warn('⚠️ HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY is not set. Google AI features will not work.');
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
