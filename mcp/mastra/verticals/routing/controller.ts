import type { AgentControllerEvent } from '@mastra/core/agent-controller';
import { AgentController } from '@mastra/core/agent-controller';
import { getSqlStorageProvider } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { getRoutingSupervisorAgent } from './agents.js';

/**
 * The routing runtime: one shared AgentController, one Session per caller.
 *
 * The point of the controller here is the Session. The previous implementation kept the
 * in-flight request in a module-global, so a second routing request replaced the first, and
 * the poll tool — which takes no arguments and so cannot say which request it is asking
 * about — could only ever be answered from whichever request happened to be last. Straggler
 * results from a superseded request had to be filtered out explicitly, because there was
 * nowhere else for them to go.
 *
 * `createSession({ resourceId })` is get-or-create and isolated: two callers get two
 * sessions with their own threads, run state and event bus, and a session never delivers
 * its events to another session's subscribers. That is what makes concurrent requests safe,
 * and it is why progress is read off the session's event stream rather than out of a
 * structure this vertical maintains.
 */

/**
 * The session every caller shares when none identifies itself.
 *
 * The MCP contract does not force a caller id — ElevenLabs can call the tools with no
 * arguments — so in practice there is one voice session at a time and this is it. The
 * isolation is still real: anything that does pass a `sessionId` gets its own session, and
 * nothing about one caller's request can reach another's.
 */
export const DEFAULT_ROUTING_SESSION_ID = 'jarvis-voice';

/** One delegation that has finished, as the poll loop reports it. */
export interface DelegationOutcome {
  /** The agent that was delegated to. */
  agentId: string;
  /** What it answered, or the failure. */
  result: string;
  failed: boolean;
}

/**
 * Everything one routing request has produced that the caller has not yet been told.
 *
 * Progress is buffered rather than read from the session on demand because the contract is
 * a poll: the caller asks "what is new", and what is new is whatever arrived since it last
 * asked. Once a delegation is handed over it leaves `pending` but stays in `all`, which is
 * what the closing recap is built from.
 */
export class RoutingProgress {
  pending: DelegationOutcome[] = [];
  all: DelegationOutcome[] = [];
  /** The supervisor's own closing text, once the run has produced it. */
  summary?: string;
  finished = false;
  error?: string;

  /** Polls parked waiting for the next delegation to land. */
  private waiters: (() => void)[] = [];

  /**
   * `tool_end` carries only the call id, so the agent's name has to be remembered from the
   * `tool_start` that opened it. Without this every finished delegation would be reported
   * under an opaque id, and the closing recap would name none of the agents.
   */
  private delegateNameByToolCallId = new Map<string, string>();

  /** Clears everything, for a new request on an existing session. */
  reset(): void {
    this.pending = [];
    this.all = [];
    this.summary = undefined;
    this.error = undefined;
    this.finished = false;
    this.delegateNameByToolCallId.clear();
  }

  /** Wakes every poll parked on this request. */
  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  /** Resolves once another delegation lands, or immediately if one is already waiting. */
  wait(): Promise<void> {
    if (this.pending.length > 0 || this.finished) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Whether this session has never been asked to route anything. */
  isIdle(): boolean {
    return !this.finished && this.all.length === 0 && this.pending.length === 0;
  }

  /** Folds one session event into the buffer. */
  handle(event: AgentControllerEvent): void {
    if (event.type === 'tool_start') {
      this.delegateNameByToolCallId.set(event.toolCallId, event.toolName);
      return;
    }

    // A delegation is a tool call, so `tool_end` is where a finished one surfaces. This is
    // what lets a fast answer reach the user without waiting for the slow one beside it:
    // the supervisor may still be mid-run, but this result is already worth relaying.
    if (event.type === 'tool_end') {
      this.pending.push({
        agentId: this.delegateNameByToolCallId.get(event.toolCallId) ?? 'an agent',
        result: formatDelegationResult(event.result),
        failed: event.isError,
      });
      this.all.push(this.pending[this.pending.length - 1]);
      this.delegateNameByToolCallId.delete(event.toolCallId);
      this.wake();
      return;
    }

    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = extractText(event.message);
      if (text) {
        this.summary = text;
      }
      return;
    }

    if (event.type === 'error') {
      this.fail(event.error.message);
      return;
    }

    if (event.type === 'agent_end') {
      this.finished = true;
      this.wake();
    }
  }

  /** Marks the request as failed, for an error the session never got to report. */
  fail(message: string): void {
    this.error = message;
    this.finished = true;
    this.wake();
  }
}

/**
 * Renders whatever a delegation tool returned as text.
 *
 * A subagent result is usually `{ text }`, but a failure or a tool that returned something
 * else has to read as *something* rather than as `[object Object]`.
 */
function formatDelegationResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result && typeof result === 'object' && 'text' in result && typeof result.text === 'string') {
    return result.text;
  }
  return JSON.stringify(result ?? null);
}

/** Pulls the plain text out of an assistant message, whatever parts it is built from. */
function extractText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!content || typeof content !== 'object' || !('parts' in content) || !Array.isArray(content.parts)) {
    return '';
  }

  return content.parts
    .filter((part): part is { type: 'text'; text: string } => {
      return (
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      );
    })
    .map((part) => part.text)
    .join('')
    .trim();
}

/**
 * How the workflows reach a routing request.
 *
 * An interface rather than a direct call so the poll loop can be tested without a model:
 * the reporting, deadlines and hand-over rules are this vertical's logic and worth
 * covering, while driving a real supervisor is not something a unit test can do.
 */
export interface RoutingRuntime {
  /** Starts a request, replacing anything the session was already doing. */
  start(sessionId: string, userQuery: string): Promise<RoutingProgress>;
  /** The buffer for a session, whether or not anything has been routed on it. */
  get(sessionId: string): Promise<RoutingProgress>;
}

let controller: AgentController | undefined;
const progressBySessionId = new Map<string, RoutingProgress>();

async function getController(): Promise<AgentController> {
  if (controller) {
    return controller;
  }

  controller = new AgentController({
    id: 'routing-controller',
    agent: await getRoutingSupervisorAgent(),
    storage: await getSqlStorageProvider(),
    // One mode. The controller's mode machinery exists for plan/build/review style
    // applications; routing has a single job and switches between nothing.
    modes: [{ id: 'route', name: 'Route', metadata: { default: true } }],
  });

  await controller.init();
  return controller;
}

/**
 * The session for a caller, and the buffer its events accumulate into.
 *
 * `createSession` is get-or-create, so the subscription is attached only the first time —
 * subscribing again per request would deliver each delegation to the buffer once per past
 * request.
 */
async function getSession(sessionId: string) {
  const session = await (await getController()).createSession({ resourceId: sessionId });
  const existing = progressBySessionId.get(sessionId);

  if (existing) {
    return { session, progress: existing };
  }

  const progress = new RoutingProgress();
  progressBySessionId.set(sessionId, progress);
  session.subscribe((event) => progress.handle(event));

  return { session, progress };
}

const agentControllerRuntime: RoutingRuntime = {
  async start(sessionId, userQuery) {
    const { session, progress } = await getSession(sessionId);

    // A new request on the same session supersedes the old one, which is what the caller
    // means: the voice assistant has moved on. Aborting is what makes that true rather than
    // leaving the previous run delegating in the background.
    if (!progress.finished && !progress.isIdle()) {
      logger.info('Superseding a routing request that was still running', { sessionId });
      session.abort();
    }

    progress.reset();

    // Not awaited: the caller is a voice assistant on a short tool-call deadline, and the
    // whole contract is that it polls for results rather than waiting for them.
    void session.sendMessage({ content: userQuery }).catch((error: unknown) => {
      progress.fail(error instanceof Error ? error.message : String(error));
    });

    return progress;
  },

  async get(sessionId) {
    return (await getSession(sessionId)).progress;
  },
};

let runtime: RoutingRuntime = agentControllerRuntime;

export function getRoutingRuntime(): RoutingRuntime {
  return runtime;
}

/** Substitutes the routing runtime. Used by tests. */
export function setRoutingRuntime(next: RoutingRuntime): void {
  runtime = next;
}

/** Restores the real runtime and forgets every session's buffered progress. */
export function resetRoutingRuntime(): void {
  runtime = agentControllerRuntime;
  progressBySessionId.clear();
  controller = undefined;
}
