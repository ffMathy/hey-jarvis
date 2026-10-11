import { z } from 'zod';
import { HOUSEHOLD_TIME_ZONE } from '../../utils/household.js';
import { withRetry } from '../../utils/retry.js';
import { executeTool } from '../../utils/tool-factory.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { generateUserInterface } from '../visualize/tools.js';
import { getWebResearchAgent } from './agent.js';
import { type DailyDevPost, dailyDevPostSchema, getDailyDevTopPosts } from './tools.js';

/** How far back the digest looks. */
const DIGEST_DAYS = 7;

/** How many of daily.dev's most upvoted posts the digest is built from. */
const DAILY_DEV_POST_COUNT = 20;

/**
 * The week a digest covers, as "4 October – 11 October 2026" in the household's time zone.
 *
 * Written into both the research prompt and the page brief, because neither the model nor the
 * page builder knows what day it is.
 *
 * Exported for testing.
 */
export function describeDigestWeek(now: Date): string {
  const start = new Date(now.getTime() - DIGEST_DAYS * 24 * 60 * 60 * 1000);
  const format = (date: Date, withYear: boolean) =>
    date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: HOUSEHOLD_TIME_ZONE,
    });

  return `${format(start, false)} – ${format(now, true)}`;
}

/**
 * The brief the page builder gets: everything the page should show, since it can see nothing else.
 *
 * Exported for testing.
 */
export function buildWeeklyDigestRequest(week: string, news: string, posts: DailyDevPost[]): string {
  const postLines = posts.map(
    (post, index) =>
      `${index + 1}. "${post.title}"${post.source ? ` (${post.source})` : ''} — ${post.upvotes} upvotes, ${post.comments} comments, published ${post.publishedAt}. Tags: ${post.tags.join(', ') || 'none'}. URL: ${post.url}${post.summary ? `\n   Summary: ${post.summary}` : ''}`,
  );

  return `Build a weekly digest page for the week ${week}, read on a phone on Monday morning over coffee. It has two sections.

1. "The week in news": a summary of the week's news, grouped by topic. Open with three or four headline takeaways, then a card per story with its headline, a short summary and its source links. Visualize what can be visualized — for example how many stories each topic had, or a timeline of the week's biggest events.

2. "The week on daily.dev": a summary of what developers read and discussed most. Open with the themes that ran through the week, then the posts themselves, each linking to its URL. Visualize the posts — for example upvotes per post as a bar chart, and which tags came up most often.

The news, as researched:
${news}

daily.dev's ${posts.length} most upvoted posts this week:
${postLines.join('\n') || 'daily.dev returned no posts this week — say so in that section.'}`;
}

const weeklyNewsSchema = z.object({
  week: z.string(),
  news: z.string(),
});

const dailyDevTopPostsSchema = z.object({
  posts: z.array(dailyDevPostSchema),
});

const researchWeeklyNews = createStep({
  id: 'research-weekly-news',
  description: "Researches the past week's most important news",
  inputSchema: z.object({}),
  outputSchema: weeklyNewsSchema,
  execute: async () => {
    const week = describeDigestWeek(new Date());
    const agent = await getWebResearchAgent();
    // Retried only on a transient provider failure, which would otherwise lose the whole week's
    // digest: the schedule does not fire again until next Monday.
    const response = await withRetry(
      () =>
        agent.generate(
          `Research the most important news of the past week (${week}): world news, Denmark, technology and AI, business and the economy, and science. Pick the ten to fifteen stories that mattered most. For each, give the topic, a headline, the date, two or three sentences on what happened and why it matters, and the source URLs. This is a written digest, not something read aloud, so be thorough.`,
        ),
      { label: 'weekly news research' },
    );

    return { week, news: response.text };
  },
});

const fetchDailyDevTopPosts = createStep({
  id: 'fetch-daily-dev-top-posts',
  description: "Fetches the past week's most upvoted posts on daily.dev",
  inputSchema: z.object({}),
  outputSchema: dailyDevTopPostsSchema,
  execute: async ({ mastra }) =>
    await executeTool(getDailyDevTopPosts, { days: DIGEST_DAYS, limit: DAILY_DEV_POST_COUNT }, { mastra }),
});

const weeklyDigestOutputSchema = z.object({
  artifactUrl: z.string().optional().describe('Where the digest page is hosted'),
  sentToPhone: z.boolean(),
  message: z.string(),
});

const visualizeWeeklyDigest = createStep({
  id: 'visualize-weekly-digest',
  description: 'Builds the digest page and pushes its link to the phone',
  inputSchema: z.object({
    'research-weekly-news': weeklyNewsSchema,
    'fetch-daily-dev-top-posts': dailyDevTopPostsSchema,
  }),
  outputSchema: weeklyDigestOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const { week, news } = inputData['research-weekly-news'];
    const { posts } = inputData['fetch-daily-dev-top-posts'];

    const result = await executeTool(
      generateUserInterface,
      { request: buildWeeklyDigestRequest(week, news, posts), title: 'Your week in news', sendToPhone: true },
      { mastra },
    );
    if (!result.success) {
      throw new Error(`The weekly digest could not be built: ${result.message}`);
    }

    return { artifactUrl: result.artifactUrl, sentToPhone: result.sentToPhone, message: result.message };
  },
});

/**
 * The weekly digest: the past week's news and daily.dev's most upvoted posts, summarized on one
 * page and pushed to the phone. Scheduled for Monday morning in `schedule-reconciler.ts`.
 *
 * The two sources are gathered side by side, since neither needs the other, and the page builder
 * gets both in one brief.
 */
export const weeklyNewsDigestWorkflow = createWorkflow({
  id: 'weeklyNewsDigestWorkflow',
  inputSchema: z.object({}),
  outputSchema: weeklyDigestOutputSchema,
})
  .parallel([researchWeeklyNews, fetchDailyDevTopPosts])
  .then(visualizeWeeklyDigest)
  .commit();
