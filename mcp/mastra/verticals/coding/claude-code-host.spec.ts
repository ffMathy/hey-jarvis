/**
 * What the server asks the host to run, and what it needs before it can ask.
 *
 * The command crosses an SSH hop into a remote shell and from there into a sandbox, so the one value
 * in it that varies is checked before it gets there. Nothing here connects anywhere.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildRemoteCommand, getClaudeCodeHostConfiguration, isClaudeCodeHostConfigured } from './claude-code-host.js';

const SESSION_ID = '0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11';

describe('buildRemoteCommand', () => {
  it('starts a new session under its own id, in a directory of its own', () => {
    const command = buildRemoteCommand(SESSION_ID, false);

    expect(command).toContain(`cd "$HOME/jarvis-sessions/${SESSION_ID}"`);
    expect(command).toContain(`--session-id ${SESSION_ID}`);
    expect(command).not.toContain('--resume');
  });

  it('resumes an existing session from the directory it started in', () => {
    const command = buildRemoteCommand(SESSION_ID, true);

    expect(command).toContain(`cd "$HOME/jarvis-sessions/${SESSION_ID}"`);
    expect(command).toContain(`--resume ${SESSION_ID}`);
    expect(command).not.toContain('--session-id');
  });

  it('runs Claude Code in the jarvis sandbox, with stdin kept open', () => {
    expect(buildRemoteCommand(SESSION_ID, false)).toContain(
      'exec sbx exec -i -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c ',
    );
  });

  it('runs Claude Code unattended, reading and writing stream-json', () => {
    const command = buildRemoteCommand(SESSION_ID, false);

    expect(command).toContain('exec claude --print');
    expect(command).toContain('--input-format stream-json');
    expect(command).toContain('--output-format stream-json --verbose');
    expect(command).toContain('--dangerously-skip-permissions');
  });

  it('reads the token off the first line of stdin, so it is never on a command line', () => {
    expect(buildRemoteCommand(SESSION_ID, false)).toStartWith(
      'IFS= read -r CLAUDE_CODE_OAUTH_TOKEN && export CLAUDE_CODE_OAUTH_TOKEN && ',
    );
  });

  it("keeps $HOME for the sandbox to expand, not the host's shell", () => {
    const command = buildRemoteCommand(SESSION_ID, false);
    const insideSandbox = command.slice(command.indexOf("sh -c '"));

    expect(insideSandbox).toEndWith("'");
    expect(insideSandbox.slice("sh -c '".length, -1)).not.toContain("'");
    expect(insideSandbox).toContain('$HOME/jarvis-sessions');
  });

  it('refuses anything but a UUID, so nothing else reaches the remote shell', () => {
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
    expect(() => getClaudeCodeHostConfiguration()).toThrow('HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('is configured once all three are set', () => {
    process.env.HEY_JARVIS_CLAUDE_CODE_SSH_TARGET = 'jarvis@host.docker.internal';
    process.env.HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY = 'not a real key';
    process.env.HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN = 'not a real token';

    expect(isClaudeCodeHostConfigured()).toBe(true);
    expect(getClaudeCodeHostConfiguration().target).toBe('jarvis@host.docker.internal');
  });
});
