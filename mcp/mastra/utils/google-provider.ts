import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Validates and creates a Google Generative AI provider instance
 * using the HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY environment variable.
 * 
 * This shared provider ensures consistency across all agents and scorers
 * in the Hey Jarvis system.
 */

let googleProviderInstance: ReturnType<typeof createGoogleGenerativeAI> | null = null;

/**
 * Lazily creates and returns the Google provider instance.
 * This prevents environment variable validation at module load time.
 */
function getGoogleProvider() {
    if (!googleProviderInstance) {
        // Validate that the Google API key is available
        const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;
        if (!googleApiKey) {
            throw new Error('HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY environment variable is required');
        }
        
        // Create the provider instance
        googleProviderInstance = createGoogleGenerativeAI({
            apiKey: googleApiKey,
        });
    }
    
    return googleProviderInstance;
}

/**
 * Gets a language model from the Google provider.
 * @param modelId - The model ID to use (e.g., 'gemini-flash-latest')
 */
export function google(modelId: string) {
    return getGoogleProvider()(modelId);
}

/**
 * Expose the provider's methods for advanced usage.
 */
google.textEmbeddingModel = (modelId: string) => {
    return getGoogleProvider().textEmbeddingModel(modelId);
};