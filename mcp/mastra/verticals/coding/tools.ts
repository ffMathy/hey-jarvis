import { z } from 'zod';
import { Octokit } from 'octokit';
import { createTool } from '../../utils/tool-factory.js';

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

// Helper function to transform Octokit repo to our schema format
const transformRepo = (repo: OctokitRepo | OctokitSearchRepo) => ({
  id: repo.id,
  name: repo.name,
  full_name: repo.full_name,
  description: repo.description,
  html_url: repo.html_url,
  stargazers_count: repo.stargazers_count,
  language: repo.language,
  updated_at: repo.updated_at,
  topics: repo.topics || [],
});

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

/**
 * Tool to list all repositories for a GitHub user
 */
export const listUserRepositories = createTool({
  id: 'list-user-repositories',
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
  execute: async ({ context }) => {
    const username = context.username || 'ffMathy';

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
  id: 'list-repository-issues',
  description:
    'Lists all issues for a specific GitHub repository. Can filter by state (open/closed/all). Defaults to "ffMathy" owner if not specified.',
  inputSchema: z.object({
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy" if not provided)'),
    repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
    state: z.enum(['open', 'closed', 'all']).default('open').describe('Filter issues by state'),
  }),
  outputSchema: z.object({
    issues: z.array(GitHubIssueSchema),
    total_count: z.number(),
  }),
  execute: async ({ context }) => {
    const owner = context.owner || 'ffMathy';

    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo: context.repo,
      state: context.state,
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
        body: issue.body,
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
  id: 'search-repositories',
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
  execute: async ({ context }) => {
    const owner = context.owner || 'ffMathy';

    // Construct search query with owner filter
    const searchQuery = `${context.query} user:${owner}`;

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
 * Tool to provide instructions for assigning GitHub Copilot to an issue
 *
 * NOTE: This is an informational tool that provides guidance for manual Copilot assignment.
 * It does NOT automatically start a coding task. Automation requires GitHub App installation
 * and MCP server configuration with proper authentication.
 */
export const assignCopilotToIssue = createTool({
  id: 'assign-copilot-to-issue',
  description:
    'Provides instructions for assigning GitHub Copilot Coding Agent to a specific issue. This is an informational tool that does NOT automatically start a coding task. To enable automation, install the GitHub App and configure the MCP server with proper permissions. Defaults to "ffMathy" owner if not specified.',
  inputSchema: z.object({
    owner: z.string().optional().describe('The repository owner (defaults to "ffMathy" if not provided)'),
    repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
    issue_number: z.number().describe('The issue number to assign Copilot to'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    task_url: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const owner = context.owner || 'ffMathy';

    // This is an informational tool that provides instructions for manual assignment
    // Automation would require GitHub App installation and proper MCP server configuration

    const issueUrl = `https://github.com/${owner}/${context.repo}/issues/${context.issue_number}`;

    return {
      success: false,
      message: `GitHub Copilot assignment requires the GitHub App to be installed with proper permissions. Please visit ${issueUrl} and manually assign @copilot to the issue, or configure the GitHub MCP server with authentication tokens.`,
      task_url: issueUrl,
    };
  },
});

/**
 * Tool to create a new GitHub issue
 */
export const createGitHubIssue = createTool({
  id: 'create-github-issue',
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
  execute: async ({ context }) => {
    const owner = context.owner || 'ffMathy';

    try {
      const { data: issue } = await octokit.rest.issues.create({
        owner,
        repo: context.repo,
        title: context.title,
        body: context.body,
        labels: context.labels || [],
      });

      return {
        success: true,
        issue_number: issue.number,
        issue_url: issue.html_url,
        message: `Successfully created issue #${issue.number}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create issue: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// Export all tools together for convenience
export const codingTools = {
  listUserRepositories,
  listRepositoryIssues,
  searchRepositories,
  assignCopilotToIssue,
  createGitHubIssue,
};
