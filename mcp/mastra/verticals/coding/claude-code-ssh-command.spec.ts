/**
 * The forced command the coding vertical's SSH key runs on the host.
 *
 * It is the one thing standing between the MCP container and a shell on the host, so what matters
 * most is what it refuses. It is run here as sshd would run it — `sh` with the request in
 * `SSH_ORIGINAL_COMMAND` — with a fake `sbx` on the path that reports what it was asked to do, and
 * then runs the sandbox's half itself, against a fake `flock` and a fake `claude`, in a home
 * directory of the test's own.
 *
 * None of the fakes prints the token: `sbx` only says whether it was handed the one the test sent.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, '../../../.scripts/claude-code-ssh-command.sh');
const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';
const TOKEN = 'sk-ant-oat01-not-a-real-token';

/** `sbx exec -i -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c <script>`: the script is the eighth argument. */
const FAKE_SBX = `#!/bin/sh
for argument in "$@"; do printf 'arg:%s\\n' "$argument"; done
if [ "$CLAUDE_CODE_OAUTH_TOKEN" = '${TOKEN}' ]; then echo 'token:expected'; else echo 'token:unexpected'; fi
shift 7
exec sh -c "$1"
`;

/** Takes the lock, or fails to when the test says another process holds it. */
const FAKE_FLOCK = `#!/bin/sh
printf 'flock:%s\\n' "$*"
exit "\${FAKE_FLOCK_STATUS:-0}"
`;

/** Reports how it was started, and the stdin left for it. */
const FAKE_CLAUDE = `#!/bin/sh
for argument in "$@"; do printf 'claude:%s\\n' "$argument"; done
printf 'cwd:%s\\n' "$(pwd)"
sed 's/^/stdin:/'
`;

let fakeBin: string;
let home: string;

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
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function runAsSshd(request: string, options: { stdin?: string; flockStatus?: number } = {}) {
  const result = spawnSync('sh', [SCRIPT], {
    input: options.stdin ?? `${TOKEN}\n{"type":"user"}\n`,
    encoding: 'utf8',
    env: {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      HOME: home,
      SSH_ORIGINAL_COMMAND: request,
      FAKE_FLOCK_STATUS: String(options.flockStatus ?? 0),
    },
  });

  const lines = result.stdout.split('\n');
  const withPrefix = (prefix: string) =>
    lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));

  return {
    status: result.status,
    stderr: result.stderr,
    sbxArguments: withPrefix('arg:'),
    token: withPrefix('token:')[0],
    flock: withPrefix('flock:'),
    claudeArguments: withPrefix('claude:'),
    cwd: withPrefix('cwd:')[0],
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
    ['a mode other than start or resume', `exec ${SESSION_ID}`],
    ['an id that is not a UUID', 'start 1234'],
    ['a command chained after the id', `start ${SESSION_ID}; reboot`],
    ['a command substituted into the id', `start $(reboot)`],
    ['a second line after the id', `start ${SESSION_ID}\nreboot`],
    ['a second argument', `resume ${SESSION_ID} --dangerously-load-anything`],
    ['a quote to break out of the sandbox command', `start ${SESSION_ID}"`],
    ['a glob to reach another transcript', `resume ${SESSION_ID.slice(0, -1)}*`],
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
