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
  issueNumber: number;
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
            issueNumber: String(metadata.issueNumber),
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

/** Lists every event a session has produced so far. */
export async function listClaudeSessionEvents(sessionId: string): Promise<ClaudeSessionEvent[]> {
  const events: ClaudeSessionEvent[] = [];

  for await (const event of getClient().beta.sessions.events.list(sessionId)) {
    events.push(event);
  }

  return events;
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

/** URL a human can open to watch the session. */
export function getClaudeSessionUrl(sessionId: string): string {
  return `https://platform.claude.com/sessions/${sessionId}`;
}
