/**
 * Claude Code sessions, with the host replaced by a fake launcher.
 *
 * A real session is a `claude --print` process on another machine, reached over SSH. What is
 * tested here is everything this side of that pipe: reading Claude Code's stream-json output,
 * deciding when a turn is over, writing follow-ups to a process still working, and resuming a
 * session whose process has finished.
 */

import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import type { ClaudeCodeProcess } from './claude-code-host.js';
import {
  ClaudeCodeSessions,
  type ClaudeSessionEvent,
  readClaudeCodeOutputLine,
  readFinishedTurn,
  toClaudeCodeInputLine,
} from './claude-sessions.js';

function running(id: string): ClaudeSessionEvent {
  return { id, type: 'session.status_running' };
}

function message(id: string, text: string): ClaudeSessionEvent {
  return { id, type: 'agent.message', text };
}

function idle(id: string, stopReason = 'end_turn'): ClaudeSessionEvent {
  return { id, type: 'session.status_idle', stopReason };
}

describe('readFinishedTurn', () => {
  it('is not finished before anything has happened', () => {
    expect(readFinishedTurn([])).toBeUndefined();
  });

  it('is not finished while the session is still working', () => {
    expect(readFinishedTurn([running('1'), message('2', 'Looking into it.')])).toBeUndefined();
  });

  it('returns the last thing the agent said once it goes idle', () => {
    const turn = readFinishedTurn([
      running('1'),
      message('2', 'Building the page.'),
      message('3', 'Done.\nhttps://claude.ai/artifact/abc'),
      idle('4'),
    ]);

    expect(turn).toEqual({ stopReason: 'end_turn', finalMessage: 'Done.\nhttps://claude.ai/artifact/abc' });
  });

  it('carries the stop reason through when the session stopped for another reason', () => {
    expect(readFinishedTurn([running('1'), message('2', 'Trying.'), idle('3', 'error_max_turns')])?.stopReason).toBe(
      'error_max_turns',
    );
  });

  it('does not answer with a message from an earlier turn', () => {
    // A turn that ends in silence has no final message of its own, whatever the one before it said.
    const turn = readFinishedTurn([running('1'), message('2', 'First answer.'), idle('3'), running('4'), idle('5')]);

    expect(turn).toEqual({ stopReason: 'end_turn', finalMessage: '' });
  });

  it('is not finished when an earlier turn ended and a new one is under way', () => {
    expect(readFinishedTurn([running('1'), message('2', 'First answer.'), idle('3'), running('4')])).toBeUndefined();
  });
});

describe('readClaudeCodeOutputLine', () => {
  it('reads the text of an assistant message, and passes over its tool calls', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Cloning the repository.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'gh repo clone x/y' } },
        ],
      },
    });

    expect(readClaudeCodeOutputLine(line)).toEqual({ type: 'message', text: 'Cloning the repository.' });
  });

  it('passes over an assistant message that is only a tool call', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } });

    expect(readClaudeCodeOutputLine(line)).toBeUndefined();
  });

  it('passes over everything else Claude Code prints', () => {
    expect(readClaudeCodeOutputLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeUndefined();
    expect(readClaudeCodeOutputLine(JSON.stringify({ type: 'user', message: { content: [] } }))).toBeUndefined();
    expect(readClaudeCodeOutputLine('Warning: something that is not JSON')).toBeUndefined();
  });

  it('ends the turn on a successful result', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Done.' });

    expect(readClaudeCodeOutputLine(line)).toEqual({ type: 'result', result: { stopReason: 'end_turn' } });
  });

  it('reports why a failed turn failed', () => {
    const notLoggedIn = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Invalid API key · Please run /login',
    });
    const outOfTurns = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true });

    expect(readClaudeCodeOutputLine(notLoggedIn)).toEqual({
      type: 'result',
      result: { stopReason: 'error', error: 'Invalid API key · Please run /login' },
    });
    expect(readClaudeCodeOutputLine(outOfTurns)).toEqual({
      type: 'result',
      result: { stopReason: 'error_max_turns', error: 'error_max_turns' },
    });
  });
});

describe('toClaudeCodeInputLine', () => {
  it('writes a message as one line of stream-json', () => {
    const line = toClaudeCodeInputLine('Fix the bug.\nThen open a pull request.');

    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd()).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Fix the bug.\nThen open a pull request.' }] },
    });
  });
});

/** A Claude Code process whose output the test writes, and whose input the test reads. */
class FakeClaudeCode {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  readonly received: string[] = [];
  private exit: (result: { code: number | null; stderr: string }) => void = () => {};
  readonly exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    this.exit = resolve;
  });

  constructor(
    readonly sessionId: string,
    readonly resume: boolean,
  ) {
    this.input.setEncoding('utf8');
    this.input.on('data', (chunk: string) => {
      this.received.push(...chunk.split('\n').filter((line) => line.length > 0));
    });
    // Claude Code exits once its input ends and its last turn is answered.
    this.input.on('end', () => this.close(0));
  }

  say(text: string): void {
    this.output.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`);
  }

  finishTurn(isError = false, result = 'Done.'): void {
    this.output.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: isError, result })}\n`);
  }

  close(code: number | null, stderr = ''): void {
    if (this.output.writableEnded) {
      return;
    }

    this.output.end();
    this.exit({ code, stderr });
  }

  receivedTexts(): string[] {
    return this.received.map((line) => JSON.parse(line).message.content[0].text);
  }
}

function fakeHost() {
  const launched: FakeClaudeCode[] = [];
  const sessions = new ClaudeCodeSessions(async (sessionId, resume): Promise<ClaudeCodeProcess> => {
    const claudeCode = new FakeClaudeCode(sessionId, resume);
    launched.push(claudeCode);
    return claudeCode;
  });

  return { sessions, launched };
}

/** Lets the session read what the fake wrote. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Every event a session has recorded so far. */
async function recordedEvents(sessions: ClaudeCodeSessions, sessionId: string): Promise<ClaudeSessionEvent[]> {
  const events: ClaudeSessionEvent[] = [];
  const controller = new AbortController();
  const following = (async () => {
    for await (const event of sessions.stream(sessionId, controller.signal)) {
      events.push(event);
    }
  })();

  await settle();
  controller.abort();
  await following;

  return events;
}

describe('ClaudeCodeSessions', () => {
  it('starts a new session on the host with the task as its first message', async () => {
    const { sessions, launched } = fakeHost();

    const session = await sessions.create('Build the page.');

    expect(session.status).toBe('running');
    expect(launched).toHaveLength(1);
    expect(launched[0].sessionId).toBe(session.id);
    expect(launched[0].resume).toBe(false);
    await settle();
    expect(launched[0].receivedTexts()).toEqual(['Build the page.']);
  });

  it('forgets a session whose process could not be started, and says why', async () => {
    const sessions = new ClaudeCodeSessions(async () => {
      throw new Error('Claude Code sessions are not configured.');
    });

    await expect(sessions.create('Build the page.')).rejects.toThrow('not configured');
  });

  it('goes idle when the turn is answered, and lets the process exit', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');

    launched[0].say('Building it.');
    launched[0].finishTurn();
    await settle();

    expect(sessions.get(session.id).status).toBe('idle');
    expect(launched[0].input.writableEnded).toBe(true);
    expect(await sessions.waitForTurn(session.id, 1000)).toEqual({
      stopReason: 'end_turn',
      finalMessage: 'Building it.',
    });
  });

  it('waits for a turn still under way', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');

    const waiting = sessions.waitForTurn(session.id, 1000);
    launched[0].say('https://claude.ai/artifact/abc');
    launched[0].finishTurn();

    expect(await waiting).toEqual({ stopReason: 'end_turn', finalMessage: 'https://claude.ai/artifact/abc' });
  });

  it('gives up waiting when the time runs out', async () => {
    const { sessions } = fakeHost();
    const session = await sessions.create('Build the page.');

    expect(await sessions.waitForTurn(session.id, 20)).toBeUndefined();
  });

  it('hands a message to the process still working, and stays running until it is answered too', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Implement the change.');

    await sessions.send(session.id, 'Use push notifications, not e-mail.');
    launched[0].finishTurn();
    await settle();

    expect(launched).toHaveLength(1);
    expect(sessions.get(session.id).status).toBe('running');
    expect(launched[0].receivedTexts()).toEqual(['Implement the change.', 'Use push notifications, not e-mail.']);

    launched[0].finishTurn();
    await settle();

    expect(sessions.get(session.id).status).toBe('idle');
  });

  it('resumes a finished session in a new process', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Implement the change.');
    launched[0].finishTurn();
    await settle();

    await sessions.send(session.id, 'Also update the documentation.');

    expect(launched).toHaveLength(2);
    expect(launched[1].sessionId).toBe(session.id);
    expect(launched[1].resume).toBe(true);
    expect(sessions.get(session.id).status).toBe('running');
    await settle();
    expect(launched[1].receivedTexts()).toEqual(['Also update the documentation.']);
  });

  it('starts one process for two messages sent to an idle session at once', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Implement the change.');
    launched[0].finishTurn();
    await settle();

    await Promise.all([sessions.send(session.id, 'First.'), sessions.send(session.id, 'Second.')]);
    await settle();

    expect(launched).toHaveLength(2);
    expect(launched[1].receivedTexts()).toEqual(['First.', 'Second.']);
  });

  it('reports a failed turn as an error', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');

    launched[0].finishTurn(true, 'Invalid API key · Please run /login');
    await settle();

    const events = await recordedEvents(sessions, session.id);
    expect(events.map((event) => event.type)).toEqual([
      'session.status_running',
      'session.error',
      'session.status_idle',
    ]);
    expect(events[1]).toMatchObject({ message: 'Invalid API key · Please run /login' });
    expect(await sessions.waitForTurn(session.id, 1000)).toMatchObject({ stopReason: 'error' });
  });

  it('reports a process that exits without answering, with what it wrote to stderr', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');

    launched[0].close(255, 'ssh: connect to host host.docker.internal port 22: Connection refused');
    await settle();

    const events = await recordedEvents(sessions, session.id);
    expect(events.map((event) => event.type)).toEqual([
      'session.status_running',
      'session.error',
      'session.status_idle',
    ]);
    expect(events[1]).toMatchObject({ message: expect.stringContaining('Connection refused') });
    expect(await sessions.waitForTurn(session.id, 1000)).toMatchObject({ stopReason: 'process_exited' });
  });

  it('starts a session afresh, rather than resuming it, when its first process never reached the host', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');
    launched[0].close(255, 'Connection refused');
    await settle();

    await sessions.send(session.id, 'Try again.');

    expect(launched[1].resume).toBe(false);
  });

  it('streams every event from the first, then each new one as it happens', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');
    launched[0].say('Working.');
    await settle();

    const controller = new AbortController();
    const streamed: string[] = [];
    const following = (async () => {
      for await (const event of sessions.stream(session.id, controller.signal)) {
        streamed.push(event.type);
      }
    })();

    launched[0].finishTurn();
    await settle();
    controller.abort();
    await following;

    expect(streamed).toEqual(['session.status_running', 'agent.message', 'session.status_idle']);
    expect(new Set((await recordedEvents(sessions, session.id)).map((event) => event.id)).size).toBe(3);
  });

  it('keeps only the latest messages when asked for a few', async () => {
    const { sessions, launched } = fakeHost();
    const session = await sessions.create('Build the page.');
    for (const text of ['One.', 'Two.', 'Three.']) {
      launched[0].say(text);
    }
    await settle();

    expect(sessions.latestMessages(session.id, 2)).toEqual(['Two.', 'Three.']);
    expect(sessions.latestMessages(session.id, 0)).toEqual([]);
  });

  it('says a session is unknown, and where its transcript is, after a restart', () => {
    const { sessions } = fakeHost();

    expect(() => sessions.get('0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11')).toThrow(
      '~/jarvis-sessions/0b7e1d52-6c3f-4f7e-9a51-2f7d8c9e0a11',
    );
  });
});
