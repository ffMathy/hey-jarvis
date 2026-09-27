/**
 * What the server asks the host for, and what it needs before it can ask.
 *
 * The request is all the connection gets to say; the host's forced command does the rest, and is
 * covered by `claude-code-ssh-command.spec.ts`. Nothing here connects anywhere; the key is written
 * only to a directory of the test's own.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRemoteCommand,
  getClaudeCodeHostConfiguration,
  getMissingClaudeCodeHostVariables,
  isClaudeCodeHostConfigured,
  writePrivateKey,
} from './claude-code-host.js';

const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';

describe('buildRemoteCommand', () => {
  // The host decides between the two by whether the transcript is there; the word is a hint, which
  // a host on the older forced command still goes by.
  it('hints that the session is new', () => {
    expect(buildRemoteCommand(SESSION_ID, false)).toBe(`start ${SESSION_ID}`);
  });

  it('hints that the session already exists', () => {
    expect(buildRemoteCommand(SESSION_ID, true)).toBe(`resume ${SESSION_ID}`);
  });

  it('refuses anything but a UUID before the host has to', () => {
    expect(() => buildRemoteCommand("x'; rm -rf ~; '", false)).toThrow('Not a Claude Code session id');
    expect(() => buildRemoteCommand(`${SESSION_ID} && reboot`, true)).toThrow('Not a Claude Code session id');
  });
});

describe('writePrivateKey', () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), 'claude-code-key-test-'));
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('tries again after a failed write, then writes the key once, readable by its owner alone', async () => {
    // A failure is not remembered: the key is written on the next attempt, not refused forever.
    await expect(writePrivateKey('not a real key', path.join(parent, 'missing'))).rejects.toThrow();

    const keyPath = await writePrivateKey('not a real key', parent);

    expect(path.dirname(path.dirname(keyPath))).toBe(parent);
    // ssh refuses a key that does not end in a newline.
    expect(await readFile(keyPath, 'utf8')).toEndWith('\n');
    if (process.platform !== 'win32') {
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(keyPath))).mode & 0o777).toBe(0o700);
    }
    expect(await writePrivateKey('not a real key', parent)).toBe(keyPath);
  });
});

describe('getClaudeCodeHostConfiguration', () => {
  const variables = [
    'HEY_JARVIS_CLAUDE_CODE_SSH_TARGET',
    'HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY',
    'HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN',
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
    for (const name of variables) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of variables) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  it('names what is missing', () => {
    process.env.HEY_JARVIS_CLAUDE_CODE_SSH_TARGET = 'jarvis@host.docker.internal';
    process.env.HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY = 'not a real key';

    expect(isClaudeCodeHostConfigured()).toBe(false);
    expect(getMissingClaudeCodeHostVariables()).toEqual(['HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN']);
    expect(() => getClaudeCodeHostConfiguration()).toThrow('HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('is configured once all three are set', () => {
    process.env.HEY_JARVIS_CLAUDE_CODE_SSH_TARGET = 'jarvis@host.docker.internal';
    process.env.HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY = 'not a real key';
    process.env.HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN = 'not a real token';

    expect(isClaudeCodeHostConfigured()).toBe(true);
    expect(getMissingClaudeCodeHostVariables()).toEqual([]);
    expect(getClaudeCodeHostConfiguration().target).toBe('jarvis@host.docker.internal');
  });
});
