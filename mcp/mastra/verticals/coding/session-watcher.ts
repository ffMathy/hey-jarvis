/**
 * Claude Code session watcher.
 *
 * A coding session runs unattended in the host's sandbox, so nothing in the
 * house hears about it unless something is listening. This watcher follows a
 * session's events and forwards each one into the Synapse vertical as a state
 * change, which is where subscriptions, batching and notification decisions
 * already live. The session already keeps only the events worth hearing about
 * (see `claude-sessions.ts`), so every one of them is forwarded.
 *
 * It is also where a session's work leaves the sandbox. A session started to
 * implement a change cannot push, so when one of its turns ends with the work
 * done, the watcher publishes it (`publish-session-work.ts`) and reports the
 * pull request — or why there is none — as a state change of its own.
 */

import { truncate } from 'lodash-es';
import { logger } from '../../utils/logger.js';
import { executeTool } from '../../utils/tool-factory.js';
import type { StateChange } from '../synapse/state-change.js';
import { registerStateChange } from '../synapse/tools.js';
import { type ClaudeSessionEvent, streamClaudeSessionEvents } from './claude-sessions.js';
import { type PublishTarget, publishSessionWork, type SessionWorkPublication } from './publish-session-work.js';

/** Vertical name every coding state change is attributed to. */
export const CODING_STATE_CHANGE_SOURCE = 'coding';

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
  /**
   * Where the session's work is published once a turn ends with it done. Only a session started to
   * implement a change has one; a session asked for an answer publishes nothing.
   */
  publishTo?: PublishTarget;
}

/**
 * Pulls the one field that carries an event's meaning.
 *
 * A status transition is meaningful on its own and contributes nothing here.
 */
function describeEvent(event: ClaudeSessionEvent): Record<string, unknown> {
  switch (event.type) {
    case 'agent.message':
      return { message: truncate(event.text, { length: MAXIMUM_MESSAGE_LENGTH }) };
    case 'session.status_idle':
      return { stopReason: event.stopReason };
    case 'session.error':
      return { error: event.message };
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
  event: ClaudeSessionEvent,
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
      ...describeContext(context),
      ...describeEvent(event),
    },
  };
}

function describeContext(context: ClaudeSessionContext): Record<string, unknown> {
  return {
    ...(context.repository ? { repository: context.repository } : {}),
    ...(context.issueNumber ? { issueNumber: context.issueNumber } : {}),
    ...(context.title ? { task: context.title } : {}),
  };
}

/**
 * Turns how publishing a session's work went into the state change Synapse receives:
 * `coding_session_pull_request_opened` with its link, or `coding_session_pull_request_failed` with
 * why — `refused` when the work broke a rule, rather than the publishing itself going wrong.
 *
 * @param eventId - The id of the event that ended the turn, so the state change can be traced to it
 */
export function toPublicationStateChange(
  publication: SessionWorkPublication,
  sessionId: string,
  eventId: string,
  context: ClaudeSessionContext = {},
): StateChange {
  const common = { sessionId, eventId, ...describeContext(context) };

  if (publication.status === 'published') {
    return {
      source: CODING_STATE_CHANGE_SOURCE,
      stateType: 'coding_session_pull_request_opened',
      stateData: {
        ...common,
        branch: publication.branch,
        pullRequestNumber: publication.pullRequest.number,
        pullRequestUrl: publication.pullRequest.url,
        // False when the branch already had one open, which the push has now updated.
        created: publication.created,
      },
    };
  }

  return {
    source: CODING_STATE_CHANGE_SOURCE,
    stateType: 'coding_session_pull_request_failed',
    stateData: { ...common, refused: publication.status === 'refused', error: publication.reason },
  };
}

/** Event stream a watcher tails; swapped out in tests. */
export type ClaudeSessionEventStream = (sessionId: string, signal: AbortSignal) => AsyncIterable<ClaudeSessionEvent>;

/** Sink state changes are handed to; swapped out in tests. */
export type StateChangePublisher = (stateChange: StateChange) => Promise<void>;

/** Publishes a session's work, if its turn ended with it done; swapped out in tests. */
export type SessionWorkPublisher = (
  sessionId: string,
  target: PublishTarget,
  finalMessage: string,
) => Promise<SessionWorkPublication | undefined>;

async function publishToSynapse(stateChange: StateChange): Promise<void> {
  await executeTool(registerStateChange, stateChange);
}

interface WatchedSession {
  controller: AbortController;
  context: ClaudeSessionContext;
}

/**
 * Follows Claude Code sessions and republishes their events as Synapse state
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
    private readonly publishWork: SessionWorkPublisher = publishSessionWork,
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
        // What the agent said last in the current turn. Kept for replayed events too, since a
        // reconnect replays the session from its first event.
        let finalMessage = '';

        for await (const event of this.streamEvents(sessionId, signal)) {
          consecutiveFailures = 0;
          if (event.type === 'session.status_running') {
            finalMessage = '';
          } else if (event.type === 'agent.message') {
            finalMessage = event.text;
          }

          await this.handleEvent(sessionId, context, event, finalMessage);
        }

        // A session's own stream runs until the watch is cancelled; one that
        // ends on its own has nothing more to say, so the watch is done.
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
    finalMessage: string,
  ): Promise<void> {
    if (this.seenEventIds.has(event.id)) {
      return;
    }

    this.seenEventIds.add(event.id);

    await this.forward(sessionId, event.id, toStateChange(event, sessionId, context));

    // A turn that finished its work is published once, when its end is first seen. The next event
    // waits for it, so a session is never published twice at once.
    if (event.type === 'session.status_idle' && event.stopReason === 'end_turn' && context.publishTo) {
      const publication = await this.publishWork(sessionId, context.publishTo, finalMessage).catch(
        (error: unknown): SessionWorkPublication => ({
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      if (publication) {
        await this.forward(sessionId, event.id, toPublicationStateChange(publication, sessionId, event.id, context));
      }
    }
  }

  private async forward(sessionId: string, eventId: string, stateChange: StateChange): Promise<void> {
    try {
      await this.publish(stateChange);
    } catch (error) {
      // A failed hand-off must not tear down the watch: the next event still
      // deserves a chance to reach Synapse.
      logger.error('[CLAUDE SESSION] Failed to register state change', { sessionId, eventId, error });
    }
  }
}

/** Watcher every coding session is registered with. */
export const claudeSessionWatcher = new ClaudeSessionWatcher();
