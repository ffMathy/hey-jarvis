/**
 * The machine Claude Code runs on, reached over SSH.
 *
 * The coding vertical does not call a model API for its sessions. It runs the official Claude Code
 * CLI on a host that is logged in to the user's Claude subscription — the Raspberry Pi itself, or
 * any other machine the server can reach — so the work is billed to that subscription rather than
 * to an API key. The server holds only an SSH key; the Claude login, and the GitHub login the
 * session clones and opens pull requests with, live on the host.
 *
 * Nothing runs Claude Code inside the server's own container: the container carries the 1Password
 * service account token for the whole vault, and a session that skips permission prompts could
 * read it out of `/proc`. On a host of its own, as a user of its own, it can reach none of that.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

/** Where, on the host, each session gets a working directory of its own. */
export const HOST_SESSIONS_DIRECTORY = 'jarvis-sessions';

/** Claude Code session ids are UUIDs; anything else never reaches the remote shell. */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Longest stretch of stderr kept for reporting why a process failed. */
const MAXIMUM_STDERR_LENGTH = 4000;

/**
 * Configuration needed to reach the host.
 *
 * Both come from the environment. Their values are never logged — only whether they are set — per
 * the repository's secret handling rules.
 */
export interface ClaudeCodeHostConfiguration {
  /** The SSH destination: `user@host`, or `ssh://user@host:port` for a port other than 22. */
  target: string;
  /** The private key, in OpenSSH format, whose public half the host authorizes. */
  privateKey: string;
}

/**
 * Reads the host configuration from the environment.
 *
 * @throws If any of it is missing, naming which without revealing values
 */
export function getClaudeCodeHostConfiguration(): ClaudeCodeHostConfiguration {
  const target = process.env.HEY_JARVIS_CLAUDE_CODE_SSH_TARGET;
  const privateKey = process.env.HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY;

  if (!target || !privateKey) {
    const missing = [
      !target && 'HEY_JARVIS_CLAUDE_CODE_SSH_TARGET',
      !privateKey && 'HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY',
    ].filter((name): name is string => typeof name === 'string');

    throw new Error(
      `Claude Code sessions are not configured. Missing environment variables: ${missing.join(', ')}. ` +
        'Set up a host with Claude Code logged in to your subscription, then point these at it.',
    );
  }

  return { target, privateKey };
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
 * The command the host runs for one Claude Code process.
 *
 * Every session works in a directory of its own, and a session is resumed from the directory it
 * started in, because that is where Claude Code keeps its transcript. The session id is the only
 * value interpolated, and only once it is known to be a UUID.
 *
 * `$HOME/.local/bin` is put on the path because that is where the native installer puts `claude`,
 * and a non-interactive SSH command does not read the shell profile that would otherwise add it.
 *
 * @param sessionId - The Claude Code session id
 * @param resume - Whether the session already exists on the host and is being continued
 */
export function buildRemoteCommand(sessionId: string, resume: boolean): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Not a Claude Code session id: ${sessionId}`);
  }

  const directory = `"$HOME/${HOST_SESSIONS_DIRECTORY}/${sessionId}"`;

  return [
    'export PATH="$HOME/.local/bin:$PATH"',
    `mkdir -p ${directory}`,
    `cd ${directory}`,
    [
      'exec claude --print',
      // Messages go in as JSON lines on stdin, so the prompt is never part of the command line --
      // no quoting across the SSH hop, and nothing in `ps` -- and a follow-up can be written to a
      // process that is still working.
      '--input-format stream-json',
      '--output-format stream-json --verbose',
      // Nobody is there to answer a permission prompt. The host user is what bounds the session.
      '--dangerously-skip-permissions',
      resume ? `--resume ${sessionId}` : `--session-id ${sessionId}`,
    ].join(' '),
  ].join(' && ');
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
 * Starts Claude Code on the host over SSH.
 *
 * `ssh` gets an environment with nothing in it but `PATH`, and reads no configuration but what is
 * passed here, so none of the server's secrets can travel with it.
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

  return { input: child.stdin, output: child.stdout, exited };
};
