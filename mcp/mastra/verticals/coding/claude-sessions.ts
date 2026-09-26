/**
 * Claude Code sessions, run in a Docker Sandbox on the user's Claude subscription.
 *
 * The coding vertical delegates actual implementation work to Claude Code. A session is started
 * with a task, works unattended in a directory of its own inside the host's sandbox, and can be
 * steered with follow-up messages. Each run of it is one `claude --print` process, reached over SSH
 * and `sbx exec` (see `claude-code-host.ts`); a message sent while it works is written to the same
 * process, and one sent after it has finished starts a new process that resumes the session.
 *
 * What a session says is kept here, in memory, as a small set of events: the process started, the
 * agent said something, the process stopped, or something broke. Claude Code emits far more —
 * every tool call and its result — and none of it is what anyone following the session wants to
 * hear. Being in memory, a session does not outlive a restart of the server; the transcript stays
 * in the sandbox, where `claude --resume` in the session's directory picks it up by hand.
 *
 * @see https://code.claude.com/docs/en/headless
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { truncate } from 'lodash-es';
import { logger } from '../../utils/logger.js';
import {
  type ClaudeCodeLauncher,
  type ClaudeCodeProcess,
  launchClaudeCodeOverSsh,
  SANDBOX_NAME,
  SANDBOX_SESSIONS_DIRECTORY,
} from './claude-code-host.js';

export type ClaudeSessionStatus = 'running' | 'idle';

/** A session as its callers see it. */
export interface ClaudeSession {
  id: string;
  status: ClaudeSessionStatus;
}

/** What happened in a session, in the few kinds that matter to anyone following it. */
export type ClaudeSessionEvent =
  | { id: string; type: 'session.status_running' }
  | { id: string; type: 'agent.message'; text: string }
  | {
      id: string;
      type: 'session.status_idle';
      /** `end_turn` when the work finished, otherwise why it stopped. */
      stopReason: string;
    }
  | { id: string; type: 'session.error'; message: string };

/** An event before the session has numbered it: each kind of event, without its `id`. */
type UnnumberedEvent = ClaudeSessionEvent extends infer Event
  ? Event extends unknown
    ? Omit<Event, 'id'>
    : never
  : never;

/** Longest error excerpt carried in an event. */
const MAXIMUM_ERROR_LENGTH = 1000;

/**
 * One line of Claude Code's stream-json output.
 *
 * Only the fields read here are described. `assistant` carries a model message, `result` closes a
 * turn; everything else — the `system` init line, tool results echoed back as `user` — is passed
 * over.
 */
interface ClaudeCodeOutputLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  message?: { content?: Array<{ type?: string; text?: string }> };
}

/** Whether a line's `result` event ends the turn, and how. */
export interface ClaudeCodeTurnResult {
  stopReason: string;
  error?: string;
}

/**
 * Reads what a line of stream-json output means for the session.
 *
 * @returns The agent's message, when the line is one with text in it; the end of a turn, when the
 *   line is a `result`; nothing otherwise, including for a line that is not JSON at all
 */
export function readClaudeCodeOutputLine(
  line: string,
): { type: 'message'; text: string } | { type: 'result'; result: ClaudeCodeTurnResult } | undefined {
  let parsed: ClaudeCodeOutputLine;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (parsed.type === 'assistant') {
    const text = (parsed.message?.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return text ? { type: 'message', text } : undefined;
  }

  if (parsed.type === 'result') {
    if (!parsed.is_error) {
      return { type: 'result', result: { stopReason: 'end_turn' } };
    }

    // A failed turn says why in `result` (an API error, a missing login) or in `errors`, and names
    // the kind of failure in `subtype` unless it is one that still counts as `success`.
    const stopReason = parsed.subtype && parsed.subtype !== 'success' ? parsed.subtype : 'error';
    const error = parsed.result || parsed.errors?.join('\n') || stopReason;

    return { type: 'result', result: { stopReason, error: truncate(error, { length: MAXIMUM_ERROR_LENGTH }) } };
  }

  return undefined;
}

/** A user message as Claude Code reads it with `--input-format stream-json`. */
export function toClaudeCodeInputLine(message: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: message }] },
    parent_tool_use_id: null,
    session_id: '',
  })}\n`;
}

/** How a session's turn came to an end. */
export interface FinishedClaudeSessionTurn {
  /** Why the session stopped: `end_turn` when it finished its work, otherwise what went wrong. */
  stopReason: string;
  /** The text of the last message the agent sent, empty when it sent none. */
  finalMessage: string;
}

/**
 * Reads from a session's history whether its latest turn is over, and what the agent said last in
 * it.
 *
 * Walking back from the end, a `session.status_idle` found before the turn's
 * `session.status_running` means there is nothing more to wait for; a turn that is still going
 * returns `undefined`.
 */
export function readFinishedTurn(events: readonly ClaudeSessionEvent[]): FinishedClaudeSessionTurn | undefined {
  let stopReason: string | undefined;

  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];

    switch (event.type) {
      case 'session.status_running':
        // The start of the turn. Reached with no stop behind it, the session is still working;
        // reached with one, the turn ended without the agent saying anything.
        return stopReason ? { stopReason, finalMessage: '' } : undefined;
      case 'session.status_idle':
        stopReason ??= event.stopReason;
        break;
      case 'agent.message':
        if (stopReason) {
          return { stopReason, finalMessage: event.text };
        }
        break;
    }
  }

  return stopReason ? { stopReason, finalMessage: '' } : undefined;
}

interface SessionRecord {
  id: string;
  status: ClaudeSessionStatus;
  events: ClaudeSessionEvent[];
  /** Whether Claude Code has created the session in the sandbox, so the next process resumes it. */
  exists: boolean;
  /** The process working on the session, while there is one that can still take messages. */
  process?: ClaudeCodeProcess;
  /** Settles once a process being launched is working, so two messages at once start only one. */
  launching?: Promise<void>;
  /** Messages written to the process that it has not closed a turn for yet. */
  unansweredMessages: number;
  /** Settles when the last process has exited. */
  lastExit: Promise<unknown>;
  /** Called whenever an event is added. */
  listeners: Set<() => void>;
}

/**
 * The sessions this server has started, and the processes working on them.
 *
 * One instance serves the whole server; tests make their own with a fake launcher.
 */
export class ClaudeCodeSessions {
  private readonly sessions = new Map<string, SessionRecord>();
  private nextEventNumber = 0;

  constructor(private readonly launch: ClaudeCodeLauncher = launchClaudeCodeOverSsh) {}

  /**
   * Creates a session and starts it on the given task.
   *
   * @throws When the process cannot be started, e.g. because the host is not configured
   */
  async create(task: string): Promise<ClaudeSession> {
    const record: SessionRecord = {
      id: randomUUID(),
      status: 'idle',
      events: [],
      exists: false,
      unansweredMessages: 0,
      lastExit: Promise.resolve(),
      listeners: new Set(),
    };

    this.sessions.set(record.id, record);

    try {
      await this.send(record.id, task);
    } catch (error) {
      this.sessions.delete(record.id);
      throw error;
    }

    logger.info('[CLAUDE SESSION] Session created', { sessionId: record.id });

    return this.get(record.id);
  }

  /**
   * A session's current state.
   *
   * @throws For a session this server does not know, which includes every session started before
   *   it last restarted
   */
  get(sessionId: string): ClaudeSession {
    const record = this.require(sessionId);
    return { id: record.id, status: record.status };
  }

  /**
   * Sends a message to a session.
   *
   * A session still working reads it once its current turn is over; one that has finished is
   * resumed on it.
   */
  async send(sessionId: string, message: string): Promise<void> {
    const record = this.require(sessionId);

    if (!record.process) {
      record.launching ??= this.relaunch(record).finally(() => {
        record.launching = undefined;
      });
      await record.launching;
    }

    record.unansweredMessages++;
    record.process?.input.write(toClaudeCodeInputLine(message));
  }

  /**
   * A session's events, from its first, then each new one as it happens, until `signal` aborts.
   *
   * A session can always be resumed with another message, so its events never run out on their
   * own.
   */
  async *stream(sessionId: string, signal?: AbortSignal): AsyncGenerator<ClaudeSessionEvent> {
    const record = this.require(sessionId);
    let index = 0;

    while (!signal?.aborted) {
      while (index < record.events.length) {
        yield record.events[index++];
      }

      // The caller may have aborted while this was suspended at a yield, and an abort that has
      // already happened is never announced to a listener added after it.
      if (signal?.aborted) {
        return;
      }

      await new Promise<void>((resolve) => {
        const done = () => {
          record.listeners.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        record.listeners.add(done);
        signal?.addEventListener('abort', done);
      });
    }
  }

  /** The text of the latest messages the agent has sent, oldest of them first. */
  latestMessages(sessionId: string, count: number): string[] {
    if (count <= 0) {
      return [];
    }

    return this.require(sessionId)
      .events.flatMap((event) => (event.type === 'agent.message' ? [event.text] : []))
      .slice(-count);
  }

  /**
   * Waits for a session to finish its turn, and returns what it said last.
   *
   * @returns The finished turn, or `undefined` when the session was still working when the time
   *   ran out
   */
  async waitForTurn(sessionId: string, timeoutMilliseconds: number): Promise<FinishedClaudeSessionTurn | undefined> {
    const record = this.require(sessionId);

    for await (const event of this.stream(sessionId, AbortSignal.timeout(timeoutMilliseconds))) {
      // An idle event replayed from an earlier turn is passed over while the session is working
      // on a later one.
      if (event.type === 'session.status_idle' && record.status === 'idle') {
        return readFinishedTurn(record.events);
      }
    }

    return undefined;
  }

  private require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(
        `There is no Claude Code session ${sessionId} on this server. Sessions are kept in memory, so one ` +
          `started before the server last restarted is gone from here — its transcript is still in the ` +
          `${SANDBOX_NAME} sandbox, in ~/${SANDBOX_SESSIONS_DIRECTORY}/${sessionId}.`,
      );
    }

    return record;
  }

  private emit(record: SessionRecord, event: UnnumberedEvent): void {
    record.events.push({ ...event, id: `${record.id}:${this.nextEventNumber++}` });
    for (const listener of [...record.listeners]) {
      listener();
    }
  }

  /**
   * Launches a process for a session that has none, once the last one has exited, so two never
   * write to the same transcript.
   */
  private async relaunch(record: SessionRecord): Promise<void> {
    await record.lastExit;
    this.start(record, await this.launch(record.id, record.exists));
  }

  /** Hands a freshly launched process the session, and follows it until it exits. */
  private start(record: SessionRecord, claudeCode: ClaudeCodeProcess): void {
    record.process = claudeCode;
    record.status = 'running';
    record.lastExit = claudeCode.exited;
    this.emit(record, { type: 'session.status_running' });

    void this.follow(record, claudeCode);
  }

  private async follow(record: SessionRecord, claudeCode: ClaudeCodeProcess): Promise<void> {
    for await (const line of createInterface({ input: claudeCode.output, crlfDelay: Number.POSITIVE_INFINITY })) {
      // Any output at all means Claude Code is running, and has created the session to resume. A
      // process that never got that far -- SSH could not connect, the sandbox would not start --
      // leaves nothing to resume.
      record.exists = true;
      const output = readClaudeCodeOutputLine(line);

      if (output?.type === 'message') {
        this.emit(record, { type: 'agent.message', text: output.text });
      } else if (output?.type === 'result') {
        if (output.result.error) {
          this.emit(record, { type: 'session.error', message: output.result.error });
        }

        record.unansweredMessages = Math.max(0, record.unansweredMessages - 1);
        if (record.unansweredMessages === 0) {
          // Nothing left to answer, so the process is let go: ending its input is what lets it exit.
          // From here a new message starts a new process, which resumes the session.
          this.finish(record, claudeCode, output.result.stopReason);
        }
      }
    }

    const { code, stderr } = await claudeCode.exited;

    // A process that exits with messages still unanswered never got to its `result`: SSH could not
    // connect, the sandbox could not be started, or the connection dropped mid-turn.
    if (record.process === claudeCode) {
      logger.error('[CLAUDE SESSION] Claude Code exited before finishing its turn', { sessionId: record.id, code });

      this.emit(record, {
        type: 'session.error',
        message: truncate(stderr || `Claude Code exited with code ${code}`, { length: MAXIMUM_ERROR_LENGTH }),
      });
      this.finish(record, claudeCode, 'process_exited');
    }
  }

  private finish(record: SessionRecord, claudeCode: ClaudeCodeProcess, stopReason: string): void {
    claudeCode.input.end();
    record.process = undefined;
    record.unansweredMessages = 0;
    record.status = 'idle';
    this.emit(record, { type: 'session.status_idle', stopReason });
  }
}

const sessions = new ClaudeCodeSessions();

/**
 * Creates a session and starts it on the given task.
 *
 * @param task - The instructions the session should carry out
 * @returns The created session, including the id used to follow it
 */
export async function createClaudeSession(task: string): Promise<ClaudeSession> {
  return await sessions.create(task);
}

/** Retrieves a session's current state. */
export function getClaudeSession(sessionId: string): ClaudeSession {
  return sessions.get(sessionId);
}

/**
 * Sends a follow-up message to a running or idle session.
 *
 * Used to answer a question the session asked, or to redirect it.
 */
export async function sendClaudeSessionMessage(sessionId: string, message: string): Promise<void> {
  await sessions.send(sessionId, message);
}

/**
 * Follows a session's events, from its first, until `signal` aborts.
 *
 * @param sessionId - The session to follow
 * @param signal - Stops following when aborted
 */
export function streamClaudeSessionEvents(sessionId: string, signal?: AbortSignal): AsyncGenerator<ClaudeSessionEvent> {
  return sessions.stream(sessionId, signal);
}

/** The latest messages a session's agent has sent, oldest of them first. */
export function listLatestClaudeSessionMessages(sessionId: string, count: number): string[] {
  return sessions.latestMessages(sessionId, count);
}

/**
 * Waits for a session to finish its turn, and returns what it said last.
 *
 * @returns The finished turn, or `undefined` when the session was still working when the time ran
 *   out
 */
export async function waitForClaudeSessionTurn(
  sessionId: string,
  timeoutMilliseconds: number,
): Promise<FinishedClaudeSessionTurn | undefined> {
  return await sessions.waitForTurn(sessionId, timeoutMilliseconds);
}
