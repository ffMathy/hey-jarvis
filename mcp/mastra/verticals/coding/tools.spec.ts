/**
 * What the coding agent reads before it can answer "which issues are open?".
 *
 * The model reads a tool's whole answer before its first word, so an issue listing is kept to
 * what a listing is for: which issues there are, and how each one starts.
 *
 * GitHub is faked at `fetch`, scoped to each test.
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { DEFAULT_OWNER, DEFAULT_REPOSITORY } from './repository.js';
import { listRepositoryIssues } from './tools.js';

/**
 * A stand-in for `fetch` that answers every request with `respond`, recording the URLs asked for.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
function fakeGitHub(respond: () => unknown) {
  const requestedUrls: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify(respond()), { headers: { 'content-type': 'application/json' } });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { requestedUrls, fetchSpy };
}

function issue(number: number, body: string | null, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: 'open',
    html_url: `https://github.com/${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}/issues/${number}`,
    body,
    created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-21T10:00:00Z',
    labels: [{ name: 'automated-error', color: 'd73a4a' }],
    ...overrides,
  };
}

describe('listRepositoryIssues', () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("asks for Jarvis's own repository when none is named, in a single request", async () => {
    const { requestedUrls, fetchSpy } = fakeGitHub(() => [issue(1, 'Short.')]);
    restoreFetch = () => fetchSpy.mockRestore();

    await executeTool(listRepositoryIssues, { state: 'open' });

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain(`/repos/${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}/issues`);
  });

  it('keeps only the start of a long body, and a short one whole', async () => {
    const stackTrace = `TypeError: Cannot read properties of undefined\n${'    at somewhere (file.ts:1:1)\n'.repeat(200)}`;
    const { fetchSpy } = fakeGitHub(() => [issue(1, stackTrace), issue(2, 'Short.'), issue(3, null)]);
    restoreFetch = () => fetchSpy.mockRestore();

    const { issues } = await executeTool(listRepositoryIssues, { state: 'open' });

    expect(issues[0].body?.length).toBeLessThanOrEqual(300);
    expect(issues[0].body).toStartWith('TypeError: Cannot read properties of undefined');
    expect(issues[1].body).toBe('Short.');
    expect(issues[2].body).toBeNull();
  });

  it('leaves out pull requests, which the issues endpoint also returns', async () => {
    const { fetchSpy } = fakeGitHub(() => [
      issue(1, 'An issue.'),
      issue(2, 'A pull request.', { pull_request: { url: 'https://api.github.com/pulls/2' } }),
    ]);
    restoreFetch = () => fetchSpy.mockRestore();

    const result = await executeTool(listRepositoryIssues, { state: 'open' });

    expect(result.issues.map((listed) => listed.number)).toEqual([1]);
    expect(result.total_count).toBe(1);
  });
});
