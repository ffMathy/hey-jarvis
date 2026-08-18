import { pick } from 'lodash-es';
import { Octokit } from 'octokit';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';
import {
  createClaudeSession,
  getClaudeSession,
  getClaudeSessionUrl,
  listClaudeSessionEvents,
  sendClaudeSessionMessage,
} from './claude-sessions.js';
import { claudeSessionWatcher } from './session-watcher.js';

// Create Octokit instance with optional GitHub token authentication
// Using HEY_JARVIS_GITHUB_API_TOKEN for consistency with other env vars
const octokit = new Octokit({
  userAgent: 'Hey-Jarvis-MCP-Server',
  auth: process.env.HEY_JARVIS_GITHUB_API_TOKEN,
});

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
  body: z.string().nullable(),
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
  description:
    'Lists all public repositories for a given GitHub username. Returns repository information including name, description, stars, and language. Defaults to "ffMathy" if no username is provided.',
  inputSchema: z.object({
    username: z
      .string()
      .optional()
      .describe('The GitHub username to list repositories for (defaults to "ffMathy" if not provided)'),
  }),
  outputSchema: z.object({
    repositories: z.array(GitHubRepositorySchema),
    total_count: z.number(),
  }),
  execute: async (inputData) => {
    const username = inputData.username || 'ffMathy';

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
 * Tool to list all issues for a specific repository
 */
export const listRepositoryIssues = createTool({
  id: 'listRepositoryIssues',
  description:
    'Lists all issues for a specific GitHub repository. Can filter by state (open/closed/all). Defaults to "ffMathy" owner if not specified.',
  inputSchema: z.object({
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy" if not provided)'),
    repo: z.string().optional().describe('The repository name (defaults to "hey-jarvis" if not provided)'),
    state: z.enum(['open', 'closed', 'all']).default('open').describe('Filter issues by state'),
  }),
  outputSchema: z.object({
    issues: z.array(GitHubIssueSchema),
    total_count: z.number(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || 'ffMathy';
    const repo = inputData.repo || 'hey-jarvis';

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
        body: issue.body ?? null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        labels:
          issue.labels.map((label) =>
            typeof label === 'string'
              ? { name: label, color: '' }
              : { name: label.name || '', color: label.color || '' },
          ) || [],
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
  description:
    'Searches for GitHub repositories by name or keywords. Returns matching repositories with their details. Defaults to filtering by "ffMathy" owner if not specified.',
  inputSchema: z.object({
    query: z.string().describe('The search query (repository name or keywords)'),
    owner: z.string().optional().describe('Filter by repository owner (defaults to "ffMathy" if not provided)'),
  }),
  outputSchema: z.object({
    repositories: z.array(GitHubRepositorySchema),
    total_count: z.number(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || 'ffMathy';

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
 * Tool to hand an issue to a Claude cloud session for implementation
 *
 * The session runs unattended in a sandboxed cloud environment. Its events are
 * watched from the moment it starts and forwarded into the Synapse vertical as
 * state changes, so progress, questions and failures surface through the same
 * notification path as everything else in the house.
 */
export const startCodingSession = createTool({
  id: 'startCodingSession',
  description:
    'Starts a Claude cloud session that implements a GitHub issue autonomously. The session clones the repository, does the work and opens a pull request. Its events are reported back into the Synapse vertical as state changes. Defaults to "ffMathy" owner if not specified.',
  inputSchema: z.object({
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy" if not provided)'),
    repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
    issue_number: z.number().describe('The issue number the session should implement'),
    title: z.string().optional().describe('The issue title, used to describe the session'),
    instructions: z
      .string()
      .optional()
      .describe('Extra instructions for the session, such as the gathered requirements'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    session_id: z.string().optional(),
    session_url: z.string().optional(),
    status: z.string().optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const owner = inputData.owner || 'ffMathy';
    const repository = `${owner}/${inputData.repo}`;
    const issueUrl = `https://github.com/${repository}/issues/${inputData.issue_number}`;

    const task = [
      `Implement GitHub issue #${inputData.issue_number} in the ${repository} repository.`,
      `Issue: ${issueUrl}`,
      inputData.title ? `Title: ${inputData.title}` : undefined,
      inputData.instructions ? `\nRequirements:\n${inputData.instructions}` : undefined,
      '\nWork on a dedicated branch, follow the repository conventions in AGENTS.md and CLAUDE.md, run the tests, and open a pull request that closes the issue when you are done.',
    ]
      .filter((line): line is string => typeof line === 'string')
      .join('\n');

    // A session that fails to start is reported rather than thrown, so the
    // caller still learns about the issue that was created for it.
    try {
      const session = await createClaudeSession(task, { repository, issueNumber: inputData.issue_number });

      claudeSessionWatcher.watch(session.id, {
        repository,
        issueNumber: inputData.issue_number,
        title: inputData.title,
      });

      return {
        success: true,
        session_id: session.id,
        session_url: getClaudeSessionUrl(session.id),
        status: session.status,
        message: `Started Claude cloud session ${session.id} for issue #${inputData.issue_number}`,
      };
    } catch (error) {
      logger.error('[CLAUDE SESSION] Failed to start session', {
        repository,
        issueNumber: inputData.issue_number,
        error,
      });

      return {
        success: false,
        message: `Could not start a Claude cloud session for ${issueUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
});

/**
 * Tool to check what a Claude cloud session is currently doing
 */
export const getCodingSessionStatus = createTool({
  id: 'getCodingSessionStatus',
  description:
    'Gets the current status of a Claude cloud session started for a coding task, along with the messages it has produced so far.',
  inputSchema: z.object({
    session_id: z.string().describe('The Claude cloud session ID'),
  }),
  outputSchema: z.object({
    session_id: z.string(),
    session_url: z.string(),
    status: z.string(),
    messages: z.array(z.string()),
  }),
  execute: async (inputData) => {
    const [session, events] = await Promise.all([
      getClaudeSession(inputData.session_id),
      listClaudeSessionEvents(inputData.session_id),
    ]);

    const messages = events
      .filter((event) => event.type === 'agent.message')
      .map((event) =>
        event.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
      )
      .filter((message) => message.length > 0);

    return {
      session_id: session.id,
      session_url: getClaudeSessionUrl(session.id),
      status: session.status,
      messages,
    };
  },
});

/**
 * Tool to steer a running Claude cloud session
 */
export const sendCodingSessionMessage = createTool({
  id: 'sendCodingSessionMessage',
  description:
    'Sends a follow-up message to a running Claude cloud session, to answer a question it asked or to redirect the work it is doing.',
  inputSchema: z.object({
    session_id: z.string().describe('The Claude cloud session ID'),
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
      message: `Sent message to Claude cloud session ${inputData.session_id}`,
    };
  },
});

/**
 * Tool to create a new GitHub issue
 */
export const createGitHubIssue = createTool({
  id: 'createGitHubIssue',
  description:
    'Creates a new GitHub issue with the given title, body, and optional labels. Useful for reporting errors or bugs. Defaults to "ffMathy" owner if not specified.',
  inputSchema: z.object({
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy" if not provided)'),
    repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
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
    const owner = inputData.owner || 'ffMathy';

    const { data: issue } = await octokit.rest.issues.create({
      owner,
      repo: inputData.repo,
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
  description:
    'Updates an existing GitHub issue with new title, body, labels, or state. Useful for updating draft issues with accumulated requirements. Defaults to "ffMathy" owner if not specified.',
  inputSchema: z.object({
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy" if not provided)'),
    repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
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
    const owner = inputData.owner || 'ffMathy';

    const updateData: IssueUpdateParams = {
      owner,
      repo: inputData.repo,
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
  getCodingSessionStatus,
  sendCodingSessionMessage,
};
