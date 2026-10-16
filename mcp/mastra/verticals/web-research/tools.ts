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
import { createTool } from '../../utils/tool-factory.js';

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

/**
 * daily.dev's GraphQL endpoint. `mostUpvotedFeed` answers without a token -- it is what the site
 * shows logged-out visitors -- whereas the documented public API needs a Plus subscription.
 */
const DAILY_DEV_GRAPHQL_URL = 'https://api.daily.dev/graphql';

const DAILY_DEV_TOP_POSTS_QUERY = `query MostUpvoted($period: Int, $first: Int) {
  mostUpvotedFeed(period: $period, first: $first) {
    edges {
      node {
        title
        commentsPermalink
        numUpvotes
        numComments
        createdAt
        summary
        tags
        source { name }
      }
    }
  }
}`;

const dailyDevResponseSchema = z.object({
  data: z.object({
    mostUpvotedFeed: z.object({
      edges: z.array(
        z.object({
          node: z.object({
            title: z.string().nullable(),
            commentsPermalink: z.string(),
            numUpvotes: z.number().nullable(),
            numComments: z.number().nullable(),
            createdAt: z.string(),
            summary: z.string().nullable(),
            tags: z.array(z.string()).nullable(),
            source: z.object({ name: z.string() }).nullable(),
          }),
        }),
      ),
    }),
  }),
});

export const dailyDevPostSchema = z.object({
  title: z.string(),
  url: z.string().describe('The post on daily.dev, where its discussion is'),
  source: z.string().optional(),
  upvotes: z.number(),
  comments: z.number(),
  publishedAt: z.string(),
  summary: z.string().optional(),
  tags: z.array(z.string()),
});

export type DailyDevPost = z.infer<typeof dailyDevPostSchema>;

/**
 * The most upvoted posts on daily.dev over the last few days.
 *
 * A plain API call rather than a search: Google indexes daily.dev's posts poorly and has no idea
 * which of them developers actually upvoted, which is the whole point of reading daily.dev.
 */
export const getDailyDevTopPosts = createTool({
  id: 'getDailyDevTopPosts',
  description:
    'Get the most upvoted developer articles on daily.dev over the last few days, with their summaries, tags, upvotes and comment counts.',
  inputSchema: z.object({
    days: z.number().int().min(1).max(30).default(7).describe('How many days back to look. Defaults to 7.'),
    limit: z.number().int().min(1).max(50).default(20).describe('How many posts to return. Defaults to 20.'),
  }),
  outputSchema: z.object({
    posts: z.array(dailyDevPostSchema),
  }),
  execute: async ({ days, limit }) => {
    const response = await fetch(DAILY_DEV_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: DAILY_DEV_TOP_POSTS_QUERY, variables: { period: days, first: limit } }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch daily.dev's top posts: ${response.status} ${response.statusText}`);
    }

    const { data } = dailyDevResponseSchema.parse(await response.json());

    return {
      posts: data.mostUpvotedFeed.edges.flatMap(({ node }) =>
        node.title
          ? [
              {
                title: node.title,
                url: node.commentsPermalink,
                source: node.source?.name,
                upvotes: node.numUpvotes ?? 0,
                comments: node.numComments ?? 0,
                publishedAt: node.createdAt,
                summary: node.summary ?? undefined,
                tags: node.tags ?? [],
              },
            ]
          : [],
      ),
    };
  },
});

// Export the Google Search tool for the web research agent
export const webResearchTools: ToolsInput = {
  getDailyDevTopPosts,
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
