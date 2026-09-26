/**
 * Claude cloud session client.
 *
 * Thin wrapper around the Claude Managed Agents session API, which is what the
 * coding vertical delegates actual implementation work to. A session is an
 * agent instance running in a sandboxed cloud environment; it is created with a
 * task, emits events while it works, and can be steered with follow-up
 * messages.
 *
 * @see https://platform.claude.com/docs/en/managed-agents/sessions
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { BetaManagedAgentsSession } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import { logger } from '../../utils/logger.js';

export type ClaudeSession = BetaManagedAgentsSession;
export type ClaudeSessionEvent = BetaManagedAgentsSessionEvent;
export type ClaudeSessionStatus = ClaudeSession['status'];

/**
 * Configuration needed to talk to the session API.
 *
 * All three come from the environment. Their values are never logged — only
 * whether they are set — per the repository's secret handling rules.
 */
export interface ClaudeSessionConfiguration {
  apiKey: string;
  agentId: string;
  environmentId: string;
}

/** What a session was started for, stored on the session for traceability. */
export interface ClaudeSessionMetadata {
  repository: string;
  /** The issue the session implements, when it was started from one. */
  issueNumber?: number;
}

/**
 * Reads the session credentials from the environment.
 *
 * @throws If any of them is missing, naming which one without revealing values
 */
export function getClaudeSessionConfiguration(): ClaudeSessionConfiguration {
  const apiKey = process.env.HEY_JARVIS_ANTHROPIC_API_KEY;
  const agentId = process.env.HEY_JARVIS_CLAUDE_AGENT_ID;
  const environmentId = process.env.HEY_JARVIS_CLAUDE_ENVIRONMENT_ID;

  if (!apiKey || !agentId || !environmentId) {
    const missing = [
      !apiKey && 'HEY_JARVIS_ANTHROPIC_API_KEY',
      !agentId && 'HEY_JARVIS_CLAUDE_AGENT_ID',
      !environmentId && 'HEY_JARVIS_CLAUDE_ENVIRONMENT_ID',
    ].filter((name): name is string => typeof name === 'string');

    throw new Error(
      `Claude cloud sessions are not configured. Missing environment variables: ${missing.join(', ')}. ` +
        'Create an agent and an environment in the Claude console, then set these before starting a coding session.',
    );
  }

  return { apiKey, agentId, environmentId };
}

/** True when the environment carries everything a session needs. */
export function isClaudeSessionConfigured(): boolean {
  try {
    getClaudeSessionConfiguration();
    return true;
  } catch {
    return false;
  }
}

let client: Anthropic | undefined;

/**
 * The Anthropic client, created on first use.
 *
 * Constructed lazily rather than at module load so that importing the coding
 * vertical does not require the credentials to be present — only starting or
 * following a session does.
 */
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getClaudeSessionConfiguration().apiKey });
  }

  return client;
}

/**
 * Creates a cloud session and starts it on the given task.
 *
 * The task is passed as an initial `user.message` event, which makes the
 * session start `running` straight away instead of sitting idle waiting for a
 * separate event post.
 *
 * @param task - The instructions the session should carry out
 * @param metadata - What the session is working on, kept on the session itself
 * @returns The created session, including the id used to follow it
 */
export async function createClaudeSession(task: string, metadata?: ClaudeSessionMetadata): Promise<ClaudeSession> {
  const configuration = getClaudeSessionConfiguration();

  const session = await getClient().beta.sessions.create({
    agent: configuration.agentId,
    environment_id: configuration.environmentId,
    initial_events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: task }],
      },
    ],
    ...(metadata
      ? {
          metadata: {
            repository: metadata.repository,
            ...(metadata.issueNumber ? { issueNumber: String(metadata.issueNumber) } : {}),
          },
        }
      : {}),
  });

  logger.info('[CLAUDE SESSION] Session created', { sessionId: session.id, status: session.status });

  return session;
}

/** Retrieves a session's current state. */
export async function getClaudeSession(sessionId: string): Promise<ClaudeSession> {
  return await getClient().beta.sessions.retrieve(sessionId);
}

/**
 * Sends a follow-up message to a running or idle session.
 *
 * Used to answer a question the session asked, or to redirect it mid-flight.
 */
export async function sendClaudeSessionMessage(sessionId: string, message: string): Promise<void> {
  await getClient().beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: message }],
      },
    ],
  });
}

/**
 * A session's events of the given types, newest first, fetched a page at a time as they are read.
 *
 * Newest first because every caller wants the end of the history, and a session that has worked
 * for a few minutes has hundreds of events behind it -- every tool call, every thinking block --
 * each page of them one more request in series. Read from the end and filtered by type, the
 * caller stops after the handful it needs, usually within the first page.
 */
function listClaudeSessionEventsNewestFirst(
  sessionId: string,
  types: readonly ClaudeSessionEvent['type'][],
  pageSize?: number,
): AsyncIterable<ClaudeSessionEvent> {
  return getClient().beta.sessions.events.list(sessionId, {
    order: 'desc',
    types: [...types],
    ...(pageSize ? { limit: pageSize } : {}),
  });
}

/** The event types {@link readFinishedTurn} decides from; everything else it passes over. */
const TURN_EVENT_TYPES = [
  'session.status_running',
  'session.status_idle',
  'session.status_terminated',
  'agent.message',
] as const satisfies readonly ClaudeSessionEvent['type'][];

/** The text of an agent message, its blocks joined. */
function messageText(event: Extract<ClaudeSessionEvent, { type: 'agent.message' }>): string {
  return event.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Tails a session's live event stream.
 *
 * Yields only persisted events: the stream also carries `event_start` and
 * `event_delta` previews of in-progress text, which have no identity of their
 * own and are followed by the whole event moments later.
 *
 * @param sessionId - The session to follow
 * @param signal - Aborts the underlying connection when cancelled
 */
export async function* streamClaudeSessionEvents(
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<ClaudeSessionEvent> {
  const stream = await getClient().beta.sessions.events.stream(sessionId, undefined, { signal });

  for await (const event of stream) {
    if (event.type === 'event_start' || event.type === 'event_delta') {
      continue;
    }

    yield event;
  }
}

/** How a session's turn came to an end. */
export interface FinishedClaudeSessionTurn {
  /**
   * Why the session stopped: an idle stop reason (`end_turn`, `requires_action`,
   * `retries_exhausted`, …) or `terminated` when the session ended for good.
   */
  stopReason: string;
  /** The text of the last message the agent sent, empty when it sent none. */
  finalMessage: string;
}

/**
 * Reads from a session's history whether its latest turn is over, and what the
 * agent said last in it.
 *
 * A session goes idle when its turn is over and terminates when it is over for
 * good. Walking back from the end, either one found before the turn's
 * `session.status_running` means there is nothing more to wait for; a turn
 * that is still going returns `undefined`.
 */
export function readFinishedTurn(events: ClaudeSessionEvent[]): FinishedClaudeSessionTurn | undefined {
  let stopReason: string | undefined;

  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];

    switch (event.type) {
      case 'session.status_running':
        // The start of the turn. Reached with no stop behind it, the session is still working;
        // reached with one, the turn ended without the agent saying anything.
        return stopReason ? { stopReason, finalMessage: '' } : undefined;
      case 'session.status_idle':
        stopReason ??= event.stop_reason.type;
        break;
      case 'session.status_terminated':
        stopReason ??= 'terminated';
        break;
      case 'agent.message':
        if (stopReason) {
          return { stopReason, finalMessage: messageText(event) };
        }
        break;
    }
  }

  return stopReason ? { stopReason, finalMessage: '' } : undefined;
}

/**
 * {@link readFinishedTurn} over a history read newest first, reading no further back than the
 * start of the latest turn.
 *
 * Nothing before that `session.status_running` can change the answer, so the rest of the history
 * is never fetched: the question the user is waiting on follows the analysis by one page of
 * events rather than by every page the session produced.
 */
export async function readLatestTurn(
  newestFirst: AsyncIterable<ClaudeSessionEvent>,
): Promise<FinishedClaudeSessionTurn | undefined> {
  const latestTurn: ClaudeSessionEvent[] = [];

  for await (const event of newestFirst) {
    latestTurn.unshift(event);
    if (event.type === 'session.status_running') {
      break;
    }
  }

  return readFinishedTurn(latestTurn);
}

/**
 * The text of the latest messages in a history read newest first, oldest of them first.
 *
 * Stops reading once it has `count`, so the rest of the history is never fetched.
 */
export async function readLatestMessages(
  newestFirst: AsyncIterable<ClaudeSessionEvent>,
  count: number,
): Promise<string[]> {
  const messages: string[] = [];
  if (count <= 0) {
    return messages;
  }

  for await (const event of newestFirst) {
    const text = event.type === 'agent.message' ? messageText(event) : '';
    if (text.length > 0) {
      messages.unshift(text);
    }

    // Checked after the event rather than before the next one, which would already have been
    // fetched -- a whole page of it, when this one ended the page.
    if (messages.length >= count) {
      break;
    }
  }

  return messages;
}

/** The latest messages a session's agent has sent, oldest of them first. */
export async function listLatestClaudeSessionMessages(sessionId: string, count: number): Promise<string[]> {
  return await readLatestMessages(listClaudeSessionEventsNewestFirst(sessionId, ['agent.message'], count), count);
}

/** How often a waiting caller checks on a session. */
const TURN_POLL_INTERVAL_MILLISECONDS = 5000;

/**
 * Waits for a session to finish its turn, and returns what it said last.
 *
 * Polls rather than streams: a stream opened after the session started has to
 * be trusted to replay what it missed, while the event list is the whole
 * history every time. The session's own status is checked first because it is
 * the cheaper call, and the history is only read once the session claims to be
 * done -- from the end, and only as far back as the start of the turn.
 *
 * @param sessionId - The session to wait for
 * @param timeoutMilliseconds - How long to wait before giving up
 * @returns The finished turn, or `undefined` when the session was still working
 *   when the time ran out
 */
export async function waitForClaudeSessionTurn(
  sessionId: string,
  timeoutMilliseconds: number,
): Promise<FinishedClaudeSessionTurn | undefined> {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const session = await getClaudeSession(sessionId);

    if (session.status === 'idle' || session.status === 'terminated') {
      const finishedTurn = await readLatestTurn(listClaudeSessionEventsNewestFirst(sessionId, TURN_EVENT_TYPES));
      if (finishedTurn) {
        return finishedTurn;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, TURN_POLL_INTERVAL_MILLISECONDS));
  }

  return undefined;
}

/** URL a human can open to watch the session. */
export function getClaudeSessionUrl(sessionId: string): string {
  return `https://platform.claude.com/sessions/${sessionId}`;
}
