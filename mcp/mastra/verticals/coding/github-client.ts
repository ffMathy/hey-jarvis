import { Octokit } from 'octokit';

/**
 * The coding vertical's GitHub client, signed in with `HEY_JARVIS_GITHUB_API_TOKEN` when it is set.
 *
 * Shared by the tools, which read repositories and issues, and by the publisher, which opens the
 * pull request for a session's work (`publish-session-work.ts`).
 */
export const octokit: Octokit = new Octokit({
  userAgent: 'Hey-Jarvis-MCP-Server',
  auth: process.env.HEY_JARVIS_GITHUB_API_TOKEN,
});
