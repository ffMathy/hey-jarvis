/**
 * Web Research Tools
 *
 * NOTE: Tavily-based tools have been PERMANENTLY DISABLED in favor of Google Search tool.
 * The Google Search tool (google.tools.googleSearch) provides real-time web search with
 * source citations that the agent can use.
 *
 * This provides:
 * - Real-time web search via googleSearch tool
 * - Source citations and URLs in search results
 * - Agent can perform multiple searches for comprehensive research
 * - Better control over search queries and result processing
 *
 * The Tavily API key is no longer required for this agent.
 */

import { google } from '../../utils/providers/google-provider.js';

// Export the Google Search tool for the web research agent
export const webResearchTools = {
  googleSearch: {
    id: 'googleSearch',
    description: 'Tool for performing web searches using Google Search API.',
    ...google.tools.googleSearch({}),
  },
};
