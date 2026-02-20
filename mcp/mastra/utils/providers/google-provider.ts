import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Creates a Google Generative AI provider instance
 * using the HEY_JARVIS_GOOGLE_API_KEY environment variable.
 *
 * This shared provider ensures consistency across all agents and scorers
 * in the Hey Jarvis system.
 *
 * Uses lazy validation so that missing API key doesn't crash the server
 * at module load time — the error surfaces when an actual API call is made.
 */

const googleApiKey = process.env.HEY_JARVIS_GOOGLE_API_KEY;

if (!googleApiKey) {
  console.warn('⚠️ HEY_JARVIS_GOOGLE_API_KEY is not set. Google AI features will not work.');
}

export const google = createGoogleGenerativeAI({
  apiKey: googleApiKey || 'not-configured',
});
