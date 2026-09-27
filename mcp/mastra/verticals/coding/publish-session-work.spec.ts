/**
 * Publishing a session's work from the server: what it reads out of the session's last message,
 * what it refuses to push, and what it pushes.
 *
 * Nothing here reaches the network. GitHub is a bare repository in a directory of the test's own,
 * served over `file://` with partial clones allowed, as GitHub allows them; the session's sandbox
 * is a clone of it, and the export is the same `git bundle create` the host's forced command runs.
 * Only the two pull request calls are fakes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BRANCH_PREFIX,
  buildGitEnvironment,
  buildSessionWorkInstructions,
  CI_PROTECTED_PATHS,
  checkBranchName,
  findProtectedPaths,
  MAXIMUM_BUNDLE_BYTES,
  type PublishedPullRequest,
  publishSessionWork,
  readSessionWork,
  SESSION_WORK_FENCE,
  type SessionWorkPublisherDependencies,
} from './publish-session-work.js';

const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';
const TOKEN = 'not-a-real-token';
const TARGET = { owner: 'ffMathy', repo: 'hey-jarvis' };

/** A publish runs a dozen git commands against real repositories: a few seconds, more on Windows. */
const GIT_TEST_TIMEOUT_MILLISECONDS = 30_000;

/** The block a session ends its final message on. */
function block(work: Record<string, unknown>): string {
  return `\`\`\`${SESSION_WORK_FENCE}\n${JSON.stringify(work)}\n\`\`\``;
}

describe('readSessionWork', () => {
  const work = { branch: 'jarvis/add-greeting', title: 'feat(mcp): add a greeting', body: 'Says hello.' };

  it('reads the block a session ends its turn on', () => {
    expect(readSessionWork(`All done, and the tests pass.\n\n${block(work)}`)).toEqual({ status: 'found', work });
  });

  it('reads a description that has code fences of its own', () => {
    const body = 'Run it with:\n\n```bash\nbun test\n```\n';

    expect(readSessionWork(`Done.\n${block({ ...work, body })}\n`)).toEqual({
      status: 'found',
      work: { ...work, body },
    });
  });

  it('takes the block at the end over a mention of it earlier on', () => {
    const message = `I will finish with a \`\`\`${SESSION_WORK_FENCE} block, as asked.\n\n${block(work)}`;

    expect(readSessionWork(message)).toEqual({ status: 'found', work });
  });

  it('defaults a missing description to an empty one', () => {
    expect(readSessionWork(block({ branch: work.branch, title: work.title }))).toEqual({
      status: 'found',
      work: { ...work, body: '' },
    });
  });

  it('finds nothing in a turn that ended without it, such as one that asks a question', () => {
    expect(readSessionWork('Should the greeting be in Danish or in English?')).toEqual({ status: 'absent' });
    expect(readSessionWork(`\`\`\`json\n${JSON.stringify(work)}\n\`\`\``)).toEqual({ status: 'absent' });
  });

  it.each([
    ['is not JSON', `\`\`\`${SESSION_WORK_FENCE}\n{branch: jarvis/x}\n\`\`\``, 'not valid JSON'],
    ['has no title', block({ branch: work.branch, body: '' }), 'title'],
    ['has an empty branch', block({ ...work, branch: ' ' }), 'branch'],
    ['is never closed', `\`\`\`${SESSION_WORK_FENCE}\n${JSON.stringify(work)}`, 'no closing fence'],
  ])('says what is wrong with a block that %s', (_description, message, reason) => {
    const reading = readSessionWork(message);

    expect(reading.status).toBe('invalid');
    expect(reading.status === 'invalid' && reading.reason).toContain(reason);
  });
});

describe('buildSessionWorkInstructions', () => {
  it('tells the session to clone without credentials, commit on a jarvis branch, and push nothing', () => {
    const instructions = buildSessionWorkInstructions('ffMathy/hey-jarvis');

    expect(instructions).toContain('git clone https://github.com/ffMathy/hey-jarvis.git .');
    expect(instructions).toContain(`\`${BRANCH_PREFIX}`);
    expect(instructions).toContain('Do not push and do not open a pull request');
    expect(instructions).toContain(`\`\`\`${SESSION_WORK_FENCE}`);
    for (const protectedPath of CI_PROTECTED_PATHS) {
      expect(instructions).toContain(protectedPath);
    }
  });
});

describe('checkBranchName', () => {
  it('accepts a branch under jarvis/', () => {
    expect(checkBranchName('jarvis/add-greeting')).toBeUndefined();
  });

  it.each([
    ['main'],
    ['feature/jarvis/add-greeting'],
    ['jarvis/'],
    ['--force'],
    ['jarvis/add greeting'],
    ['jarvis/add-greeting;reboot'],
  ])('refuses %s', (branch) => {
    expect(checkBranchName(branch)).toBeString();
  });
});

describe('findProtectedPaths', () => {
  it('finds changes to workflows, local actions and the actions lockfile, and nothing else', () => {
    expect(
      findProtectedPaths([
        '.github/workflows/ci.yml',
        '.github/workflows/actions.lock',
        '.github/actions/setup/action.yml',
        '.github/actions.lock',
        '.github/release-please-config.json',
        '.github/workflows-notes.md',
        'docs/.github/workflows/example.yml',
        'mcp/mastra/index.ts',
      ]),
    ).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/actions.lock',
      '.github/actions/setup/action.yml',
      '.github/actions.lock',
    ]);
  });
});

describe('buildGitEnvironment', () => {
  it('hands git the token for GitHub alone, and none of the server’s environment', () => {
    process.env.HEY_JARVIS_PUBLISH_TEST_SECRET = 'must-not-reach-git';
    try {
      const env = buildGitEnvironment('/tmp/somewhere', TOKEN);
      const values = Object.entries(env).filter(([name]) => name.startsWith('GIT_CONFIG_'));

      expect(env.HEY_JARVIS_PUBLISH_TEST_SECRET).toBeUndefined();
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
      expect(env.HOME).toBe('/tmp/somewhere');
      expect(env.GIT_CONFIG_COUNT).toBe('1');
      expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
      expect(env.GIT_CONFIG_VALUE_0).toBe(
        `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`,
      );
      // The token itself appears nowhere in plain text.
      expect(values.some(([, value]) => value?.includes(TOKEN))).toBe(false);
    } finally {
      delete process.env.HEY_JARVIS_PUBLISH_TEST_SECRET;
    }
  });

  it('sets no credential at all without a token', () => {
    expect(buildGitEnvironment('/tmp/somewhere', undefined).GIT_CONFIG_COUNT).toBe('0');
  });
});

describe('publishSessionWork', () => {
  let root: string;
  /** GitHub's copy of the repository. */
  let remote: string;
  /** Where commits to the remote's default branch are made from. */
  let upstream: string;
  /** The session's directory in the sandbox. */
  let sandbox: string;
  let exports: { sessionId: string; maximumBytes: number }[];
  let createdPullRequests: { head: string; base: string; title: string; body: string }[];
  let openPullRequest: PublishedPullRequest | undefined;
  let exportFailure: Error | undefined;

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...args],
      { cwd, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  async function commit(repository: string, file: string, content: string): Promise<void> {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await writeFile(path.join(repository, file), content);
    git(repository, 'add', '--all');
    git(repository, 'commit', '--quiet', '-m', `change ${file}`);
  }

  /** What the host's `export` writes: the sandbox's branches, less what its default branch had. */
  async function exportFromSandbox(): Promise<Buffer> {
    const base = git(sandbox, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
    const bundle = path.join(root, `export-${exports.length}.bundle`);
    git(sandbox, 'bundle', 'create', '--quiet', bundle, '--branches', `^${base}`);
    return await readFile(bundle);
  }

  function dependencies(overrides: Partial<SessionWorkPublisherDependencies> = {}): SessionWorkPublisherDependencies {
    return {
      exportWork: async (sessionId, maximumBytes) => {
        exports.push({ sessionId, maximumBytes });
        if (exportFailure) {
          throw exportFailure;
        }
        return await exportFromSandbox();
      },
      remoteUrl: () => pathToFileURL(remote).href,
      token: TOKEN,
      findOpenPullRequest: async () => openPullRequest,
      createPullRequest: async (_target, pullRequest) => {
        createdPullRequests.push(pullRequest);
        return { number: 42, url: 'https://github.com/ffMathy/hey-jarvis/pull/42' };
      },
      ...overrides,
    };
  }

  function remoteBranch(branch: string): string | undefined {
    const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: remote,
      encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  }

  const WORK = { branch: 'jarvis/add-greeting', title: 'feat(mcp): add a greeting', body: 'Says hello.' };
  const FINAL_MESSAGE = `Committed, and the tests pass.\n\n${block(WORK)}`;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'publish-session-work-test-'));
    upstream = path.join(root, 'upstream');
    remote = path.join(root, 'remote.git');
    sandbox = path.join(root, 'sandbox');
    exports = [];
    createdPullRequests = [];
    openPullRequest = undefined;
    exportFailure = undefined;

    git(root, 'init', '--quiet', upstream);
    // Large enough that the session's one-line change to it is bundled as a delta against the
    // original, which the server's blobless clone does not have until it asks for it.
    await commit(upstream, 'notes.txt', `${Array.from({ length: 2000 }, (_, line) => `line ${line}`).join('\n')}\n`);
    await commit(upstream, '.github/workflows/ci.yml', 'on: push\n');
    git(root, 'clone', '--quiet', '--bare', upstream, remote);
    git(remote, 'config', 'uploadpack.allowFilter', 'true');
    git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    git(upstream, 'remote', 'add', 'origin', remote);

    git(root, 'clone', '--quiet', remote, sandbox);
    git(sandbox, 'switch', '--quiet', '-c', WORK.branch);
    await commit(sandbox, 'greeting.txt', 'hi\n');
    const notes = await readFile(path.join(sandbox, 'notes.txt'), 'utf8');
    await commit(sandbox, 'notes.txt', notes.replace('line 1000\n', 'line one thousand\n'));
  }, GIT_TEST_TIMEOUT_MILLISECONDS);

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  }, GIT_TEST_TIMEOUT_MILLISECONDS);

  it(
    'pushes the branch and opens a pull request for it against the default branch',
    async () => {
      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication).toEqual({
        status: 'published',
        branch: WORK.branch,
        pullRequest: { number: 42, url: 'https://github.com/ffMathy/hey-jarvis/pull/42' },
        created: true,
      });
      expect(remoteBranch(WORK.branch)).toBe(git(sandbox, 'rev-parse', 'HEAD'));
      expect(createdPullRequests).toEqual([{ head: WORK.branch, base: 'main', title: WORK.title, body: WORK.body }]);
      expect(exports).toEqual([{ sessionId: SESSION_ID, maximumBytes: MAXIMUM_BUNDLE_BYTES }]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'still publishes after the default branch has moved on since the session cloned it',
    async () => {
      await commit(upstream, 'README.md', 'hello\n');
      git(upstream, 'push', '--quiet', 'origin', 'main');

      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication?.status).toBe('published');
      expect(remoteBranch(WORK.branch)).toBe(git(sandbox, 'rev-parse', 'HEAD'));
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'updates a pull request already open for the branch rather than opening another',
    async () => {
      openPullRequest = { number: 7, url: 'https://github.com/ffMathy/hey-jarvis/pull/7' };

      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication).toMatchObject({ status: 'published', pullRequest: openPullRequest, created: false });
      expect(createdPullRequests).toEqual([]);
      expect(remoteBranch(WORK.branch)).toBe(git(sandbox, 'rev-parse', 'HEAD'));
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'does nothing for a turn that did not end on the block',
    async () => {
      const publication = await publishSessionWork(SESSION_ID, TARGET, 'Which colour should it be?', dependencies());

      expect(publication).toBeUndefined();
      expect(exports).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'refuses a block it cannot read, without exporting anything',
    async () => {
      const publication = await publishSessionWork(
        SESSION_ID,
        TARGET,
        `\`\`\`${SESSION_WORK_FENCE}\nnot json\n\`\`\``,
        dependencies(),
      );

      expect(publication).toMatchObject({ status: 'refused' });
      expect(exports).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'refuses a branch outside jarvis/, without exporting anything',
    async () => {
      const publication = await publishSessionWork(
        SESSION_ID,
        TARGET,
        block({ ...WORK, branch: 'main' }),
        dependencies(),
      );

      expect(publication).toMatchObject({ status: 'refused' });
      expect(publication?.status === 'refused' && publication.reason).toContain('does not start with "jarvis/"');
      expect(exports).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'refuses to push to the default branch, even one under jarvis/',
    async () => {
      git(remote, 'branch', 'jarvis/trunk', 'main');
      git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/jarvis/trunk');
      const trunk = remoteBranch('jarvis/trunk');

      const publication = await publishSessionWork(
        SESSION_ID,
        TARGET,
        block({ ...WORK, branch: 'jarvis/trunk' }),
        dependencies(),
      );

      expect(publication).toMatchObject({ status: 'refused' });
      expect(publication?.status === 'refused' && publication.reason).toContain('is the default branch');
      expect(remoteBranch('jarvis/trunk')).toBe(trunk);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it.each([
    ['a workflow', '.github/workflows/ci.yml'],
    ['a new workflow', '.github/workflows/exfiltrate.yml'],
    ['the actions lockfile', '.github/actions.lock'],
    ['a local action', '.github/actions/setup/action.yml'],
  ])(
    'refuses a branch that changes %s, and pushes nothing',
    async (_description, file) => {
      await commit(sandbox, file, 'on: pull_request\n');

      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication).toMatchObject({ status: 'refused' });
      expect(publication?.status === 'refused' && publication.reason).toContain(file);
      expect(remoteBranch(WORK.branch)).toBeUndefined();
      expect(createdPullRequests).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'refuses a branch whose CI is behind the default branch’s, since pushing it would run the old workflows',
    async () => {
      await commit(upstream, '.github/workflows/ci.yml', 'on: pull_request\n');
      git(upstream, 'push', '--quiet', 'origin', 'main');

      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication).toMatchObject({ status: 'refused' });
      expect(publication?.status === 'refused' && publication.reason).toContain('rebase the branch');
      expect(remoteBranch(WORK.branch)).toBeUndefined();
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'refuses a branch the session never made',
    async () => {
      const publication = await publishSessionWork(
        SESSION_ID,
        TARGET,
        block({ ...WORK, branch: 'jarvis/something-else' }),
        dependencies(),
      );

      expect(publication).toMatchObject({ status: 'refused' });
      expect(publication?.status === 'refused' && publication.reason).toContain(
        'has no branch "jarvis/something-else"',
      );
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'fails without a token, before exporting anything',
    async () => {
      const publication = await publishSessionWork(
        SESSION_ID,
        TARGET,
        FINAL_MESSAGE,
        dependencies({ token: undefined }),
      );

      expect(publication).toMatchObject({ status: 'failed' });
      expect(publication?.status === 'failed' && publication.reason).toContain('HEY_JARVIS_GITHUB_API_TOKEN');
      expect(exports).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'reports an export that failed, and leaves no temporary directory behind',
    async () => {
      const before = readdirSync(os.tmpdir()).filter((name) => name.startsWith('jarvis-publish-'));
      exportFailure = new Error('Could not export session: the session is busy with another turn.');

      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication).toEqual({ status: 'failed', reason: exportFailure.message });
      expect(readdirSync(os.tmpdir()).filter((name) => name.startsWith('jarvis-publish-'))).toEqual(before);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'does not overwrite a branch someone else has pushed to since',
    async () => {
      git(upstream, 'switch', '--quiet', '-c', WORK.branch);
      await commit(upstream, 'other.txt', 'someone else\n');
      git(upstream, 'push', '--quiet', 'origin', WORK.branch);
      const theirs = remoteBranch(WORK.branch);

      const publication = await publishSessionWork(SESSION_ID, TARGET, FINAL_MESSAGE, dependencies());

      expect(publication).toMatchObject({ status: 'failed' });
      expect(publication?.status === 'failed' && publication.reason).toContain('git push failed');
      expect(publication?.status === 'failed' && publication.reason).not.toContain(TOKEN);
      expect(remoteBranch(WORK.branch)).toBe(theirs);
      expect(createdPullRequests).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );
});
