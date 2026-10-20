/**
 * daily.dev top-posts tests.
 *
 * daily.dev is faked at `fetch`, scoped to each test, so these pin how its feed is read without
 * reaching the network.
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { getDailyDevTopPosts } from './tools.js';

const graphqlRequestSchema = z.object({
  query: z.string(),
  variables: z.object({ period: z.number(), first: z.number() }),
});

function node(overrides: Record<string, unknown> = {}) {
  return {
    title: 'TanStack Charts 1.0',
    commentsPermalink: 'https://daily.dev/posts/tanstack-charts-1-0',
    numUpvotes: 151,
    numComments: 11,
    createdAt: '2026-10-05T15:46:36.160Z',
    summary: 'A charting library built around composable marks.',
    tags: ['javascript', 'react'],
    source: { name: 'TanStack' },
    ...overrides,
  };
}

function fakeDailyDev(nodes: unknown[], status = 200) {
  const requests: z.infer<typeof graphqlRequestSchema>[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        requests.push(graphqlRequestSchema.parse(JSON.parse(String(init?.body ?? '{}'))));
        return new Response(JSON.stringify({ data: { mostUpvotedFeed: { edges: nodes.map((n) => ({ node: n })) } } }), {
          status,
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { fetchSpy, requests };
}

describe('getDailyDevTopPosts', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('asks for the requested period and count, and reads each post', async () => {
    const { requests } = fakeDailyDev([node()]);

    const result = await executeTool(getDailyDevTopPosts, { days: 7, limit: 20 }, {});

    expect(requests[0]?.variables).toEqual({ period: 7, first: 20 });
    expect(result.posts).toEqual([
      {
        title: 'TanStack Charts 1.0',
        url: 'https://daily.dev/posts/tanstack-charts-1-0',
        source: 'TanStack',
        upvotes: 151,
        comments: 11,
        publishedAt: '2026-10-05T15:46:36.160Z',
        summary: 'A charting library built around composable marks.',
        tags: ['javascript', 'react'],
      },
    ]);
  });

  it('drops posts without a title and fills in missing counts', async () => {
    fakeDailyDev([
      node({ title: null }),
      node({ numUpvotes: null, numComments: null, summary: null, tags: null, source: null }),
    ]);

    const { posts } = await executeTool(getDailyDevTopPosts, { days: 7, limit: 20 }, {});

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ upvotes: 0, comments: 0, tags: [], source: undefined, summary: undefined });
  });

  it('throws when daily.dev answers with an error status', async () => {
    fakeDailyDev([], 503);

    await expect(executeTool(getDailyDevTopPosts, { days: 7, limit: 20 }, {})).rejects.toThrow('503');
  });
});
