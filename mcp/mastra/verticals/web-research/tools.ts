import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// Get Tavily API key from environment
const getApiKey = () => {
  const apiKey = process.env.HEY_JARVIS_TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('Tavily API key not found. Please set HEY_JARVIS_TAVILY_API_KEY environment variable.');
  }
  return apiKey;
};

// Tool to search the web using Tavily API
export const searchWeb = createTool({
  id: 'searchWeb',
  description:
    'Search for a particular phrase on the web. Each result has a URL, a description, and a score (which specifies the relevance of the result compared to the phrase searched for).',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'The phrase to search for. This will be interpolated into JSON strings, so escape all quotes with slashes.',
      ),
    maxResults: z.number().optional().default(10).describe('Maximum number of search results to return (default: 10)'),
    searchDepth: z
      .enum(['basic', 'advanced'])
      .optional()
      .default('basic')
      .describe('Search depth: basic or advanced (default: basic)'),
  }),
  outputSchema: z.object({
    answer: z.string().optional().describe('Direct answer to the query if available'),
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
        score: z.number(),
      }),
    ),
    images: z
      .array(
        z.object({
          url: z.string(),
          description: z.string().optional(),
        }),
      )
      .optional(),
  }),
  execute: async (inputData) => {
    const apiKey = getApiKey();
    const url = 'https://api.tavily.com/search';

    const requestBody = {
      api_key: apiKey,
      query: inputData.query,
      search_depth: inputData.searchDepth,
      include_answer: true,
      include_images: true,
      include_image_descriptions: true,
      include_raw_content: false,
      max_results: inputData.maxResults,
      include_domains: [],
      exclude_domains: [],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Failed to search web: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      answer: data.answer,
      results: data.results || [],
      images: data.images || [],
    };
  },
});

// Tool to get HTML content from URLs using Tavily extract API
export const getHtmlContent = createTool({
  id: 'getHtmlContent',
  description: 'Get the HTML contents of a particular web page URL.',
  inputSchema: z.object({
    url: z.string().describe('The URL to fetch HTML content from'),
  }),
  outputSchema: z.object({
    url: z.string(),
    rawContent: z.string().describe('The extracted text content from the HTML page'),
  }),
  execute: async (inputData) => {
    const apiKey = getApiKey();
    const url = 'https://api.tavily.com/extract';

    const requestBody = {
      api_key: apiKey,
      urls: [inputData.url],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Failed to extract HTML content: ${response.statusText}`);
    }

    const data = await response.json();

    // Tavily extract returns an object with results keyed by URL
    const results = data.results || [];
    const result = results[0] || { url: inputData.url, raw_content: '' };

    return {
      url: result.url || inputData.url,
      rawContent: result.raw_content || '',
    };
  },
});

// Export all tools together for convenience
export const webResearchTools = {
  searchWeb,
  getHtmlContent,
};
