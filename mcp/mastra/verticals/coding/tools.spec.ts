/**
 * What the coding agent reads before it can answer "which issues are open?", and what it hands a
 * Claude Code session asked a question about the code.
 *
 * The model reads a tool's whole answer before its first word, so an issue listing is kept to
 * what a listing is for: which issues there are, and how each one starts.
 *
 * GitHub is faked at `fetch`, and Claude Code at `runCodingTask`, scoped to each test.
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { readAffectedEntities } from '../../utils/affected-entities.js';
import { isSlowTask } from '../../utils/slow-tasks.js';
import { executeTool } from '../../utils/tool-factory.js';
import { DEFAULT_OWNER, DEFAULT_REPOSITORY } from './repository.js';
import {
  analyzeCodebase,
  buildCodebaseQuestionTask,
  codingTools,
  createGitHubIssue,
  listRepositoryIssues,
  listUserRepositories,
  runCodingTask,
  startCodingSession,
} from './tools.js';
import { implementFeatureWorkflow } from './workflows.js';

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

describe('buildCodebaseQuestionTask', () => {
  const task = buildCodebaseQuestionTask(
    '  Gather ideas to improve Jarvis coding-wise  ',
    `${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}`,
    true,
  );

  it("carries the question, trimmed, and names the repository as Jarvis's own", () => {
    expect(task).toContain('\nGather ideas to improve Jarvis coding-wise\n');
    expect(task).toContain(`${DEFAULT_OWNER}/${DEFAULT_REPOSITORY} repository — Jarvis's own codebase`);
  });

  it('keeps the session to reading, without questions', () => {
    expect(task).toContain('This session only reads');
    expect(task).toContain('do not ask any');
  });

  it('asks for an answer that stands on its own, since it is handed on', () => {
    expect(task).toContain('make it complete on its own');
  });

  it('passes on what the code cannot show, and leaves the section out when there is none', () => {
    const withContext = buildCodebaseQuestionTask(
      'What could be improved?',
      'someone/else',
      false,
      'The calendar agent failed 12 times: token expired.',
    );

    expect(withContext).toContain(
      'What is known beyond the code, to take into account:\nThe calendar agent failed 12 times: token expired.',
    );
    expect(withContext).not.toContain("Jarvis's own codebase");
    expect(task).not.toContain('What is known beyond the code');
    expect(buildCodebaseQuestionTask('Why?', 'someone/else', false, '   ')).not.toContain(
      'What is known beyond the code',
    );
  });
});

describe('analyzeCodebase', () => {
  let restoreSession: (() => void) | undefined;

  afterEach(() => {
    restoreSession?.();
    restoreSession = undefined;
  });

  function fakeSession() {
    const tasks: string[] = [];
    const sessionSpy = spyOn(runCodingTask, 'execute').mockImplementation(async (inputData) => {
      tasks.push(inputData.task);
      return {
        success: true,
        session_id: 'session_question',
        stop_reason: 'end_turn',
        final_message: 'The scheduler lives in mcp/mastra/scheduler.ts.',
        message: 'Claude Code session session_question stopped with "end_turn".',
      };
    });
    restoreSession = () => sessionSpy.mockRestore();

    return tasks;
  }

  it("asks a session about Jarvis's own repository when none is named, and returns its answer", async () => {
    const tasks = fakeSession();

    const result = await executeTool(analyzeCodebase, {
      question: 'How does the scheduler work?',
      context: 'Two scheduled runs failed last night.',
    });

    expect(result.final_message).toBe('The scheduler lives in mcp/mastra/scheduler.ts.');
    expect(tasks).toEqual([
      buildCodebaseQuestionTask(
        'How does the scheduler work?',
        `${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}`,
        true,
        'Two scheduled runs failed last night.',
      ),
    ]);
  });

  it('reads the repository it is given', async () => {
    const tasks = fakeSession();

    await executeTool(analyzeCodebase, { owner: 'someone', repo: 'else', question: 'What does it do?' });

    expect(tasks[0]).toContain('someone/else repository');
    expect(tasks[0]).not.toContain("Jarvis's own codebase");
  });

  it('is marked slow, so routing offers to notify rather than hold the line', () => {
    expect(isSlowTask('analyzeCodebase')).toBe(true);
  });

  it('is one of the tools the coding agent is given', () => {
    expect(codingTools.analyzeCodebase).toBe(analyzeCodebase);
  });
});

/**
 * What the coding tools report as touched, which sir's headset lights up: the repository a tool
 * works on, by its full name in lower case, defaulting to Jarvis's own as the tools do.
 */
describe('the repository a coding request touches', () => {
  const jarvis = { id: 'ffmathy/hey-jarvis', name: 'hey-jarvis' };

  it('is Jarvis’s own when none is named, and the one named otherwise', () => {
    expect(readAffectedEntities(listRepositoryIssues.id, {}, { issues: [], total_count: 0 })).toEqual([jarvis]);
    expect(readAffectedEntities(analyzeCodebase.id, { owner: 'ffMathy', repo: 'Dotfiles', question: 'q' }, {})).toEqual(
      [{ id: 'ffmathy/dotfiles', name: 'Dotfiles' }],
    );
    expect(
      readAffectedEntities(createGitHubIssue.id, { title: 't', body: 'b' }, { success: true, message: '' }),
    ).toEqual([jarvis]);
  });

  it('is the repository an implementation was started in, read off the workflow the coding agent calls', () => {
    expect(
      readAffectedEntities(
        `workflow-${implementFeatureWorkflow.id}`,
        { inputData: { initialRequest: 'Add a tool' } },
        { result: { success: true, message: 'Started a Claude Code session.' }, runId: 'run-1' },
      ),
    ).toEqual([jarvis]);
  });

  it('is nothing for an implementation whose session did not start, as for the tool that starts one', () => {
    expect(
      readAffectedEntities(
        `workflow-${implementFeatureWorkflow.id}`,
        { inputData: { initialRequest: 'Add a tool' } },
        { result: { success: false, message: 'The Claude Code session did not start: no host' }, runId: 'run-1' },
      ),
    ).toEqual([]);
  });

  it('is nothing for a session that did not start, or for a list of every repository', () => {
    expect(readAffectedEntities(startCodingSession.id, { request: 'r' }, { success: false, message: 'no' })).toEqual(
      [],
    );
    expect(readAffectedEntities(startCodingSession.id, { request: 'r' }, { success: true, message: 'ok' })).toEqual([
      jarvis,
    ]);
    expect(readAffectedEntities(listUserRepositories.id, {}, { repositories: [], total_count: 0 })).toEqual([]);
  });
});
