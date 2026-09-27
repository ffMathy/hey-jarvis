import { pick, truncate } from 'lodash-es';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { markAsSlow } from '../../utils/slow-tasks.js';
import { createTool, executeTool } from '../../utils/tool-factory.js';
import {
  createClaudeSession,
  getClaudeSession,
  listLatestClaudeSessionMessages,
  sendClaudeSessionMessage,
  waitForClaudeSessionTurn,
} from './claude-sessions.js';
import { octokit } from './github-client.js';
import { buildSessionWorkInstructions } from './publish-session-work.js';
import { DEFAULT_OWNER, DEFAULT_REPOSITORY } from './repository.js';
import { claudeSessionWatcher } from './session-watcher.js';

// Extract Octokit response types for type inference
type OctokitRepoListResponse = Awaited<ReturnType<typeof octokit.rest.repos.listForUser>>;
type OctokitRepo = OctokitRepoListResponse['data'][0];

type OctokitSearchResponse = Awaited<ReturnType<typeof octokit.rest.search.repos>>;
type OctokitSearchRepo = OctokitSearchResponse['data']['items'][0];

// Fields we want to pick from repository objects
const REPO_FIELDS = [
  'id',
  'name',
  'full_name',
  'description',
  'html_url',
  'stargazers_count',
  'language',
  'updated_at',
  'topics',
] as const;

// Type for the picked repository fields
type PickedRepoFields = (typeof REPO_FIELDS)[number];
type TransformedRepo = Pick<OctokitRepo, PickedRepoFields> & {
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  topics: string[];
};

// Helper function to create Zod schema from Octokit repo response
// This preserves the subset of fields we care about for the agent
const createRepoSchema = () =>
  z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    description: z.string().nullable(),
    html_url: z.string(),
    stargazers_count: z.number(),
    language: z.string().nullable(),
    updated_at: z.string(),
    topics: z.array(z.string()).optional(),
  });

// Helper function to transform Octokit repo to our schema format using lodash pick
const transformRepo = (repo: OctokitRepo | OctokitSearchRepo): TransformedRepo => {
  const picked = pick(repo, REPO_FIELDS);
  return {
    ...picked,
    stargazers_count: picked.stargazers_count ?? 0,
    language: picked.language ?? null,
    updated_at: picked.updated_at ?? '',
    topics: picked.topics || [],
  };
};

// GitHub Repository Schema (inferred from Octokit types)
const GitHubRepositorySchema = createRepoSchema();

// GitHub Issue Schema (simplified for agent use)
const GitHubIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  html_url: z.string(),
  body: z.string().nullable().describe('The start of the issue body, cut short when it is long'),
  created_at: z.string(),
  updated_at: z.string(),
  labels: z
    .array(
      z.object({
        name: z.string(),
        color: z.string(),
      }),
    )
    .optional(),
});

// Type alias for GitHub issue update parameters
type IssueUpdateParams = {
  owner: string;
  repo: string;
  issue_number: number;
  title?: string;
  body?: string;
  labels?: string[];
  state?: 'open' | 'closed';
};

/**
 * Tool to list all repositories for a GitHub user
 */
export const listUserRepositories = createTool({
  id: 'listUserRepositories',
  description: `Lists all public repositories for a given GitHub username. Returns repository information including name, description, stars, and language. Defaults to "${DEFAULT_OWNER}" if no username is provided.`,
  inputSchema: z.object({
    username: z
      .string()
      .optional()
      .describe(`The GitHub username to list repositories for (defaults to "${DEFAULT_OWNER}" if not provided)`),
  }),
  outputSchema: z.object({
    repositories: z.array(GitHubRepositorySchema),
    total_count: z.number(),
  }),
  execute: async (inputData) => {
    const username = inputData.username || DEFAULT_OWNER;

    const { data: repositories } = await octokit.rest.repos.listForUser({
      username,
      sort: 'updated',
      per_page: 100,
    });

    return {
      repositories: repositories.map(transformRepo),
      total_count: repositories.length,
    };
  },
});

/**
 * How much of an issue's body {@link listRepositoryIssues} keeps.
 *
 * A listing is read for which issues there are, and the model reads all of it before it can
 * answer. A hundred issues with their bodies in full -- the automatically filed ones carry whole
 * stack traces -- is tens of thousands of tokens of reading for a question answered by the titles
 * and the first lines.
 */
const MAXIMUM_ISSUE_BODY_LENGTH = 300;

/**
 * Tool to list all issues for a specific repository
 */
export const listRepositoryIssues = createTool({
  id: 'listRepositoryIssues',
  description: `Lists all issues for a specific GitHub repository, each with the start of its body. Can filter by state (open/closed/all). Defaults to "${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}", Jarvis's own, if not specified — call it straight away for that one, without looking the repository up first.`,
  inputSchema: z.object({
    owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}" if not provided)`),
    repo: z.string().optional().describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}" if not provided)`),
    state: z.enum(['open', 'closed', 'all']).default('open').describe('Filter issues by state'),
  }),
  outputSchema: z.object({
    issues: z.array(GitHubIssueSchema),
    total_count: z.number(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || DEFAULT_OWNER;
    const repo = inputData.repo || DEFAULT_REPOSITORY;

    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: inputData.state,
      per_page: 100,
    });

    // Filter out pull requests (GitHub API includes PRs in issues endpoint)
    const actualIssues = issues.filter((issue) => !issue.pull_request);

    return {
      issues: actualIssues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
        body: issue.body ? truncate(issue.body, { length: MAXIMUM_ISSUE_BODY_LENGTH }) : null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        labels: issue.labels.map((label) =>
          typeof label === 'string' ? { name: label, color: '' } : { name: label.name || '', color: label.color || '' },
        ),
      })),
      total_count: actualIssues.length,
    };
  },
});

/**
 * Tool to search for GitHub repositories
 */
export const searchRepositories = createTool({
  id: 'searchRepositories',
  description: `Searches for GitHub repositories by name or keywords. Returns matching repositories with their details. Defaults to filtering by "${DEFAULT_OWNER}" owner if not specified.`,
  inputSchema: z.object({
    query: z.string().describe('The search query (repository name or keywords)'),
    owner: z
      .string()
      .optional()
      .describe(`Filter by repository owner (defaults to "${DEFAULT_OWNER}" if not provided)`),
  }),
  outputSchema: z.object({
    repositories: z.array(GitHubRepositorySchema),
    total_count: z.number(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || DEFAULT_OWNER;

    // Construct search query with owner filter
    const searchQuery = `${inputData.query} user:${owner}`;

    const { data } = await octokit.rest.search.repos({
      q: searchQuery,
      sort: 'stars',
      order: 'desc',
      per_page: 30,
    });

    return {
      repositories: data.items.map(transformRepo),
      total_count: data.total_count,
    };
  },
});

/**
 * Tool to hand a change to a Claude Code session for implementation
 *
 * The session runs unattended in the host's Docker Sandbox, billed to the
 * user's Claude subscription. Its events are
 * watched from the moment it starts and forwarded into the Synapse vertical as
 * state changes, so progress, questions and failures surface through the same
 * notification path as everything else in the house. The session has no way to
 * push, so the watcher publishes its branch and opens the pull request once a
 * turn ends with the work done.
 */
export const startCodingSession = createTool({
  id: 'startCodingSession',
  description: `Starts a Claude Code session that implements a change autonomously. The session clones the repository and commits the work on a branch, and Jarvis pushes the branch and opens a pull request once it is done. Its events, and the pull request, are reported back into the Synapse vertical as state changes. Defaults to Jarvis's own repository, "${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}", if none is given.`,
  inputSchema: z.object({
    owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}" if not provided)`),
    repo: z
      .string()
      .optional()
      .describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own, if not provided)`),
    request: z.string().describe('What the user asked for, in their own words'),
    title: z.string().optional().describe('A short title for the change, used to describe the session'),
    instructions: z
      .string()
      .optional()
      .describe(
        "Extra instructions for the session, such as what is already known about the codebase and the user's answers to questions about the change",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    session_id: z.string().optional(),
    status: z.string().optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || DEFAULT_OWNER;
    const repo = inputData.repo || DEFAULT_REPOSITORY;
    const repository = `${owner}/${repo}`;

    const task = [
      `Implement the following change in the ${repository} repository.`,
      inputData.title ? `Title: ${inputData.title}` : undefined,
      `\nRequest:\n${inputData.request}`,
      inputData.instructions ? `\n${inputData.instructions}` : undefined,
      // The session starts in an empty directory of its own in the sandbox, so it fetches the code
      // itself — but it pushes nothing: the watcher publishes its branch from the server once it is
      // done (see `publish-session-work.ts`).
      `\n${buildSessionWorkInstructions(repository)}`,
    ]
      .filter((line): line is string => typeof line === 'string')
      .join('\n');

    // A session that fails to start is reported rather than thrown, so the
    // caller can say what went wrong instead of going quiet.
    try {
      const session = await createClaudeSession(task);

      claudeSessionWatcher.watch(session.id, { repository, title: inputData.title, publishTo: { owner, repo } });

      return {
        success: true,
        session_id: session.id,
        status: session.status,
        message: `Started Claude Code session ${session.id} in ${repository}`,
      };
    } catch (error) {
      logger.error('[CLAUDE SESSION] Failed to start session', { repository, error });

      return {
        success: false,
        message: `Could not start a Claude Code session in ${repository}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
});

/** How long {@link runCodingTask} waits for a session before handing back its id instead. */
export const CODING_TASK_TIMEOUT_MILLISECONDS = 15 * 60 * 1000;

/**
 * Tool to have a Claude Code session carry out a task and report back
 *
 * Unlike {@link startCodingSession}, which hands off a change and returns at
 * once because its result is a pull request, this is for work whose result is
 * an answer: it waits for the session to finish its turn and returns the last
 * thing the session said. Other verticals reach it through shortcuts that write
 * the task for their own purpose.
 */
export const runCodingTask = markAsSlow(
  createTool({
    id: 'runCodingTask',
    description:
      'Hands a self-contained task to a Claude Code session, waits for the session to finish, and returns the last message it sent. For work that produces an answer or a link rather than a pull request.',
    inputSchema: z.object({
      task: z.string().describe('The complete instructions for the session; it sees nothing else'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      session_id: z.string().optional(),
      stop_reason: z.string().optional().describe('Why the session stopped, e.g. "end_turn"'),
      final_message: z.string().optional().describe('The last message the session sent'),
      message: z.string(),
    }),
    execute: async (inputData) => {
      // As with startCodingSession, a failure is reported rather than thrown, so
      // the caller can say what went wrong instead of going quiet.
      try {
        const session = await createClaudeSession(inputData.task);
        const finishedTurn = await waitForClaudeSessionTurn(session.id, CODING_TASK_TIMEOUT_MILLISECONDS);

        if (!finishedTurn) {
          return {
            success: false,
            session_id: session.id,
            message: `Claude Code session ${session.id} was still working after ${CODING_TASK_TIMEOUT_MILLISECONDS / 60_000} minutes. It can be followed with getCodingSessionStatus.`,
          };
        }

        return {
          success: finishedTurn.stopReason === 'end_turn',
          session_id: session.id,
          stop_reason: finishedTurn.stopReason,
          final_message: finishedTurn.finalMessage,
          message: `Claude Code session ${session.id} stopped with "${finishedTurn.stopReason}".`,
        };
      } catch (error) {
        logger.error('[CLAUDE SESSION] Failed to run coding task', { error });

        return {
          success: false,
          message: `Could not run the task in a Claude Code session: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
);

/**
 * Turns a question about a repository into the brief a Claude Code session answers it from.
 *
 * The session sees nothing but this text and nobody is watching it, so the brief says everything
 * it would otherwise ask: that it only reads, that it asks nothing, and that its answer is passed
 * on -- read aloud, or handed to another agent such as the page builder -- rather than shown in a
 * terminal. `context` is what the code cannot tell it: most often the failures the reflection
 * agent found, which live in Mastra's own storage where a session cannot reach.
 */
export function buildCodebaseQuestionTask(
  question: string,
  repository: string,
  isJarvisOwn: boolean,
  context?: string,
): string {
  return [
    `Answer a question about the ${repository} repository${isJarvisOwn ? " — Jarvis's own codebase" : ''}, from the user of Jarvis, a voice assistant:`,
    '',
    question.trim(),
    ...(context?.trim() ? ['', 'What is known beyond the code, to take into account:', context.trim()] : []),
    '',
    'How to answer it:',
    `- Clone the repository into the current directory (\`git clone https://github.com/${repository}.git .\` — it needs no credentials) and read the parts of it the question is about, AGENTS.md and CLAUDE.md included.`,
    '- This session only reads: do not change anything, create a branch, open a pull request or file an issue.',
    '- Nobody is there to answer questions, so do not ask any. Make sensible assumptions and carry on.',
    '- Ground every claim in the code, and name the files it is about. Say plainly when the code does not settle something rather than guessing.',
    '- Your final message is the answer. It is passed on as it is -- read aloud, or handed to another agent to act on -- so make it complete on its own: no references to earlier messages, and no questions at the end.',
  ].join('\n');
}

/**
 * Tool to have a Claude Code session read a repository and answer a question about it
 *
 * The read-only counterpart of {@link startCodingSession}: "how does the scheduler work", "review
 * the routing vertical", "what could be improved in Jarvis" all need the code read, but none of
 * them need it changed. Without it, a question about Jarvis's own code had no agent to go to, and
 * the planner sent it to web research, which answered it from the internet.
 */
export const analyzeCodebase = markAsSlow(
  createTool({
    id: 'analyzeCodebase',
    description: `Has a Claude Code session read a repository and answer a question about it: how something works, a code review, ideas for improvement, technical debt, or where something lives. It only reads; nothing is changed. Takes a few minutes. Defaults to Jarvis's own repository, "${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}", if none is given.`,
    inputSchema: z.object({
      owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}" if not provided)`),
      repo: z
        .string()
        .optional()
        .describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own, if not provided)`),
      question: z.string().describe('What to find out about the code, in the words of the request'),
      context: z
        .string()
        .optional()
        .describe(
          'Anything to take into account that the code cannot show, such as recent failures and errors another agent reported. Pass it on in full; the session sees nothing but what it is given',
        ),
    }),
    outputSchema: runCodingTask.outputSchema,
    execute: async (inputData, context) => {
      const owner = inputData.owner || DEFAULT_OWNER;
      const repo = inputData.repo || DEFAULT_REPOSITORY;

      return await executeTool(
        runCodingTask,
        {
          task: buildCodebaseQuestionTask(
            inputData.question,
            `${owner}/${repo}`,
            owner === DEFAULT_OWNER && repo === DEFAULT_REPOSITORY,
            inputData.context,
          ),
        },
        context,
      );
    },
  }),
);

/**
 * How many of a session's messages {@link getCodingSessionStatus} hands back.
 *
 * "How is it going?" is answered by what the session said last. A session that has worked for an
 * hour has said a great deal more, and all of it used to be fetched page by page and then read by
 * the model before a word of the answer.
 */
export const LATEST_SESSION_MESSAGE_COUNT = 5;

/**
 * Tool to check what a Claude Code session is currently doing
 */
export const getCodingSessionStatus = createTool({
  id: 'getCodingSessionStatus',
  description: `Gets the current status of a Claude Code session started for a coding task, along with the last ${LATEST_SESSION_MESSAGE_COUNT} messages it sent.`,
  inputSchema: z.object({
    session_id: z.string().describe('The Claude Code session ID'),
  }),
  outputSchema: z.object({
    session_id: z.string(),
    status: z.enum(['running', 'idle']),
    messages: z.array(z.string()).describe('The latest messages the session sent, oldest of them first'),
  }),
  execute: async (inputData) => {
    const session = getClaudeSession(inputData.session_id);

    return {
      session_id: session.id,
      status: session.status,
      messages: listLatestClaudeSessionMessages(inputData.session_id, LATEST_SESSION_MESSAGE_COUNT),
    };
  },
});

/**
 * Tool to steer a running Claude Code session
 */
export const sendCodingSessionMessage = createTool({
  id: 'sendCodingSessionMessage',
  description:
    'Sends a follow-up message to a running Claude Code session, to answer a question it asked or to redirect the work it is doing.',
  inputSchema: z.object({
    session_id: z.string().describe('The Claude Code session ID'),
    message: z.string().describe('The message to send to the session'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    await sendClaudeSessionMessage(inputData.session_id, inputData.message);

    return {
      success: true,
      message: `Sent message to Claude Code session ${inputData.session_id}`,
    };
  },
});

/**
 * Tool to create a new GitHub issue
 */
export const createGitHubIssue = createTool({
  id: 'createGitHubIssue',
  description: `Creates a new GitHub issue with the given title, body, and optional labels. Useful for reporting errors or bugs. Defaults to Jarvis's own repository, "${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}", if none is given.`,
  inputSchema: z.object({
    owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}" if not provided)`),
    repo: z
      .string()
      .optional()
      .describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own, if not provided)`),
    title: z.string().describe('The issue title'),
    body: z.string().describe('The issue description/body'),
    labels: z.array(z.string()).optional().describe('Optional labels to add to the issue (e.g., ["bug", "error"])'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || DEFAULT_OWNER;

    const { data: issue } = await octokit.rest.issues.create({
      owner,
      repo: inputData.repo || DEFAULT_REPOSITORY,
      title: inputData.title,
      body: inputData.body,
      labels: inputData.labels || [],
    });

    return {
      success: true,
      issue_number: issue.number,
      issue_url: issue.html_url,
      message: `Successfully created issue #${issue.number}`,
    };
  },
});

/**
 * Tool to update an existing GitHub issue
 */
export const updateGitHubIssue = createTool({
  id: 'updateGitHubIssue',
  description: `Updates an existing GitHub issue with new title, body, labels, or state. Useful for updating draft issues with accumulated requirements. Defaults to Jarvis's own repository, "${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}", if none is given.`,
  inputSchema: z.object({
    owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}" if not provided)`),
    repo: z
      .string()
      .optional()
      .describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own, if not provided)`),
    issue_number: z.number().describe('The issue number to update'),
    title: z.string().optional().describe('Updated issue title'),
    body: z.string().optional().describe('Updated issue description/body'),
    labels: z.array(z.string()).optional().describe('Updated labels for the issue'),
    state: z.enum(['open', 'closed']).optional().describe('Updated state of the issue'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || DEFAULT_OWNER;

    const updateData: IssueUpdateParams = {
      owner,
      repo: inputData.repo || DEFAULT_REPOSITORY,
      issue_number: inputData.issue_number,
    };

    if (inputData.title !== undefined) updateData.title = inputData.title;
    if (inputData.body !== undefined) updateData.body = inputData.body;
    if (inputData.labels !== undefined) updateData.labels = inputData.labels;
    if (inputData.state !== undefined) updateData.state = inputData.state;

    const { data: issue } = await octokit.rest.issues.update(updateData);

    return {
      success: true,
      issue_number: issue.number,
      issue_url: issue.html_url,
      message: `Successfully updated issue #${issue.number}`,
    };
  },
});

// Export all tools together for convenience
export const codingTools = {
  listUserRepositories,
  listRepositoryIssues,
  searchRepositories,
  analyzeCodebase,
  getCodingSessionStatus,
  sendCodingSessionMessage,
};
