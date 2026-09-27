/**
 * What the server asks the host for, and what it needs before it can ask.
 *
 * The request is all the connection gets to say; the host's forced command does the rest, and is
 * covered by `claude-code-ssh-command.spec.ts`. Nothing here connects anywhere.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildRemoteCommand,
  getClaudeCodeHostConfiguration,
  getMissingClaudeCodeHostVariables,
  isClaudeCodeHostConfigured,
} from './claude-code-host.js';

const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';

describe('buildRemoteCommand', () => {
  it('asks to start a new session', () => {
    expect(buildRemoteCommand(SESSION_ID, false)).toBe(`start ${SESSION_ID}`);
  });

  it('asks to resume an existing one', () => {
    expect(buildRemoteCommand(SESSION_ID, true)).toBe(`resume ${SESSION_ID}`);
  });

  it('refuses anything but a UUID before the host has to', () => {
    expect(() => buildRemoteCommand("x'; rm -rf ~; '", false)).toThrow('Not a Claude Code session id');
    expect(() => buildRemoteCommand(`${SESSION_ID} && reboot`, true)).toThrow('Not a Claude Code session id');
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
