/**
 * Web Research Tools
 *
 * NOTE: Tavily-based tools have been temporarily disabled in favor of Google Search Grounding.
 * Google Search Grounding is integrated directly into the agent's model (gemini-2.0-flash-exp)
 * and provides real-time web search with automatic source citations without needing separate tools.
 *
 * The web research agent now uses Google Search grounding through providerOptions:
 * {
 *   google: {
 *     groundingConfig: {
 *       googleSearchRetrieval: {}
 *     }
 *   }
 * }
 *
 * This provides:
 * - Real-time web search integrated into model responses
 * - Automatic source citations and grounding metadata
 * - No separate API calls or tools needed
 * - Better integration between search and response generation
 */

// No tools are exported - the agent uses Google Search grounding instead
export const webResearchTools = {};
