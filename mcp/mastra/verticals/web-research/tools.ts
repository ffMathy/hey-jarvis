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

import type { ToolsInput } from '@mastra/core/agent';
import { z } from 'zod';
import { google } from '../../utils/providers/google-provider.js';

const googleSearchTool = google.tools.googleSearch({});

// `ProviderToolFactory` is declared as returning the whole `Tool` union, of which only
// the `type: 'provider'` branch carries an `id`. `@mastra/core` requires that `id` on
// every provider-defined entry of `ToolsInput`, so the wide declared type no longer fits
// even though `createProviderToolFactory` only ever builds the provider branch.
// Narrowing turns that implicit guarantee into a checked one: if a future AI SDK changes
// the shape, this fails loudly here instead of registering a malformed tool.
if (googleSearchTool.type !== 'provider') {
  throw new Error(
    `Expected google.tools.googleSearch() to return a provider-defined tool, but got type "${googleSearchTool.type ?? 'function'}".`,
  );
}

// Export the Google Search tool for the web research agent
export const webResearchTools: ToolsInput = {
  googleSearch: {
    description: 'Tool for performing web searches using Google Search API.',
    // No `id` here on purpose: the provider-defined tool supplies its own
    // (`google.google_search`), and anything declared before the spread would be
    // silently overwritten by it.
    ...googleSearchTool,
    // Provider-defined tools lack a Zod inputSchema, which crashes zod-to-json-schema
    // when the /tools endpoint serializes all registered tools.
    inputSchema: z.object({}),
  },
};
