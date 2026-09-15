import type { Agent } from '@mastra/core/agent';
import { logger } from '../../utils/logger.js';
import { getRoutingSupervisorAgent, ROUTING_SUPERVISOR_AGENT_ID } from './agents.js';

/**
 * The routing runtime: the supervisor, run directly, one buffer per caller.
 *
 * This drove the supervisor through an `AgentController` Session until an integration test
 * settled that the two do not compose. The same weather question answers in five seconds
 * when the supervisor is asked directly, and fails every time through the controller.
 *
 * The mechanism is that the controller never calls `agent.stream()` -- it drives the agent
 * through `sendSignal` and `queueMessage` -- while every branch of Mastra's delegation tool
 * that actually runs a subagent is gated on `methodType` being one of `generate`,
 * `generateLegacy`, `stream` or `streamLegacy`. A signal-driven turn takes none of them, so
 * the subagent is never run: no span, no error from the agent, and eight rounds of
 * instrumentation on the subagent that never fired once.
 *
 * So the supervisor is run directly and its chunk stream is read here. Everything the
 * controller was adopted for has a smaller local equivalent: request identity is the buffer
 * map below, superseding is an `AbortController`, and the chunks report delegations better
 * than the session events did -- `tool-error` carries the error itself, where the session
 * had already flattened it to a message by the time a poll could read it.
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

/**
 * What Mastra prefixes a subagent's delegation tool with.
 *
 * The tool is registered as `agent-${key}` for each key in the `agents` map, not as the key
 * itself. Reading a tool name as an agent id without taking the prefix off gets
 * `agent-weather` where it means `weather`.
 */
const DELEGATION_TOOL_PREFIX = 'agent-';

/** The agent a delegation tool delegates to. */
export function agentIdFromDelegationTool(toolName: string): string {
  return toolName.startsWith(DELEGATION_TOOL_PREFIX) ? toolName.slice(DELEGATION_TOOL_PREFIX.length) : toolName;
}

/**
 * What a routing request can report, folded from the supervisor's chunk stream.
 *
 * Its own union rather than Mastra's chunk type, because only these five things change what
 * a poll may say and the chunk union is wide. Naming them here is also what lets the poll
 * loop be tested without a model: the spec feeds these directly.
 */
export type RoutingEvent =
  /** A delegation was asked for. */
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  /** A delegation answered, or failed with `isError`. */
  | { type: 'tool_end'; toolCallId: string; result: unknown; isError: boolean }
  /** A fragment of the supervisor's own closing words. */
  | { type: 'text'; text: string }
  /** The run failed outright. */
  | { type: 'error'; message: string }
  /** The supervisor's turn ended. */
  | { type: 'finished' };

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
 * Everything a poll can report is folded in here as the session emits it: which delegations
 * are open, what the answered ones said, the supervisor's own closing text, and whether its
 * turn has ended.
 */
export class RoutingProgress {
  /**
   * Delegations that have started and not yet answered, by tool call id.
   *
   * This is the whole of what "in progress" means. An earlier design read it from the
   * background task manager instead, and a live run settled it: the supervisor announced
   * three delegations and the manager held no rows for any of them. Delegations run in the
   * supervisor's own turn, in the foreground, so the session's event stream is the only
   * place they are visible.
   *
   * A delegation opens with `tool_start` and normally closes with `tool_end`, but nothing
   * guarantees the second arrives -- a call parked on an approval never produces one. So
   * the end of the turn closes out whatever is left rather than this map being trusted to
   * drain on its own.
   */
  readonly inFlightByToolCallId = new Map<string, string>();
  /** Outcomes not yet handed to the caller. */
  pending: DelegationOutcome[] = [];
  /** Every outcome this request produced, for the closing recap. */
  all: DelegationOutcome[] = [];
  /** The supervisor's own closing text, once the run has produced it. */
  summary?: string;
  /** Whether the supervisor's loop has ended. */
  agentFinished = false;
  error?: string;

  /** Polls parked waiting for the next delegation to land. */
  private waiters: (() => void)[] = [];

  /** Clears everything, for a new request on an existing session. */
  reset(): void {
    this.inFlightByToolCallId.clear();
    this.pending = [];
    this.all = [];
    this.summary = undefined;
    this.error = undefined;
    this.agentFinished = false;
  }

  /** Wakes every poll parked on this request. */
  wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  /** Resolves when there is something new to say, or the request has ended. */
  wait(): Promise<void> {
    if (this.pending.length > 0 || this.error || this.isFinished()) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Whether the request is done.
   *
   * The supervisor's turn ending is the whole of it, because delegations run inside that
   * turn: anything still open when it ends has no later event coming. An earlier version
   * also waited for the in-flight map to empty, which is where a stuck delegation turned
   * into a poll loop that never terminated. Ending the turn now empties that map itself,
   * reporting whatever was open as unanswered rather than waiting on it.
   */
  isFinished(): boolean {
    return this.agentFinished;
  }

  /** Whether this session has never been asked to route anything. */
  isIdle(): boolean {
    return !this.agentFinished && this.all.length === 0 && this.inFlightByToolCallId.size === 0;
  }

  /** Folds one event from the supervisor's run into the buffer. */
  handle(event: RoutingEvent): void {
    if (event.type === 'tool_start') {
      const agentId = agentIdFromDelegationTool(event.toolName);
      this.inFlightByToolCallId.set(event.toolCallId, agentId);
      logger.info('Routing delegated', { agentId, toolCallId: event.toolCallId });
      return;
    }

    if (event.type === 'tool_end') {
      const agentId = this.inFlightByToolCallId.get(event.toolCallId) ?? 'an agent';
      this.inFlightByToolCallId.delete(event.toolCallId);

      const answer = formatDelegationResult(event.result);

      // An empty answer is not one. A subagent that stops on a tool-calls step returns no
      // text at all, which reaches the caller as a delegation that succeeded and said
      // nothing -- and Jarvis, told to summarize it, has nothing to summarize and no reason
      // to mention that anything went wrong. Mastra documents this shape well enough to
      // offer `resultText` on the delegation hook for correcting it, which is not reachable
      // from here, so it is named here instead.
      const answeredWithNothing = !event.isError && answer.length === 0;
      const outcome: DelegationOutcome = {
        agentId,
        result: answeredWithNothing ? 'finished without answering' : answer,
        failed: event.isError || answeredWithNothing,
      };
      if (outcome.failed) {
        logger.error('Delegation did not complete', { agentId, result: outcome.result });
      }

      this.pending.push(outcome);
      this.all.push(outcome);
      this.wake();
      return;
    }

    if (event.type === 'text') {
      // The supervisor's closing words arrive a fragment at a time, so they accumulate
      // rather than replace: keeping only the last chunk would report its last few letters.
      this.summary = (this.summary ?? '') + event.text;
      return;
    }

    if (event.type === 'error') {
      this.fail(event.message);
      return;
    }

    if (event.type === 'finished') {
      logger.info('Routing supervisor finished its turn', {
        delegations: this.all.length,
        unanswered: this.inFlightByToolCallId.size,
      });
      this.abandonOpenDelegations('did not report a result before the supervisor finished');
      this.agentFinished = true;
      this.wake();
    }
  }

  /**
   * Closes out delegations that will never answer, so the caller hears about them.
   *
   * Dropping them silently would lose the fact that an agent was asked at all, and keeping
   * them open would leave the request unfinishable.
   */
  private abandonOpenDelegations(reason: string): void {
    for (const agentId of this.inFlightByToolCallId.values()) {
      logger.warn('Delegation never answered', { agentId, reason });
      const outcome: DelegationOutcome = { agentId, result: reason, failed: true };
      this.pending.push(outcome);
      this.all.push(outcome);
    }
    this.inFlightByToolCallId.clear();
  }

  /** Marks the request as failed, for an error the session never got to report. */
  fail(message: string): void {
    logger.error('Routing request failed', { error: message });
    this.error = message;
    this.abandonOpenDelegations('was still running when the request failed');
    this.agentFinished = true;
    this.wake();
  }
}

/**
 * Renders whatever a delegation returned as text.
 *
 * A subagent result is usually `{ text }`, but a tool that returned something else has to
 * read as *something* rather than as `[object Object]`.
 */
export function formatDelegationResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result && typeof result === 'object' && 'text' in result && typeof result.text === 'string') {
    return result.text;
  }
  return JSON.stringify(result ?? null);
}

/** What one poll can see of a request. */
export interface RoutingSnapshot {
  /** Delegations that have answered since the last poll. */
  landed: DelegationOutcome[];
  /** Everything this request produced, for the closing recap. */
  all: DelegationOutcome[];
  /** The agents still working, by name. */
  inProgress: string[];
  /** Whether the supervisor is done *and* nothing is still running. */
  finished: boolean;
  summary?: string;
  error?: string;
}

/**
 * Folds the buffer into what a single poll is allowed to say.
 *
 * Taking a snapshot hands its `landed` outcomes over, so one must not be taken and
 * discarded -- those results would never be reported again.
 */
export function buildSnapshot(progress: RoutingProgress): RoutingSnapshot {
  const landed = progress.pending;
  progress.pending = [];

  return {
    landed,
    all: progress.all,
    inProgress: [...new Set(progress.inFlightByToolCallId.values())],
    finished: progress.isFinished(),
    summary: progress.summary,
    error: progress.error,
  };
}

/**
 * How the workflows reach a routing request.
 *
 * An interface rather than a direct call so the poll loop can be tested without a model or
 * a task manager: the reporting, deadlines and hand-over rules are this vertical's logic
 * and worth covering, while driving a real supervisor is not something a unit test can do.
 */
export interface RoutingRuntime {
  /** Starts a request, replacing anything the session was already doing. */
  start(sessionId: string, userQuery: string): Promise<void>;
  /** What the caller has not been told yet, and what is still outstanding. */
  poll(sessionId: string): Promise<RoutingSnapshot>;
  /** Resolves when the request next changes, or after `deadlineMs`. */
  waitForChange(sessionId: string, deadlineMs: number): Promise<void>;
}

/** Just enough of the Mastra instance to reach the registered supervisor. */
interface RoutingMastra {
  getAgentById(id: string): Agent;
}

let registry: RoutingMastra | undefined;
const progressBySessionId = new Map<string, RoutingProgress>();
const abortBySessionId = new Map<string, AbortController>();

/**
 * Remembers the Mastra instance the routing workflows are running under.
 *
 * The supervisor that is *registered* on that instance is the one to drive, not a second
 * copy: `getRoutingSupervisorAgent()` builds a fresh agent per call, so calling it here
 * produced an agent the instance had never seen, whose `mastra` handle was undefined.
 *
 * It arrives through the workflow steps because importing the instance directly would close
 * an import cycle -- the instance imports these workflows in order to register them.
 */
export function rememberMastraRegistry(mastra: RoutingMastra | undefined): void {
  if (!mastra) {
    logger.warn('Routing workflow step ran without a Mastra instance');
    return;
  }

  if (!registry) {
    logger.info('Routing resolved its Mastra instance', {});
  }
  registry = mastra;
}

/**
 * The supervisor to run.
 *
 * Falls back to building one only when there is no instance to ask, which in practice means
 * a caller that never went through the workflows. It is warned about rather than done
 * silently, because a supervisor off the registry is the one whose delegations work.
 */
async function resolveSupervisorAgent(): Promise<Agent> {
  try {
    const registered = registry?.getAgentById(ROUTING_SUPERVISOR_AGENT_ID);
    if (registered) {
      return registered;
    }
  } catch (error) {
    logger.warn('Could not resolve the registered routing supervisor', {
      agentId: ROUTING_SUPERVISOR_AGENT_ID,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.warn('Routing supervisor is not registered on the Mastra instance; building an unregistered one', {
    agentId: ROUTING_SUPERVISOR_AGENT_ID,
  });
  return getRoutingSupervisorAgent();
}

/** The buffer a caller's request accumulates into. Get-or-create, so callers stay isolated. */
function progressFor(sessionId: string): RoutingProgress {
  const existing = progressBySessionId.get(sessionId);
  if (existing) {
    return existing;
  }

  const progress = new RoutingProgress();
  progressBySessionId.set(sessionId, progress);
  return progress;
}

/** One chunk off the supervisor's stream, as far as routing needs to read it. */
function asRoutingEvent(chunk: unknown): RoutingEvent | undefined {
  if (typeof chunk !== 'object' || chunk === null || !('type' in chunk) || !('payload' in chunk)) {
    return undefined;
  }

  const { type, payload } = chunk;
  if (typeof type !== 'string' || typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const field = (name: string): unknown => (name in payload ? Reflect.get(payload, name) : undefined);
  const toolCallId = field('toolCallId');

  if (type === 'tool-call' && typeof toolCallId === 'string') {
    const toolName = field('toolName');
    return { type: 'tool_start', toolCallId, toolName: typeof toolName === 'string' ? toolName : '' };
  }

  if (type === 'tool-result' && typeof toolCallId === 'string') {
    return { type: 'tool_end', toolCallId, result: field('result'), isError: field('isError') === true };
  }

  // The reason a delegation failed, still an error rather than the message Mastra flattens
  // it to downstream. This is the chunk the old session events could not carry.
  if (type === 'tool-error' && typeof toolCallId === 'string') {
    return { type: 'tool_end', toolCallId, result: field('error'), isError: true };
  }

  if (type === 'text-delta') {
    const text = field('text');
    return typeof text === 'string' ? { type: 'text', text } : undefined;
  }

  return undefined;
}

/**
 * Reads the supervisor's run into the caller's buffer, to the end.
 *
 * The stream ending is the turn ending, whether it ended by finishing or by being aborted
 * for a newer request, so `finished` is reported from the same place either way.
 */
async function consumeRun(
  sessionId: string,
  progress: RoutingProgress,
  chunks: { getReader(): { read(): Promise<{ done: boolean; value?: unknown }>; releaseLock(): void } },
): Promise<void> {
  const reader = chunks.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const event = asRoutingEvent(value);
      if (event) {
        progress.handle(event);
      }
    }
  } catch (error) {
    progress.fail(error instanceof Error ? error.message : String(error));
    return;
  } finally {
    reader.releaseLock();
  }

  progress.handle({ type: 'finished' });
  logger.info('Routing supervisor run settled', { sessionId, delegations: progress.all.length });
}

const supervisorRuntime: RoutingRuntime = {
  async start(sessionId, userQuery) {
    const progress = progressFor(sessionId);

    // A new request supersedes the one before it, which is what the caller means: the voice
    // assistant has moved on. Aborting is what makes that true rather than leaving the
    // previous run delegating behind it.
    const running = abortBySessionId.get(sessionId);
    if (running && !progress.agentFinished && !progress.isIdle()) {
      logger.info('Superseding a routing request that was still running', { sessionId });
      running.abort();
    }

    const abort = new AbortController();
    abortBySessionId.set(sessionId, abort);
    progress.reset();

    const supervisor = await resolveSupervisorAgent();

    // Not awaited: the caller is a voice assistant on a short tool-call deadline, and the
    // whole contract is that it polls for results rather than waiting for them.
    void supervisor
      .stream(userQuery, { abortSignal: abort.signal })
      .then((result) => consumeRun(sessionId, progress, result.fullStream))
      .catch((error: unknown) => {
        progress.fail(error instanceof Error ? error.message : String(error));
      });
  },

  async poll(sessionId) {
    return buildSnapshot(progressFor(sessionId));
  },

  async waitForChange(sessionId, deadlineMs) {
    // Everything that changes what a poll would say arrives on the run's own stream, so the
    // wait is that stream against the deadline.
    await Promise.race([progressFor(sessionId).wait(), delay(deadlineMs)]);
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

let runtime: RoutingRuntime = supervisorRuntime;

export function getRoutingRuntime(): RoutingRuntime {
  return runtime;
}

/** Substitutes the routing runtime. Used by tests. */
export function setRoutingRuntime(next: RoutingRuntime): void {
  runtime = next;
}

/** Restores the real runtime and forgets every session's buffered progress. */
export function resetRoutingRuntime(): void {
  runtime = supervisorRuntime;
  progressBySessionId.clear();
  abortBySessionId.clear();
  registry = undefined;
}
