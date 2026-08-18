/**
 * Claude cloud session watcher.
 *
 * A coding session runs unattended in the cloud, so nothing in the house hears
 * about it unless something is listening. This watcher tails a session's event
 * stream and forwards every noteworthy event into the Synapse vertical as a
 * state change, which is where subscriptions, batching and notification
 * decisions already live.
 */

import { truncate } from 'lodash-es';
import { logger } from '../../utils/logger.js';
import { executeTool } from '../../utils/tool-factory.js';
import type { StateChange } from '../synapse/state-change.js';
import { registerStateChange } from '../synapse/tools.js';
import { type ClaudeSessionEvent, streamClaudeSessionEvents } from './claude-sessions.js';

/** Vertical name every coding state change is attributed to. */
export const CODING_STATE_CHANGE_SOURCE = 'coding';

/**
 * Event types worth waking Synapse for.
 *
 * A session emits far more than this — thinking blocks, every tool call, model
 * request spans — and each state change costs tokens once Synapse reasons over
 * the batch. These four are the ones that change what a human would want to
 * know: the agent said something, it started, it stopped, or it broke.
 */
export const REPORTED_EVENT_TYPES = [
  'agent.message',
  'session.status_running',
  'session.status_idle',
  'session.error',
] as const;

/** The events {@link REPORTED_EVENT_TYPES} selects, narrowed from the union. */
export type ReportedSessionEvent = Extract<ClaudeSessionEvent, { type: (typeof REPORTED_EVENT_TYPES)[number] }>;

const reportedEventTypes = new Set<string>(REPORTED_EVENT_TYPES);

/** Longest message excerpt carried into a state change. */
const MAXIMUM_MESSAGE_LENGTH = 500;

/** How long to wait before reconnecting a dropped stream. */
const RECONNECT_DELAY_MILLISECONDS = 2000;

/** Consecutive stream failures tolerated before a watcher gives up. */
const MAXIMUM_CONSECUTIVE_FAILURES = 5;

/** Context describing what the session was started for. */
export interface ClaudeSessionContext {
  /** Repository the session works in, as `owner/repo`. */
  repository?: string;
  /** Issue the session implements, when it came from one. */
  issueNumber?: number;
  /** Human-readable title of the task. */
  title?: string;
}

/** Whether an event should reach Synapse at all. */
export function isReportableEvent(event: ClaudeSessionEvent): event is ReportedSessionEvent {
  return reportedEventTypes.has(event.type);
}

/**
 * Pulls the one field that carries an event's meaning.
 *
 * A status transition is meaningful on its own and contributes nothing here.
 */
function describeEvent(event: ReportedSessionEvent): Record<string, unknown> {
  switch (event.type) {
    case 'agent.message': {
      const message = event.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      return message ? { message: truncate(message, { length: MAXIMUM_MESSAGE_LENGTH }) } : {};
    }
    case 'session.status_idle':
      return { stopReason: event.stop_reason.type };
    case 'session.error':
      return { error: event.error.message, errorType: event.error.type };
    default:
      return {};
  }
}

/**
 * Turns a session event into the state change Synapse receives.
 *
 * The `stateType` is derived from the event type so subscriptions can match on
 * it (`agent.message` becomes `coding_session_agent_message`), and the payload
 * stays small: identifiers, what the session is working on, and whatever the
 * event itself carries.
 *
 * @param event - The event as it came off the session stream
 * @param sessionId - The session that produced it
 * @param context - What the session was started for, if known
 */
export function toStateChange(
  event: ReportedSessionEvent,
  sessionId: string,
  context: ClaudeSessionContext = {},
): StateChange {
  return {
    source: CODING_STATE_CHANGE_SOURCE,
    stateType: `coding_session_${event.type.replace(/\./g, '_')}`,
    stateData: {
      sessionId,
      eventId: event.id,
      eventType: event.type,
      ...(context.repository ? { repository: context.repository } : {}),
      ...(context.issueNumber ? { issueNumber: context.issueNumber } : {}),
      ...(context.title ? { task: context.title } : {}),
      ...describeEvent(event),
    },
  };
}

/** Event stream a watcher tails; swapped out in tests. */
export type ClaudeSessionEventStream = (sessionId: string, signal: AbortSignal) => AsyncIterable<ClaudeSessionEvent>;

/** Sink state changes are handed to; swapped out in tests. */
export type StateChangePublisher = (stateChange: StateChange) => Promise<void>;

async function publishToSynapse(stateChange: StateChange): Promise<void> {
  await executeTool(registerStateChange, stateChange);
}

interface WatchedSession {
  controller: AbortController;
  context: ClaudeSessionContext;
}

/**
 * Follows Claude cloud sessions and republishes their events as Synapse state
 * changes.
 *
 * One watcher handles many sessions. Watching is idempotent: asking to watch a
 * session that is already being followed is a no-op, so a restarted workflow
 * step cannot double-report.
 */
export class ClaudeSessionWatcher {
  private readonly watched = new Map<string, WatchedSession>();
  private readonly seenEventIds = new Set<string>();

  constructor(
    private readonly streamEvents: ClaudeSessionEventStream = (sessionId, signal) =>
      streamClaudeSessionEvents(sessionId, signal),
    private readonly publish: StateChangePublisher = publishToSynapse,
    private readonly reconnectDelayMilliseconds: number = RECONNECT_DELAY_MILLISECONDS,
  ) {}

  /**
   * Starts following a session in the background.
   *
   * Returns as soon as the watch is registered — the event loop that feeds
   * Synapse runs detached, so callers (tools, workflow steps) are not blocked
   * for the lifetime of the session.
   */
  watch(sessionId: string, context: ClaudeSessionContext = {}): void {
    if (this.watched.has(sessionId)) {
      logger.info('[CLAUDE SESSION] Already watching session', { sessionId });
      return;
    }

    const controller = new AbortController();
    this.watched.set(sessionId, { controller, context });

    logger.info('[CLAUDE SESSION] Watching session for events', { sessionId });

    void this.run(sessionId, context, controller.signal);
  }

  /** Stops following a session. */
  unwatch(sessionId: string): void {
    const session = this.watched.get(sessionId);
    if (!session) {
      return;
    }

    session.controller.abort();
    this.watched.delete(sessionId);

    logger.info('[CLAUDE SESSION] Stopped watching session', { sessionId });
  }

  /** Session ids currently being followed. */
  getWatchedSessionIds(): string[] {
    return [...this.watched.keys()];
  }

  /**
   * Consumes the session's stream until it ends or the watch is cancelled.
   *
   * The stream can drop for reasons that say nothing about the session (idle
   * timeouts, transient network failures), so it reconnects rather than
   * silently going deaf. Events already forwarded are remembered by id, so a
   * reconnect that replays history does not re-notify.
   */
  private async run(sessionId: string, context: ClaudeSessionContext, signal: AbortSignal): Promise<void> {
    let consecutiveFailures = 0;

    while (!signal.aborted && consecutiveFailures < MAXIMUM_CONSECUTIVE_FAILURES) {
      try {
        for await (const event of this.streamEvents(sessionId, signal)) {
          consecutiveFailures = 0;
          await this.handleEvent(sessionId, context, event);
        }

        // A stream that ends on its own means the session has nothing more to
        // say, so the watch is done.
        break;
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        consecutiveFailures++;
        logger.error('[CLAUDE SESSION] Event stream failed', { sessionId, consecutiveFailures, error });

        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMilliseconds));
      }
    }

    this.watched.delete(sessionId);
    logger.info('[CLAUDE SESSION] Finished watching session', { sessionId });
  }

  private async handleEvent(
    sessionId: string,
    context: ClaudeSessionContext,
    event: ClaudeSessionEvent,
  ): Promise<void> {
    if (this.seenEventIds.has(event.id) || !isReportableEvent(event)) {
      return;
    }

    this.seenEventIds.add(event.id);

    try {
      await this.publish(toStateChange(event, sessionId, context));
    } catch (error) {
      // A failed hand-off must not tear down the watch: the next event still
      // deserves a chance to reach Synapse.
      logger.error('[CLAUDE SESSION] Failed to register state change', { sessionId, eventId: event.id, error });
    }
  }
}

/** Watcher every coding session is registered with. */
export const claudeSessionWatcher = new ClaudeSessionWatcher();
