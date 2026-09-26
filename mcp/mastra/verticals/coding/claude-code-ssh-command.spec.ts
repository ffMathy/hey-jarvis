/**
 * The forced command the coding vertical's SSH key runs on the host.
 *
 * It is the one thing standing between the MCP container and a shell on the host, so what matters
 * most is what it refuses. It is run here as sshd would run it — `sh` with the request in
 * `SSH_ORIGINAL_COMMAND` — with a fake `sbx` on the path that reports what it was asked to do.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, '../../../.scripts/claude-code-ssh-command.sh');
const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';
const TOKEN = 'sk-ant-oat01-not-a-real-token';

let fakeBin: string;

beforeAll(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), 'fake-sbx-'));
  // Reports its arguments one per line, the token it was handed, and the stdin left for Claude Code.
  await writeFile(
    path.join(fakeBin, 'sbx'),
    '#!/bin/sh\nfor argument in "$@"; do printf "arg:%s\\n" "$argument"; done\nprintf "token:%s\\n" "$CLAUDE_CODE_OAUTH_TOKEN"\nsed "s/^/stdin:/"\n',
  );
  await chmod(path.join(fakeBin, 'sbx'), 0o755);
});

afterAll(async () => {
  await rm(fakeBin, { recursive: true, force: true });
});

function runAsSshd(request: string, stdin = `${TOKEN}\n{"type":"user"}\n`) {
  const result = spawnSync('sh', [SCRIPT], {
    input: stdin,
    encoding: 'utf8',
    env: { PATH: `${fakeBin}:/usr/bin:/bin`, SSH_ORIGINAL_COMMAND: request },
  });

  const lines = result.stdout.split('\n');
  return {
    status: result.status,
    stderr: result.stderr,
    sbxArguments: lines.filter((line) => line.startsWith('arg:')).map((line) => line.slice('arg:'.length)),
    token: lines.find((line) => line.startsWith('token:'))?.slice('token:'.length),
    stdin: lines.filter((line) => line.startsWith('stdin:')).map((line) => line.slice('stdin:'.length)),
  };
}

describe('claude-code-ssh-command.sh', () => {
  it('starts a new session in the jarvis sandbox, and nowhere else', () => {
    const { status, sbxArguments } = runAsSshd(`start ${SESSION_ID}`);

    expect(status).toBe(0);
    expect(sbxArguments.slice(0, 7)).toEqual(['exec', '-i', '-e', 'CLAUDE_CODE_OAUTH_TOKEN', 'jarvis', 'sh', '-c']);
    expect(sbxArguments[7]).toContain(`cd "$HOME/jarvis-sessions/${SESSION_ID}"`);
    expect(sbxArguments[7]).toContain(
      'exec claude --print --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions',
    );
    expect(sbxArguments[7]).toEndWith(`--session-id ${SESSION_ID}`);
  });

  it('resumes a session from the directory it started in', () => {
    const { status, sbxArguments } = runAsSshd(`resume ${SESSION_ID}`);

    expect(status).toBe(0);
    expect(sbxArguments[7]).toContain(`cd "$HOME/jarvis-sessions/${SESSION_ID}"`);
    expect(sbxArguments[7]).toEndWith(`--resume ${SESSION_ID}`);
  });

  it('hands the first line of stdin on as the token, and the rest to Claude Code', () => {
    const { token, stdin } = runAsSshd(`start ${SESSION_ID}`);

    expect(token).toBe(TOKEN);
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
    ['an upper-case UUID, which Claude Code never makes', `start ${SESSION_ID.toUpperCase()}`],
  ])('refuses %s, without running sbx', (_description, request) => {
    const { status, stderr, sbxArguments } = runAsSshd(request);

    expect(status).toBe(64);
    expect(stderr).toContain('refusing');
    expect(sbxArguments).toEqual([]);
  });

  it('refuses a connection that sends no token', () => {
    const { status, sbxArguments } = runAsSshd(`start ${SESSION_ID}`, '');

    expect(status).toBe(64);
    expect(sbxArguments).toEqual([]);
  });
});
