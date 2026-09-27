/**
 * Publishes a Claude Code session's work to GitHub from the server, never from the sandbox.
 *
 * A session works only locally: it clones the repository without credentials, commits on a
 * `jarvis/…` branch, and ends its turn on a fenced `jarvis-pull-request` block naming the branch
 * and the pull request's title and body. The sandbox holds no GitHub credential that can push, so
 * a session that goes wrong — or is talked into going wrong by what it reads — cannot push
 * anywhere, and cannot touch the repository's CI.
 *
 * The server is the trusted side, so it decides what is published. Once a turn ends with the
 * block, it fetches the session's branches from the host as a git bundle (`export`, see
 * `claude-code-host.ts`), and in a temporary directory:
 *
 * 1. clones the repository's default branch from GitHub, which holds every commit the bundle
 *    builds on (the host bundles everything but what the default branch had),
 * 2. fetches the named branch out of the bundle,
 * 3. refuses a branch outside `jarvis/`, the default branch itself, a branch with no commits of its
 *    own, and one whose {@link CI_PROTECTED_PATHS} differ from the default branch's — branches of
 *    the repository itself, and pull requests from them, run its workflows with its secrets,
 * 4. pushes the branch with `HEY_JARVIS_GITHUB_API_TOKEN`, which reaches git through its
 *    environment and never a command line, and
 * 5. opens the pull request, or finds the one already open for the branch.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { exportSessionWorkOverSsh, type SessionWorkExporter } from './claude-code-host.js';
import { octokit } from './github-client.js';

/** Every branch a session's work is published on starts with this, and no other branch is pushed. */
export const BRANCH_PREFIX = 'jarvis/';

/** The largest bundle of a session's work the server accepts. Past it, the export is dropped. */
export const MAXIMUM_BUNDLE_BYTES = 50 * 1024 * 1024;

/**
 * What a session's work may never change: anything that decides what CI runs.
 *
 * A pull request from a branch of the repository itself runs its workflows with the repository's
 * secrets, so a branch that changed them would hand a session those secrets. An entry ending in `/`
 * covers a directory and everything in it; any other entry is a single file.
 */
export const CI_PROTECTED_PATHS = ['.github/workflows/', '.github/actions/', '.github/actions.lock'] as const;

/** The info string of the fenced block a session ends its final message on. */
export const SESSION_WORK_FENCE = 'jarvis-pull-request';

/** How long a single git command may run — the clone of a large repository on a Pi included. */
const GIT_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;

/** Longest stretch of git's stderr kept for reporting why it failed. */
const MAXIMUM_STDERR_LENGTH = 2000;

/** What a session says it did: the branch its work is on, and the pull request to open for it. */
export const sessionWorkSchema = z.object({
  branch: z.string().trim().min(1),
  title: z.string().trim().min(1).max(256),
  body: z.string().default(''),
});

export type SessionWork = z.infer<typeof sessionWorkSchema>;

/** What a final message says about the session's work. */
export type SessionWorkReading =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'found'; work: SessionWork };

/**
 * The part of a session's task that says how its work gets published: clone without credentials,
 * commit on a `jarvis/` branch, push nothing, and end on the block {@link readSessionWork} reads.
 *
 * @param repository - The repository, as `owner/repo`
 */
export function buildSessionWorkInstructions(repository: string): string {
  return `Start by cloning the repository into the current directory with \`git clone https://github.com/${repository}.git .\` — it needs no credentials. Create a branch named \`${BRANCH_PREFIX}<a few words describing the change, in kebab-case>\`, and commit your work on it, following the repository's conventions in AGENTS.md and CLAUDE.md, commit messages included. Run the tests.

Do not push and do not open a pull request: this sandbox has no GitHub credentials for either. Jarvis publishes the branch and opens the pull request once your turn ends. He refuses a branch whose name does not start with \`${BRANCH_PREFIX}\`, and any change to ${CI_PROTECTED_PATHS.join(', ')}, so leave CI alone.

When the work is committed, end your final message with this block and nothing after it: the branch, the pull request's title (in the repository's commit message style) and its description in Markdown, as JSON.

\`\`\`${SESSION_WORK_FENCE}
{"branch": "${BRANCH_PREFIX}…", "title": "…", "body": "…"}
\`\`\`

End on that block only when the work is done and committed. If you stop to ask a question instead, leave it out; it is what tells Jarvis to publish.`;
}

/**
 * Reads the `jarvis-pull-request` block a session ends its final message on.
 *
 * The block is the last thing in the message, so its closing fence is the message's last one — a
 * description may well contain fences of its own. The opening one is looked for from the end, and
 * the first that holds valid JSON wins, in case the message mentioned the block before writing it.
 */
export function readSessionWork(finalMessage: string): SessionWorkReading {
  const opening = `\`\`\`${SESSION_WORK_FENCE}`;
  const closing = finalMessage.lastIndexOf('```');
  let reason: string | undefined;

  for (
    let start = finalMessage.lastIndexOf(opening);
    start !== -1;
    start = start === 0 ? -1 : finalMessage.lastIndexOf(opening, start - 1)
  ) {
    if (closing <= start) {
      reason = 'The block has no closing fence.';
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(finalMessage.slice(start + opening.length, closing));
    } catch {
      reason = 'The block is not valid JSON.';
      continue;
    }

    const work = sessionWorkSchema.safeParse(parsed);
    if (work.success) {
      return { status: 'found', work: work.data };
    }
    reason = `The block is not a branch, title and body: ${work.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`;
  }

  return reason ? { status: 'invalid', reason } : { status: 'absent' };
}

/**
 * Says what is wrong with a branch name, if anything: it has to start with {@link BRANCH_PREFIX},
 * and be an ordinary branch name — git checks the rest once the branch is fetched.
 */
export function checkBranchName(branch: string): string | undefined {
  if (!branch.startsWith(BRANCH_PREFIX) || branch.length === BRANCH_PREFIX.length) {
    return `The branch "${branch}" does not start with "${BRANCH_PREFIX}", and only such branches are published.`;
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    return `The branch "${branch}" has characters other than letters, digits, ".", "_", "-" and "/".`;
  }

  return undefined;
}

/** The changed paths that fall under {@link CI_PROTECTED_PATHS}. */
export function findProtectedPaths(changedPaths: readonly string[]): string[] {
  return changedPaths.filter((changedPath) =>
    CI_PROTECTED_PATHS.some((protectedPath) =>
      protectedPath.endsWith('/') ? changedPath.startsWith(protectedPath) : changedPath === protectedPath,
    ),
  );
}

/** A pull request, as the user is told about it. */
export interface PublishedPullRequest {
  number: number;
  url: string;
}

/** How publishing a session's work turned out. */
export type SessionWorkPublication =
  | { status: 'published'; branch: string; pullRequest: PublishedPullRequest; created: boolean }
  | { status: 'refused'; reason: string }
  | { status: 'failed'; reason: string };

/** Where the work goes. */
export interface PublishTarget {
  owner: string;
  repo: string;
}

/** Everything publishing reaches outside the process; tests swap each for a local stand-in. */
export interface SessionWorkPublisherDependencies {
  exportWork: SessionWorkExporter;
  /** Where the repository is cloned from and pushed to. */
  remoteUrl: (target: PublishTarget) => string;
  /** The token git pushes with. Only ever handed to git through its environment. */
  token: string | undefined;
  findOpenPullRequest: (target: PublishTarget, branch: string) => Promise<PublishedPullRequest | undefined>;
  createPullRequest: (
    target: PublishTarget,
    pullRequest: { head: string; base: string; title: string; body: string },
  ) => Promise<PublishedPullRequest>;
}

const GITHUB_DEPENDENCIES: SessionWorkPublisherDependencies = {
  exportWork: exportSessionWorkOverSsh,
  remoteUrl: ({ owner, repo }) => `https://github.com/${owner}/${repo}.git`,
  get token() {
    return process.env.HEY_JARVIS_GITHUB_API_TOKEN || undefined;
  },
  findOpenPullRequest: async ({ owner, repo }, branch) => {
    const { data } = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: 'open' });
    return data[0] ? { number: data[0].number, url: data[0].html_url } : undefined;
  },
  createPullRequest: async ({ owner, repo }, pullRequest) => {
    const { data } = await octokit.rest.pulls.create({ owner, repo, ...pullRequest });
    return { number: data.number, url: data.html_url };
  },
};

/** A refusal: the work is not published, and the reason is the session's to fix, not a fault. */
class PublishRefusedError extends Error {}

/**
 * The environment every git command runs with: none of the server's own, no user or system
 * configuration, never a prompt — and the token, when there is one, as an `http.extraHeader` for
 * GitHub alone, set through `GIT_CONFIG_*` so it is never on a command line.
 *
 * `SYSTEMROOT`, `TEMP` and `TMP` are carried over only where they exist, which is Windows, where git
 * cannot start without them.
 *
 * @internal Exported for tests.
 */
export function buildGitEnvironment(home: string, token: string | undefined): NodeJS.ProcessEnv {
  const configuration: [string, string][] = [];
  if (token) {
    const credentials = Buffer.from(`x-access-token:${token}`).toString('base64');
    configuration.push(['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${credentials}`]);
  }

  const passedThrough = Object.fromEntries(
    ['SYSTEMROOT', 'TEMP', 'TMP'].flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  );

  return {
    ...passedThrough,
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: String(configuration.length),
    ...Object.fromEntries(
      configuration.flatMap(([key, value], index) => [
        [`GIT_CONFIG_KEY_${index}`, key],
        [`GIT_CONFIG_VALUE_${index}`, value],
      ]),
    ),
  };
}

/** Runs git, and returns what it printed; throws with the end of its stderr when it fails. */
function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env });
    const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MILLISECONDS);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAXIMUM_STDERR_LENGTH);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args[0]} failed (${signal ?? `exit code ${code}`}): ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Publishes the work a session's final message describes: pushes its branch and opens a pull
 * request for it.
 *
 * @param sessionId - The session whose work it is
 * @param target - The repository the session worked on, and the work goes to
 * @param finalMessage - What the session said last in the turn that just ended
 * @returns Nothing when the message carries no `jarvis-pull-request` block — the session is not done,
 *   or asked a question — and otherwise how publishing went. Never throws.
 */
export async function publishSessionWork(
  sessionId: string,
  target: PublishTarget,
  finalMessage: string,
  dependencies: SessionWorkPublisherDependencies = GITHUB_DEPENDENCIES,
): Promise<SessionWorkPublication | undefined> {
  const reading = readSessionWork(finalMessage);
  if (reading.status === 'absent') {
    return undefined;
  }
  if (reading.status === 'invalid') {
    return {
      status: 'refused',
      reason: `The session's final message has a ${SESSION_WORK_FENCE} block Jarvis cannot read. ${reading.reason}`,
    };
  }

  const { work } = reading;
  const branchProblem = checkBranchName(work.branch);
  if (branchProblem) {
    return { status: 'refused', reason: branchProblem };
  }

  const token = dependencies.token;
  if (!token) {
    return { status: 'failed', reason: 'HEY_JARVIS_GITHUB_API_TOKEN is not set, so Jarvis cannot push the work.' };
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'jarvis-publish-'));
  try {
    const { pullRequest, created } = await pushSessionWork(sessionId, target, work, token, directory, dependencies);
    logger.info('[CLAUDE SESSION] Published session work', {
      sessionId,
      branch: work.branch,
      pullRequest: pullRequest.url,
      created,
    });
    return { status: 'published', branch: work.branch, pullRequest, created };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof PublishRefusedError) {
      logger.warn('[CLAUDE SESSION] Refused to publish session work', { sessionId, branch: work.branch, reason });
      return { status: 'refused', reason };
    }

    logger.error('[CLAUDE SESSION] Failed to publish session work', { sessionId, branch: work.branch, reason });
    return { status: 'failed', reason };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function pushSessionWork(
  sessionId: string,
  target: PublishTarget,
  work: SessionWork,
  token: string,
  directory: string,
  dependencies: SessionWorkPublisherDependencies,
): Promise<{ pullRequest: PublishedPullRequest; created: boolean }> {
  const bundlePath = path.join(directory, 'work.bundle');
  const repository = path.join(directory, 'repository.git');
  const env = buildGitEnvironment(directory, token);
  const remote = dependencies.remoteUrl(target);
  const branchRef = `refs/heads/${work.branch}`;

  await writeFile(bundlePath, await dependencies.exportWork(sessionId, MAXIMUM_BUNDLE_BYTES));

  // The default branch alone, and without its file contents: the bundle builds only on commits of
  // that branch, and git fetches whatever blob it turns out to need.
  await runGit(
    ['clone', '--quiet', '--bare', '--single-branch', '--no-tags', '--filter=blob:none', remote, repository],
    directory,
    env,
  );
  const defaultBranch = (await runGit(['symbolic-ref', '--short', 'HEAD'], repository, env)).trim();
  if (work.branch === defaultBranch) {
    throw new PublishRefusedError(`The branch "${work.branch}" is the default branch, which is never pushed to.`);
  }

  const bundledRefs = (await runGit(['bundle', 'list-heads', bundlePath], repository, env))
    .split('\n')
    .map((line) => line.split(' ')[1]);
  if (!bundledRefs.includes(branchRef)) {
    throw new PublishRefusedError(`The session's repository has no branch "${work.branch}".`);
  }

  await runGit(['check-ref-format', branchRef], repository, env).catch(() => {
    throw new PublishRefusedError(`"${work.branch}" is not a valid branch name.`);
  });
  // What comes out of the bundle was written in the sandbox, so git checks every object it takes in.
  await runGit(
    ['-c', 'fetch.fsckObjects=true', 'fetch', '--quiet', '--no-tags', bundlePath, `${branchRef}:${branchRef}`],
    repository,
    env,
  );

  const defaultRef = `refs/heads/${defaultBranch}`;
  const commitCount = Number(
    (await runGit(['rev-list', '--count', `${defaultRef}..${branchRef}`], repository, env)).trim(),
  );
  if (commitCount === 0) {
    throw new PublishRefusedError(`The branch "${work.branch}" has no commits that ${defaultBranch} does not.`);
  }

  // The branch's CI has to be the default branch's CI as it is now, not merely unchanged since the
  // branch left it: a pushed branch runs the workflows in its own head commit, and one based on an
  // old commit would otherwise bring back that commit's workflows, fixes since then undone. A
  // branch that is only behind a change to CI is refused too, and is published once it is rebased.
  const differingPaths = (
    await runGit(['diff', '--name-only', '--no-renames', '-z', defaultRef, branchRef], repository, env)
  )
    .split('\0')
    .filter(Boolean);
  const protectedPaths = findProtectedPaths(differingPaths);
  if (protectedPaths.length > 0) {
    throw new PublishRefusedError(
      `The branch "${work.branch}" has CI that differs from ${defaultBranch}'s, and sessions may never change CI: ` +
        `${protectedPaths.join(', ')}. If ${defaultBranch} changed it since the session started, rebase the branch.`,
    );
  }

  // Not forced: a branch someone else has pushed to since is left alone, and the push fails.
  await runGit(['push', '--quiet', remote, `${branchRef}:${branchRef}`], repository, env);

  const existing = await dependencies.findOpenPullRequest(target, work.branch);
  if (existing) {
    return { pullRequest: existing, created: false };
  }

  const pullRequest = await dependencies.createPullRequest(target, {
    head: work.branch,
    base: defaultBranch,
    title: work.title,
    body: work.body,
  });
  return { pullRequest, created: true };
}
