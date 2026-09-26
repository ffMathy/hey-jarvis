/**
 * Where Claude Code runs: a Docker Sandbox on the host, reached over SSH.
 *
 * The coding vertical does not call a model API for its sessions. It runs the official Claude Code
 * CLI, signed in to the user's Claude subscription with a token from `claude setup-token`, so the
 * work is billed to that subscription rather than to an API key.
 *
 * Claude Code runs in a Docker Sandbox (`sbx`): a microVM of its own, with its own filesystem,
 * Docker daemon and egress proxy, so a session that skips permission prompts can reach nothing on
 * the host. A sandbox needs KVM and the `sbx` daemon, which live on the host rather than in the
 * server's container — so the server reaches the host over SSH, and the host runs `sbx exec`.
 *
 * The SSH key gets no shell on the host. Its forced command is `mcp/.scripts/claude-code-ssh-command.sh`,
 * which accepts only `start <session id>` or `resume <session id>` and fixes everything else — the
 * sandbox, the directory and the `claude` command line — so a compromised container can start
 * Claude Code sessions in the sandbox and do nothing else on the host.
 *
 * Nothing runs Claude Code inside the server's own container: the container carries the 1Password
 * service account token for the whole vault, and a session that skips permission prompts could
 * read it out of `/proc`.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

/**
 * The sandbox every session runs in, created once on the host with `sbx create --name jarvis claude`.
 * The host's forced command fixes it; it is named here only to say where a session's transcript is.
 */
export const SANDBOX_NAME = 'jarvis';

/** Where, inside the sandbox, each session works in a directory of its own. Also fixed by the host. */
export const SANDBOX_SESSIONS_DIRECTORY = 'jarvis-sessions';

/** Claude Code session ids are UUIDs, and the host refuses anything else. */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Longest stretch of stderr kept for reporting why a process failed. */
const MAXIMUM_STDERR_LENGTH = 4000;

/**
 * Configuration needed to reach the host, and to sign Claude Code in.
 *
 * All of it comes from the environment. The values are never logged — only whether they are set —
 * per the repository's secret handling rules.
 */
export interface ClaudeCodeHostConfiguration {
  /** The SSH destination: `user@host`, or `ssh://user@host:port` for a port other than 22. */
  target: string;
  /** The private key, in OpenSSH format, whose public half the host authorizes. */
  privateKey: string;
  /** The subscription token `claude setup-token` printed. */
  oauthToken: string;
}

/**
 * Reads the host configuration from the environment.
 *
 * @throws If any of it is missing, naming which without revealing values
 */
export function getClaudeCodeHostConfiguration(): ClaudeCodeHostConfiguration {
  const target = process.env.HEY_JARVIS_CLAUDE_CODE_SSH_TARGET;
  const privateKey = process.env.HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY;
  const oauthToken = process.env.HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN;

  if (!target || !privateKey || !oauthToken) {
    const missing = [
      !target && 'HEY_JARVIS_CLAUDE_CODE_SSH_TARGET',
      !privateKey && 'HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY',
      !oauthToken && 'HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN',
    ].filter((name): name is string => typeof name === 'string');

    throw new Error(
      `Claude Code sessions are not configured. Missing environment variables: ${missing.join(', ')}. ` +
        'Set up a host with a Docker Sandbox for Claude Code, then point these at it.',
    );
  }

  return { target, privateKey, oauthToken };
}

/** True when the environment carries everything needed to reach the host. */
export function isClaudeCodeHostConfigured(): boolean {
  try {
    getClaudeCodeHostConfiguration();
    return true;
  } catch {
    return false;
  }
}

/**
 * What the server asks the host for: to start a session, or to resume one.
 *
 * This is all the connection gets to say. The host's forced command reads it from
 * `SSH_ORIGINAL_COMMAND`, refuses anything else, and runs Claude Code in the sandbox itself (see
 * `mcp/.scripts/claude-code-ssh-command.sh`). The host checks the id too; checking it here as well
 * turns a bug into a clear error rather than a refused connection.
 *
 * @param sessionId - The Claude Code session id
 * @param resume - Whether the session already exists in the sandbox and is being continued
 */
export function buildRemoteCommand(sessionId: string, resume: boolean): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Not a Claude Code session id: ${sessionId}`);
  }

  return `${resume ? 'resume' : 'start'} ${sessionId}`;
}

/** A running Claude Code process, as the session manager sees it. */
export interface ClaudeCodeProcess {
  /** Where user messages are written, one stream-json line each. Ending it lets the process exit. */
  input: Writable;
  /** Claude Code's stream-json output, one event per line. */
  output: Readable;
  /** Settles once the process has exited, with its exit code and the end of what it wrote to stderr. */
  exited: Promise<{ code: number | null; stderr: string }>;
}

/** Starts a Claude Code process for a session; swapped out in tests. */
export type ClaudeCodeLauncher = (sessionId: string, resume: boolean) => Promise<ClaudeCodeProcess>;

/**
 * Where the host's key is remembered between restarts.
 *
 * The first connection pins the host key (`accept-new`), and every later one has to match it, so
 * it is kept beside the rest of the server's state rather than in the container's own filesystem.
 * The same directory `storage/index.ts` uses.
 */
function getKnownHostsPath(): string {
  return path.join(process.env.HEY_JARVIS_STORAGE_PATH || path.join('/tmp', 'mcp'), 'claude-code-known-hosts');
}

let privateKeyPath: Promise<string> | undefined;

/**
 * Writes the private key to a file only this process's user can read, once.
 *
 * `ssh` reads a key from a file and nowhere else. It refuses a key whose file others can read, and
 * one that does not end in a newline, which a value copied out of a vault often does not.
 */
function writePrivateKey(privateKey: string): Promise<string> {
  privateKeyPath ??= (async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-code-ssh-'));
    const keyPath = path.join(directory, 'id');
    await writeFile(keyPath, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, { mode: 0o600 });
    return keyPath;
  })();

  return privateKeyPath;
}

/** Collects a process's stderr, keeping only its end. */
function collectStderr(child: ChildProcessWithoutNullStreams): () => string {
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAXIMUM_STDERR_LENGTH);
  });

  return () => stderr.trim();
}

/**
 * Starts Claude Code in the host's sandbox, over SSH.
 *
 * `ssh` gets an environment with nothing in it but `PATH`, and reads no configuration but what is
 * passed here, so none of the server's secrets can travel with it but the one it is handed on stdin.
 */
export const launchClaudeCodeOverSsh: ClaudeCodeLauncher = async (sessionId, resume) => {
  const configuration = getClaudeCodeHostConfiguration();
  const keyPath = await writePrivateKey(configuration.privateKey);
  const knownHostsPath = getKnownHostsPath();
  await mkdir(path.dirname(knownHostsPath), { recursive: true });

  const child = spawn(
    'ssh',
    [
      '-T',
      '-F',
      'none',
      '-i',
      keyPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${knownHostsPath}`,
      // A session can go quiet for minutes while a build or test suite runs. Keepalives stop a
      // router in between from dropping the connection as idle, and notice a host that is gone.
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=4',
      configuration.target,
      buildRemoteCommand(sessionId, resume),
    ],
    { env: { PATH: process.env.PATH ?? '' } },
  );

  const stderr = collectStderr(child);
  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('error', (error) => resolve({ code: null, stderr: `${stderr()}\n${error.message}`.trim() }));
    child.on('close', (code) => resolve({ code, stderr: stderr() }));
  });

  // A write to a process that has already gone fails with EPIPE, which is reported through the
  // exit instead; left unhandled it would take the whole server down.
  child.stdin.on('error', () => {});
  // The first line is the token, which the host reads before handing stdin on to Claude Code.
  child.stdin.write(`${configuration.oauthToken}\n`);

  return { input: child.stdin, output: child.stdout, exited };
};
