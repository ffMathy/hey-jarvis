import { describe, expect, it } from 'bun:test';
import { buildWeeklyDigestRequest, describeDigestWeek } from './workflows.js';

describe('describeDigestWeek', () => {
  it('names the seven days up to now in the household time zone', () => {
    // 07:00 on a Monday in Copenhagen, when the digest is scheduled.
    expect(describeDigestWeek(new Date('2026-10-12T05:00:00Z'))).toBe('5 October – 12 October 2026');
  });
});

describe('buildWeeklyDigestRequest', () => {
  const post = {
    title: 'TanStack Charts 1.0',
    url: 'https://daily.dev/posts/tanstack-charts-1-0',
    source: 'TanStack',
    upvotes: 151,
    comments: 11,
    publishedAt: '2026-10-05T15:46:36.160Z',
    summary: 'A charting library built around composable marks.',
    tags: ['javascript', 'react'],
  };

  it('hands the builder the week, the news and every post with its link and figures', () => {
    const request = buildWeeklyDigestRequest('5 October – 12 October 2026', 'Parliament passed the budget.', [post]);

    expect(request).toContain('5 October – 12 October 2026');
    expect(request).toContain('Parliament passed the budget.');
    expect(request).toContain('"TanStack Charts 1.0" (TanStack) — 151 upvotes, 11 comments');
    expect(request).toContain('Tags: javascript, react');
    expect(request).toContain('URL: https://daily.dev/posts/tanstack-charts-1-0');
    expect(request).toContain('Summary: A charting library built around composable marks.');
  });

  it('tells the builder when daily.dev had nothing', () => {
    expect(buildWeeklyDigestRequest('a week', 'news', [])).toContain('daily.dev returned no posts this week');
  });
});
