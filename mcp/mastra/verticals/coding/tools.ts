import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// GitHub Repository Schema
const GitHubRepositorySchema = z.object({
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

// GitHub Issue Schema
const GitHubIssueSchema = z.object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    html_url: z.string(),
    body: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    labels: z.array(z.object({
        name: z.string(),
        color: z.string(),
    })).optional(),
});

/**
 * Tool to list all repositories for a GitHub user
 */
export const listUserRepositories = createTool({
    id: 'list-user-repositories',
    description: 'Lists all public repositories for a given GitHub username. Returns repository information including name, description, stars, and language.',
    inputSchema: z.object({
        username: z.string().describe('The GitHub username to list repositories for (e.g., "ffMathy")'),
    }),
    outputSchema: z.object({
        repositories: z.array(GitHubRepositorySchema),
        total_count: z.number(),
    }),
    execute: async ({ context }) => {
        const response = await fetch(
            `https://api.github.com/users/${context.username}/repos?sort=updated&per_page=100`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Hey-Jarvis-MCP-Server',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const repositories = await response.json();
        
        return {
            repositories: repositories.map((repo: any) => ({
                id: repo.id,
                name: repo.name,
                full_name: repo.full_name,
                description: repo.description,
                html_url: repo.html_url,
                stargazers_count: repo.stargazers_count,
                language: repo.language,
                updated_at: repo.updated_at,
                topics: repo.topics || [],
            })),
            total_count: repositories.length,
        };
    },
});

/**
 * Tool to list all issues for a specific repository
 */
export const listRepositoryIssues = createTool({
    id: 'list-repository-issues',
    description: 'Lists all issues for a specific GitHub repository. Can filter by state (open/closed/all).',
    inputSchema: z.object({
        owner: z.string().describe('The repository owner (e.g., "ffMathy")'),
        repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
        state: z.enum(['open', 'closed', 'all']).default('open').describe('Filter issues by state'),
    }),
    outputSchema: z.object({
        issues: z.array(GitHubIssueSchema),
        total_count: z.number(),
    }),
    execute: async ({ context }) => {
        const response = await fetch(
            `https://api.github.com/repos/${context.owner}/${context.repo}/issues?state=${context.state}&per_page=100`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Hey-Jarvis-MCP-Server',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const issues = await response.json();
        
        // Filter out pull requests (GitHub API includes PRs in issues endpoint)
        const actualIssues = issues.filter((issue: any) => !issue.pull_request);
        
        return {
            issues: actualIssues.map((issue: any) => ({
                number: issue.number,
                title: issue.title,
                state: issue.state,
                html_url: issue.html_url,
                body: issue.body,
                created_at: issue.created_at,
                updated_at: issue.updated_at,
                labels: issue.labels?.map((label: any) => ({
                    name: label.name,
                    color: label.color,
                })) || [],
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
    description: 'Searches for GitHub repositories by name or keywords. Returns matching repositories with their details.',
    inputSchema: z.object({
        query: z.string().describe('The search query (repository name or keywords)'),
        owner: z.string().optional().describe('Optional: Filter by repository owner (e.g., "ffMathy")'),
    }),
    outputSchema: z.object({
        repositories: z.array(GitHubRepositorySchema),
        total_count: z.number(),
    }),
    execute: async ({ context }) => {
        // Construct search query
        let searchQuery = context.query;
        if (context.owner) {
            searchQuery = `${context.query} user:${context.owner}`;
        }

        const response = await fetch(
            `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc&per_page=30`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Hey-Jarvis-MCP-Server',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        return {
            repositories: data.items.map((repo: any) => ({
                id: repo.id,
                name: repo.name,
                full_name: repo.full_name,
                description: repo.description,
                html_url: repo.html_url,
                stargazers_count: repo.stargazers_count,
                language: repo.language,
                updated_at: repo.updated_at,
                topics: repo.topics || [],
            })),
            total_count: data.total_count,
        };
    },
});

/**
 * Tool to assign GitHub Copilot to an issue (start a coding task)
 */
export const assignCopilotToIssue = createTool({
    id: 'assign-copilot-to-issue',
    description: 'Assigns GitHub Copilot Coding Agent to work on a specific issue. This starts an automated coding task based on the issue description. Note: This requires the GitHub App to be installed and proper permissions.',
    inputSchema: z.object({
        owner: z.string().describe('The repository owner (e.g., "ffMathy")'),
        repo: z.string().describe('The repository name (e.g., "hey-jarvis")'),
        issue_number: z.number().describe('The issue number to assign Copilot to'),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        task_url: z.string().optional(),
    }),
    execute: async ({ context, mastra }) => {
        // This tool uses the GitHub MCP server integration if available
        // The actual implementation would use the github-mcp-server-assign_copilot_to_issue tool
        // For now, we'll provide a simulated response that indicates the tool is available
        // but requires proper GitHub App authentication
        
        try {
            // In a real implementation, this would call the GitHub MCP tool
            // For now, we return a helpful message
            const issueUrl = `https://github.com/${context.owner}/${context.repo}/issues/${context.issue_number}`;
            
            return {
                success: false,
                message: `GitHub Copilot assignment requires the GitHub App to be installed with proper permissions. Please visit ${issueUrl} and manually assign @copilot to the issue, or configure the GitHub MCP server with authentication tokens.`,
                task_url: issueUrl,
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to assign Copilot: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    },
});

// Export all tools as an array
export const codingTools = [
    listUserRepositories,
    listRepositoryIssues,
    searchRepositories,
    assignCopilotToIssue,
];
