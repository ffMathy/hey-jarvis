/**
 * Claude Code sessions, run in a Docker Sandbox on the user's Claude subscription.
 *
 * The coding vertical delegates actual implementation work to Claude Code. A session is started
 * with a task, works unattended in a directory of its own inside the host's sandbox, and can be
 * steered with follow-up messages. Each run of it is one `claude --print` process, reached over SSH
 * and `sbx exec` (see `claude-code-host.ts`); a message sent while it works is written to the same
 * process, and one sent after it has finished starts a new process that resumes the session. The
 * host decides whether a process starts the session or resumes it, and never lets two run it at
 * once, so nothing here has to be right about either for the session to keep working.
 *
 * No process is waited on without a limit: one that will not exit when a new one is due is killed,
 * and one that goes `MAXIMUM_TURN_DURATION_MILLISECONDS` without closing its turn is stopped.
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
  type ClaudeCodeExit,
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
 * How long a new process waits for the session's previous one to exit before killing it.
 *
 * A process whose turn is over has had its input ended and normally exits within seconds. One
 * still going after this is stuck — most often on a connection that has quietly died.
 */
const PREVIOUS_PROCESS_EXIT_TIMEOUT_MILLISECONDS = 30_000;

/**
 * How long a process may go without closing its turn before it is stopped.
 *
 * Generous on purpose: a session implementing a change clones, installs and runs a test suite, on
 * a Raspberry Pi. It is there for a process that will never answer, which would otherwise keep the
 * session `running` forever.
 */
const MAXIMUM_TURN_DURATION_MILLISECONDS = 60 * 60 * 1000;

/**
 * How long sending a message to a newly launched process waits to hear from it.
 *
 * Long enough for SSH to give up on a host that is down (`ConnectTimeout=15`), and for the host to
 * refuse a request, so a process that fails straight away is reported to the caller rather than
 * reported as started. A process that is merely slow — a sandbox cold-starting, or the previous
 * process still holding the session — is taken as started once this passes; if it fails later,
 * that reaches the session's events.
 */
const STARTUP_CONFIRMATION_TIMEOUT_MILLISECONDS = 20_000;

/** The limits a session manager works to; tests shorten them. */
export interface ClaudeCodeSessionTimeouts {
  previousProcessExitMilliseconds: number;
  maximumTurnDurationMilliseconds: number;
  startupConfirmationMilliseconds: number;
}

const DEFAULT_TIMEOUTS: ClaudeCodeSessionTimeouts = {
  previousProcessExitMilliseconds: PREVIOUS_PROCESS_EXIT_TIMEOUT_MILLISECONDS,
  maximumTurnDurationMilliseconds: MAXIMUM_TURN_DURATION_MILLISECONDS,
  startupConfirmationMilliseconds: STARTUP_CONFIRMATION_TIMEOUT_MILLISECONDS,
};

/**
 * Settles with what `promise` settles with, or with `undefined` once `milliseconds` have passed
 * without it settling.
 */
async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), milliseconds);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Says how a process ended, with the end of its stderr — which is where the reason is: the host's
 * refusal, SSH's own error, or Claude Code's. Its start is often only the sandbox saying it started.
 */
export function describeClaudeCodeExit({ code, stderr }: ClaudeCodeExit): string {
  const summary = `Claude Code exited with code ${code}`;
  if (!stderr) {
    return summary;
  }

  return `${summary}: ${stderr.slice(-(MAXIMUM_ERROR_LENGTH - summary.length - 2))}`;
}

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

/** How a newly launched process first showed what it was doing: by writing output, or by exiting. */
type Startup = 'spoke' | 'exited';

/** A process just launched for a session, and how it started — kept apart so launching does not wait for it. */
interface Launched {
  claudeCode: ClaudeCodeProcess;
  startup: Promise<Startup>;
}

interface SessionRecord {
  id: string;
  status: ClaudeSessionStatus;
  events: ClaudeSessionEvent[];
  /**
   * Whether a process of this session has written output, so Claude Code has most likely created
   * the session in the sandbox. Only a hint for the host, which checks for the transcript itself.
   */
  exists: boolean;
  /** The process working on the session, while there is one that can still take messages. */
  process?: ClaudeCodeProcess;
  /** Settles once a process being launched is working, so two messages at once start only one. */
  launching?: Promise<Launched>;
  /** Messages written to the process that it has not closed a turn for yet. */
  unansweredMessages: number;
  /** The most recent process, until a new one replaces it — whether or not it has exited. */
  lastProcess?: ClaudeCodeProcess;
  /** Stops the current process if its turn runs past the limit. */
  turnTimer?: ReturnType<typeof setTimeout>;
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
  private readonly timeouts: ClaudeCodeSessionTimeouts;
  private nextEventNumber = 0;

  constructor(
    private readonly launch: ClaudeCodeLauncher = launchClaudeCodeOverSsh,
    timeouts: Partial<ClaudeCodeSessionTimeouts> = {},
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  /**
   * Creates a session and starts it on the given task.
   *
   * @throws When the process cannot be started, e.g. because the host is not configured, or when
   *   it stops before it has said anything — refused by the host, or unable to reach it
   */
  async create(task: string): Promise<ClaudeSession> {
    const record: SessionRecord = {
      id: randomUUID(),
      status: 'idle',
      events: [],
      exists: false,
      unansweredMessages: 0,
      listeners: new Set(),
    };

    this.sessions.set(record.id, record);

    try {
      await this.send(record.id, task);
    } catch (error) {
      this.sessions.delete(record.id);
      clearTimeout(record.turnTimer);
      record.process?.kill();
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
   *
   * @throws When the message could not be handed to Claude Code: its process has already stopped,
   *   or the one launched for it stopped before saying anything. Either way the reason is also in
   *   the session's events, and sending again launches a new process.
   */
  async send(sessionId: string, message: string): Promise<void> {
    const record = this.require(sessionId);
    let launched: Launched | undefined;

    if (!record.process) {
      record.launching ??= this.relaunch(record).finally(() => {
        record.launching = undefined;
      });
      launched = await record.launching;
    }

    const claudeCode = launched?.claudeCode ?? record.process;
    if (!claudeCode) {
      throw new Error("Claude Code stopped before it could be sent the message; the session's events say why.");
    }

    // A process can stop between being launched or found running and being written to. The write
    // would then vanish into a closed pipe while the caller was told it had been delivered.
    record.unansweredMessages++;
    try {
      await this.write(claudeCode, toClaudeCodeInputLine(message));
    } catch (error) {
      record.unansweredMessages = Math.max(0, record.unansweredMessages - 1);
      if (launched) {
        throw await this.stoppedBeforeStarting(claudeCode);
      }

      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Claude Code stopped before it could be sent the message: ${reason}`, { cause: error });
    }

    if (launched && (await within(launched.startup, this.timeouts.startupConfirmationMilliseconds)) === 'exited') {
      throw await this.stoppedBeforeStarting(claudeCode);
    }
  }

  private async write(claudeCode: ClaudeCodeProcess, line: string): Promise<void> {
    if (!claudeCode.input.writable) {
      throw new Error('its input is closed');
    }

    await new Promise<void>((resolve, reject) => {
      claudeCode.input.write(line, (error) => (error ? reject(error) : resolve()));
    });
  }

  /** Says why a process launched for a message stopped before it could take it. */
  private async stoppedBeforeStarting(claudeCode: ClaudeCodeProcess): Promise<Error> {
    const exit = await within(claudeCode.exited, this.timeouts.startupConfirmationMilliseconds);
    return new Error(`Claude Code stopped before it started. ${exit ? describeClaudeCodeExit(exit) : ''}`.trim());
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

    // A plain timer rather than `AbortSignal.timeout`, whose timer does not keep the event loop
    // alive: with nothing else pending, Bun never fired it, and the wait never ended.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMilliseconds);

    try {
      for await (const event of this.stream(sessionId, deadline.signal)) {
        // An idle event replayed from an earlier turn is passed over while the session is working
        // on a later one.
        if (event.type === 'session.status_idle' && record.status === 'idle') {
          return readFinishedTurn(record.events);
        }
      }
    } finally {
      clearTimeout(timer);
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
   * Launches a process for a session that has none, once the last one has exited.
   *
   * The wait is bounded: a previous process still there after it is killed, and the new one
   * launched anyway. The host's per-session lock is what finally keeps the two from running the
   * session at once — the new one waits there for whatever is left of the old one in the sandbox.
   */
  private async relaunch(record: SessionRecord): Promise<Launched> {
    if (record.lastProcess) {
      await this.waitForExit(record, record.lastProcess);
    }

    const claudeCode = await this.launch(record.id, record.exists);
    return { claudeCode, startup: this.start(record, claudeCode) };
  }

  private async waitForExit(record: SessionRecord, claudeCode: ClaudeCodeProcess): Promise<void> {
    const limit = this.timeouts.previousProcessExitMilliseconds;
    if (await within(claudeCode.exited, limit)) {
      return;
    }

    logger.warn('[CLAUDE SESSION] Previous Claude Code process did not exit, killing it', { sessionId: record.id });
    claudeCode.kill();

    if (!(await within(claudeCode.exited, limit))) {
      logger.warn('[CLAUDE SESSION] Previous Claude Code process survived being killed, launching anyway', {
        sessionId: record.id,
      });
    }
  }

  /**
   * Hands a freshly launched process the session, and follows it until it exits.
   *
   * @returns How the process started: `spoke` once it writes its first line, `exited` if it stops
   *   before that
   */
  private start(record: SessionRecord, claudeCode: ClaudeCodeProcess): Promise<Startup> {
    record.process = claudeCode;
    record.lastProcess = claudeCode;
    record.status = 'running';
    this.emit(record, { type: 'session.status_running' });
    this.armTurnTimer(record, claudeCode);

    return new Promise<Startup>((resolve) => {
      void claudeCode.exited.then(() => resolve('exited'));
      void this.follow(record, claudeCode, () => resolve('spoke'));
    });
  }

  /** (Re)starts the clock on the process's current turn. */
  private armTurnTimer(record: SessionRecord, claudeCode: ClaudeCodeProcess): void {
    clearTimeout(record.turnTimer);

    const limit = this.timeouts.maximumTurnDurationMilliseconds;
    record.turnTimer = setTimeout(() => {
      if (record.process !== claudeCode) {
        return;
      }

      logger.error('[CLAUDE SESSION] Claude Code did not finish its turn in time, stopping it', {
        sessionId: record.id,
        limitMinutes: limit / 60_000,
      });
      this.emit(record, {
        type: 'session.error',
        message: `Claude Code did not finish its turn within ${Math.round(limit / 60_000)} minutes, so it was stopped.`,
      });
      this.finish(record, claudeCode, 'timed_out');
      claudeCode.kill();
    }, limit);
    // The clock is no reason to keep the server running.
    record.turnTimer.unref?.();
  }

  private async follow(record: SessionRecord, claudeCode: ClaudeCodeProcess, onFirstLine: () => void): Promise<void> {
    for await (const line of createInterface({ input: claudeCode.output, crlfDelay: Number.POSITIVE_INFINITY })) {
      // Any output at all means Claude Code is running, and has most likely created the session. A
      // process that never got that far -- SSH could not connect, the sandbox would not start --
      // has not. Either way this is only the hint sent to the host, which checks for itself.
      record.exists = true;
      onFirstLine();

      // A process that has been let go, or stopped, no longer speaks for the session.
      if (record.process !== claudeCode) {
        continue;
      }

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
        } else {
          // A message written while it worked opens a turn of its own, with a clock of its own.
          this.armTurnTimer(record, claudeCode);
        }
      }
    }

    const exit = await claudeCode.exited;

    // A process that exits with messages still unanswered never got to its `result`: the host
    // refused it (64, or 65 without a token), the session was held by another process (75), SSH
    // could not connect (255), the sandbox could not be started, or the connection dropped mid-turn.
    if (record.process === claudeCode) {
      logger.error('[CLAUDE SESSION] Claude Code exited before finishing its turn', {
        sessionId: record.id,
        code: exit.code,
      });

      this.emit(record, { type: 'session.error', message: describeClaudeCodeExit(exit) });
      this.finish(record, claudeCode, 'process_exited');
    }
  }

  private finish(record: SessionRecord, claudeCode: ClaudeCodeProcess, stopReason: string): void {
    clearTimeout(record.turnTimer);
    record.turnTimer = undefined;
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
