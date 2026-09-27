/**
 * The forced command the coding vertical's SSH key runs on the host.
 *
 * It is the one thing standing between the MCP container and a shell on the host, so what matters
 * most is what it refuses. It is run here as sshd would run it — `sh` with the request in
 * `SSH_ORIGINAL_COMMAND` — with a fake `sbx` on the path that reports what it was asked to do, and
 * then runs the sandbox's half itself, against a fake `flock` and a fake `claude` (and the real
 * `git`, for `export`), in a home directory of the test's own.
 *
 * The fakes report to a log file rather than to stdout, because what `export` writes to stdout has
 * to be the bundle and nothing else. None of them prints the token: `sbx` only says whether it was
 * handed the one the test sent.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, '../../../.scripts/claude-code-ssh-command.sh');
const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';
const TOKEN = 'sk-ant-oat01-not-a-real-token';

/** The export tests build repositories with a handful of git commands each, which is slow on some hosts. */
const GIT_TEST_TIMEOUT_MILLISECONDS = 30_000;

/** Reports its arguments and whether it was handed the token, then runs the script it was given, which is its last argument. */
const FAKE_SBX = `#!/bin/sh
for argument in "$@"; do printf 'arg:%s\\n' "$argument" >> "$FAKE_LOG"; done
if [ -z "\${CLAUDE_CODE_OAUTH_TOKEN+set}" ]; then echo 'token:absent' >> "$FAKE_LOG";
elif [ "$CLAUDE_CODE_OAUTH_TOKEN" = '${TOKEN}' ]; then echo 'token:expected' >> "$FAKE_LOG";
else echo 'token:unexpected' >> "$FAKE_LOG"; fi
eval "script=\\\${$#}"
exec sh -c "$script"
`;

/** Takes the lock, or fails to when the test says another process holds it. */
const FAKE_FLOCK = `#!/bin/sh
printf 'flock:%s\\n' "$*" >> "$FAKE_LOG"
exit "\${FAKE_FLOCK_STATUS:-0}"
`;

/** Reports how it was started, and the stdin left for it. */
const FAKE_CLAUDE = `#!/bin/sh
for argument in "$@"; do printf 'claude:%s\\n' "$argument"; done
printf 'cwd:%s\\n' "$(pwd)"
printf 'background-tasks-disabled:%s\\n' "\${CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:-}"
sed 's/^/stdin:/'
`;

let fakeBin: string;
let home: string;
let log: string;

beforeAll(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), 'fake-sbx-'));
  for (const [name, content] of [
    ['sbx', FAKE_SBX],
    ['flock', FAKE_FLOCK],
    ['claude', FAKE_CLAUDE],
  ]) {
    await writeFile(path.join(fakeBin, name), content);
    await chmod(path.join(fakeBin, name), 0o755);
  }
});

afterAll(async () => {
  await rm(fakeBin, { recursive: true, force: true });
});

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'fake-sandbox-home-'));
  log = path.join(home, 'fakes.log');
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function runAsSshd(request: string, options: { stdin?: string; flockStatus?: number } = {}) {
  const result = spawnSync('sh', [SCRIPT], {
    input: options.stdin ?? `${TOKEN}\n{"type":"user"}\n`,
    env: {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      HOME: home,
      SSH_ORIGINAL_COMMAND: request,
      FAKE_FLOCK_STATUS: String(options.flockStatus ?? 0),
      FAKE_LOG: log,
    },
  });

  const stdout = result.stdout.toString('utf8');
  const lines = [...(existsSync(log) ? readFileSync(log, 'utf8').split('\n') : []), ...stdout.split('\n')];
  const withPrefix = (prefix: string) =>
    lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));

  return {
    status: result.status,
    stderr: result.stderr.toString('utf8'),
    /** Exactly what the command wrote to stdout, byte for byte. */
    stdout: result.stdout,
    sbxArguments: withPrefix('arg:'),
    token: withPrefix('token:')[0],
    flock: withPrefix('flock:'),
    claudeArguments: withPrefix('claude:'),
    cwd: withPrefix('cwd:')[0],
    backgroundTasksDisabled: withPrefix('background-tasks-disabled:')[0],
    stdin: withPrefix('stdin:'),
  };
}

/** Leaves a transcript where Claude Code keeps one for a session started in its directory. */
async function writeTranscript(content: string): Promise<void> {
  const project = path.join(home, '.claude', 'projects', `-home-agent-jarvis-sessions-${SESSION_ID}`);
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, `${SESSION_ID}.jsonl`), content);
}

const CLAUDE_COMMAND_LINE = [
  '--print',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--dangerously-skip-permissions',
];

describe('claude-code-ssh-command.sh', () => {
  it('runs Claude Code in the jarvis sandbox, and nowhere else', () => {
    const { status, sbxArguments, claudeArguments } = runAsSshd(`start ${SESSION_ID}`);

    expect(status).toBe(0);
    expect(sbxArguments.slice(0, 7)).toEqual(['exec', '-i', '-e', 'CLAUDE_CODE_OAUTH_TOKEN', 'jarvis', 'sh', '-c']);
    expect(sbxArguments[7]).toContain(`cd "$HOME/jarvis-sessions/${SESSION_ID}"`);
    expect(claudeArguments.slice(0, CLAUDE_COMMAND_LINE.length)).toEqual(CLAUDE_COMMAND_LINE);
  });

  it('runs Claude Code without background tasks, which would be stopped when its turn ends', () => {
    const { backgroundTasksDisabled } = runAsSshd(`start ${SESSION_ID}`);

    expect(backgroundTasksDisabled).toBe('1');
  });

  it("works in the session's own directory", () => {
    const { cwd } = runAsSshd(`start ${SESSION_ID}`);

    expect(cwd).toEndWith(`/jarvis-sessions/${SESSION_ID}`);
  });

  it.each(['start', 'resume'])('starts a session with no transcript under its id, when asked to %s it', (mode) => {
    const { status, claudeArguments } = runAsSshd(`${mode} ${SESSION_ID}`);

    expect(status).toBe(0);
    expect(claudeArguments.slice(-2)).toEqual(['--session-id', SESSION_ID]);
  });

  it.each(['start', 'resume'])('resumes a session whose transcript is there, when asked to %s it', async (mode) => {
    await writeTranscript('{"type":"user"}\n');

    const { status, claudeArguments } = runAsSshd(`${mode} ${SESSION_ID}`);

    expect(status).toBe(0);
    expect(claudeArguments.slice(-2)).toEqual(['--resume', SESSION_ID]);
  });

  it('starts afresh over an empty transcript, which has no conversation in it to resume', async () => {
    await writeTranscript('');

    const { claudeArguments } = runAsSshd(`resume ${SESSION_ID}`);

    expect(claudeArguments.slice(-2)).toEqual(['--session-id', SESSION_ID]);
  });

  it("takes the session's lock, kept beside its directory, before running Claude Code", () => {
    const { flock, sbxArguments } = runAsSshd(`start ${SESSION_ID}`);

    expect(flock).toEqual(['-w 120 9']);
    expect(sbxArguments[7]).toContain(`exec 9>>"$HOME/jarvis-sessions/${SESSION_ID}.lock"`);
    expect(existsSync(path.join(home, 'jarvis-sessions', `${SESSION_ID}.lock`))).toBe(true);
    expect(existsSync(path.join(home, 'jarvis-sessions', SESSION_ID, '.lock'))).toBe(false);
  });

  it('does not run Claude Code while another process holds the session', () => {
    const { status, stderr, claudeArguments } = runAsSshd(`resume ${SESSION_ID}`, { flockStatus: 1 });

    expect(status).toBe(75);
    expect(stderr).toContain(`session ${SESSION_ID} is still running in another process`);
    expect(claudeArguments).toEqual([]);
  });

  it('hands the first line of stdin on as the token, and the rest to Claude Code', () => {
    const { token, stdin } = runAsSshd(`start ${SESSION_ID}`);

    expect(token).toBe('expected');
    expect(stdin).toEqual(['{"type":"user"}']);
  });

  it.each([
    ['no request at all, which is what an interactive login asks for', ''],
    ['a shell', 'bash'],
    ['another sbx command', `sbx rm jarvis`],
    ['a mode other than start, resume or export', `exec ${SESSION_ID}`],
    ['an id that is not a UUID', 'start 1234'],
    ['an export of an id that is not a UUID', 'export 1234'],
    ['a command chained after the id', `start ${SESSION_ID}; reboot`],
    ['a command chained after an exported id', `export ${SESSION_ID}; reboot`],
    ['a command substituted into the id', `start $(reboot)`],
    ['a command substituted into an exported id', `export $(reboot)`],
    ['a second line after the id', `start ${SESSION_ID}\nreboot`],
    ['a second argument', `resume ${SESSION_ID} --dangerously-load-anything`],
    ['a second argument to export', `export ${SESSION_ID} --all`],
    ['a quote to break out of the sandbox command', `start ${SESSION_ID}"`],
    ['a glob to reach another transcript', `resume ${SESSION_ID.slice(0, -1)}*`],
    ['a glob to reach another repository', `export ${SESSION_ID.slice(0, -1)}*`],
    ['a path to reach outside the sessions', `export ../${SESSION_ID}`],
    ['an upper-case UUID, which Claude Code never makes', `start ${SESSION_ID.toUpperCase()}`],
  ])('refuses %s, without running sbx', (_description, request) => {
    const { status, stderr, sbxArguments } = runAsSshd(request);

    expect(status).toBe(64);
    expect(stderr).toContain('refusing');
    expect(sbxArguments).toEqual([]);
  });

  it.each([
    ['sends no input at all', ''],
    ['sends an empty first line', '\n{"type":"user"}\n'],
  ])('refuses a connection that %s, as a missing token rather than a bad request', (_description, stdin) => {
    const { status, stderr, sbxArguments } = runAsSshd(`start ${SESSION_ID}`, { stdin });

    expect(status).toBe(65);
    expect(stderr).toContain('expected the Claude subscription token on the first line of input');
    expect(stderr).not.toContain('refusing');
    expect(sbxArguments).toEqual([]);
  });
});

describe('claude-code-ssh-command.sh export', () => {
  /** A GitHub stand-in: a bare repository whose default branch is `main`. */
  let remote: string;
  /** Where commits to the remote's `main` are made from. */
  let upstream: string;
  let sessionDirectory: string;

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

  beforeEach(async () => {
    upstream = path.join(home, 'upstream');
    remote = path.join(home, 'remote.git');
    sessionDirectory = path.join(home, 'jarvis-sessions', SESSION_ID);

    git(home, 'init', '--quiet', upstream);
    await commit(upstream, 'README.md', 'hello\n');
    git(home, 'clone', '--quiet', '--bare', upstream, remote);
    git(upstream, 'remote', 'add', 'origin', remote);

    // What a session does: clone into its own directory, and commit on a branch of its own.
    await mkdir(path.dirname(sessionDirectory), { recursive: true });
    git(home, 'clone', '--quiet', remote, sessionDirectory);
    git(sessionDirectory, 'switch', '--quiet', '-c', 'jarvis/add-greeting');
    await commit(sessionDirectory, 'greeting.txt', 'hi\n');
    await commit(sessionDirectory, 'greeting.txt', 'hi there\n');
  }, GIT_TEST_TIMEOUT_MILLISECONDS);

  /** Unbundles into a fresh clone of the remote's default branch, as the server does. */
  async function unbundleOnTheServer(bundle: Buffer): Promise<string> {
    const server = path.join(home, 'server.git');
    git(home, 'clone', '--quiet', '--bare', '--single-branch', remote, server);
    await writeFile(path.join(home, 'work.bundle'), bundle);
    git(
      server,
      'fetch',
      '--quiet',
      path.join(home, 'work.bundle'),
      'refs/heads/jarvis/add-greeting:refs/heads/jarvis/add-greeting',
    );
    return git(server, 'rev-parse', 'refs/heads/jarvis/add-greeting');
  }

  it(
    'writes a bundle of the session’s branches to stdout, and nothing else',
    async () => {
      const { status, stdout, stderr } = runAsSshd(`export ${SESSION_ID}`);

      expect(stderr).not.toContain('jarvis-claude-code');
      expect(status).toBe(0);
      expect(stdout.subarray(0, 16).toString('latin1')).toBe('# v2 git bundle\n');
      expect(await unbundleOnTheServer(stdout)).toBe(git(sessionDirectory, 'rev-parse', 'HEAD'));
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'leaves out what the default branch already has, and still unbundles after it has moved on',
    async () => {
      // The default branch gains a commit after the session cloned it: the bundle's prerequisites are
      // older commits of that branch, which a fresh fetch of it still has.
      await commit(upstream, 'README.md', 'hello again\n');
      git(upstream, 'push', '--quiet', 'origin', 'main');

      const { status, stdout } = runAsSshd(`export ${SESSION_ID}`);
      const header = stdout.subarray(0, stdout.indexOf('\n\n')).toString('latin1');
      const initialCommit = git(sessionDirectory, 'rev-parse', 'origin/main');

      expect(status).toBe(0);
      expect(header).toContain(`-${initialCommit}`);
      expect(header).toContain('refs/heads/jarvis/add-greeting');
      expect(await unbundleOnTheServer(stdout)).toBe(git(sessionDirectory, 'rev-parse', 'HEAD'));
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'runs in the jarvis sandbox, reading no token and no input',
    () => {
      const { status, sbxArguments, token } = runAsSshd(`export ${SESSION_ID}`, { stdin: `${TOKEN}\n` });

      expect(status).toBe(0);
      expect(sbxArguments.slice(0, 4)).toEqual(['exec', 'jarvis', 'sh', '-c']);
      expect(sbxArguments).not.toContain('-e');
      expect(sbxArguments).not.toContain('-i');
      expect(token).toBe('absent');
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "takes the session's lock, so a turn is never exported halfway through",
    () => {
      const { flock, sbxArguments } = runAsSshd(`export ${SESSION_ID}`);

      expect(flock).toEqual(['-w 30 9']);
      expect(sbxArguments[4]).toContain(`exec 9>>"$HOME/jarvis-sessions/${SESSION_ID}.lock"`);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'exports nothing while another process holds the session',
    () => {
      const { status, stdout, stderr } = runAsSshd(`export ${SESSION_ID}`, { flockStatus: 1 });

      expect(status).toBe(75);
      expect(stderr).toContain(`session ${SESSION_ID} is still running in another process`);
      expect(stdout.length).toBe(0);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'says so when nothing was committed beyond the default branch',
    () => {
      git(sessionDirectory, 'switch', '--quiet', 'main');
      git(sessionDirectory, 'branch', '--quiet', '-D', 'jarvis/add-greeting');

      const { status, stdout, stderr } = runAsSshd(`export ${SESSION_ID}`);

      expect(status).toBe(67);
      expect(stderr).toContain('has committed nothing beyond refs/remotes/origin/main');
      expect(stdout.length).toBe(0);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'says so when the session has no directory, or no repository in it',
    async () => {
      await rm(path.join(sessionDirectory, '.git'), { recursive: true, force: true });
      const withoutRepository = runAsSshd(`export ${SESSION_ID}`);

      await rm(sessionDirectory, { recursive: true, force: true });
      const withoutDirectory = runAsSshd(`export ${SESSION_ID}`);

      for (const { status, stdout, stderr } of [withoutRepository, withoutDirectory]) {
        expect(status).toBe(66);
        expect(stderr).toContain('has no repository in its directory');
        expect(stdout.length).toBe(0);
      }
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'says so when there is no default branch to export against',
    () => {
      git(sessionDirectory, 'remote', 'set-head', 'origin', '--delete');

      const { status, stdout, stderr } = runAsSshd(`export ${SESSION_ID}`);

      expect(status).toBe(68);
      expect(stderr).toContain('no default branch to export against');
      expect(stdout.length).toBe(0);
    },
    GIT_TEST_TIMEOUT_MILLISECONDS,
  );
});
