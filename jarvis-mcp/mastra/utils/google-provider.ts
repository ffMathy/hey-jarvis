import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Validates and creates a Google Generative AI provider instance
 * using the HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY environment variable.
 * 
 * This shared provider ensures consistency across all agents and scorers
 * in the Hey Jarvis system.
 */

// Validate that the Google API key is available
const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;
if (!googleApiKey) {
    throw new Error('HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY environment variable is required');
}

// Create and export the configured Google provider instance
export const google = createGoogleGenerativeAI({
    apiKey: googleApiKey,
});