import type { Agent } from '@mastra/core/agent';
import type { AgentControllerEvent, ToolCategory } from '@mastra/core/agent-controller';
import { AgentController } from '@mastra/core/agent-controller';
import { getSqlStorageProvider } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { getRoutingSupervisorAgent, ROUTING_SUPERVISOR_AGENT_ID } from './agents.js';

/**
 * The routing runtime: one shared AgentController, one Session per caller.
 *
 * The Session owns request identity. The implementation this replaced kept the in-flight
 * request in a module-global, so a second request replaced the first and the poll tool —
 * which takes no arguments, and so cannot say which request it is asking about — could only
 * ever be answered from whichever request happened to be last. `createSession({ resourceId })`
 * is get-or-create and isolated, and it is what makes concurrent requests safe.
 *
 * The Session also owns what the poll reports. Delegations run inside the supervisor's own
 * turn, so the session's event stream is where they surface: `tool_start` opens one and
 * `tool_end` carries its answer. Durable background tasks were tried for this and did not
 * work — a live run announced three delegations and the task manager held no rows for any of
 * them — so nothing about a request lives in storage, and nothing has to be read back from
 * there.
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
 * The one permission category every tool on this path belongs to, so that it can be granted.
 *
 * The controller runs the supervisor with `requireToolApproval` on -- there is no way to turn
 * that off from the public API -- and resolves each call through a chain that ends in
 * `ask`: an explicit per-tool policy, session-wide yolo, a session grant, then the tool's
 * category. A tool that matches nothing falls off the end of that chain and parks.
 *
 * Removing the approval gate removed the category resolver with it, which left every
 * delegation matching nothing: `getToolCategory` answers `null` without one, so the category
 * branch is skipped entirely and every call resolves to `ask`. A live run showed exactly
 * that -- three delegations opened and none of them ever answered -- because `ask` on this
 * path means parked forever. Nothing can approve: the voice model has two tools and neither
 * is an approval.
 *
 * So the tools are given a category and {@link grantRoutingPermissions} grants it. `other`
 * is what Mastra documents as an unmapped tool's category; naming it is what makes it
 * grantable. This covers the controller's own built-in tools as well as the delegations,
 * which is the point of doing it by category rather than by tool name.
 */
const ROUTING_TOOL_CATEGORY: ToolCategory = 'other';

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

  /** Folds one session event into the buffer. */
  handle(event: AgentControllerEvent): void {
    if (event.type === 'tool_start') {
      const agentId = agentIdFromDelegationTool(event.toolName);
      this.inFlightByToolCallId.set(event.toolCallId, agentId);
      logger.info('Routing delegated', { agentId, toolCallId: event.toolCallId });
      return;
    }

    if (event.type === 'tool_end') {
      const agentId = this.inFlightByToolCallId.get(event.toolCallId) ?? 'an agent';
      this.inFlightByToolCallId.delete(event.toolCallId);

      const outcome: DelegationOutcome = {
        agentId,
        result: formatDelegationResult(event.result),
        failed: event.isError,
      };
      if (event.isError) {
        logger.error('Delegation did not complete', { agentId, result: outcome.result });
      }

      this.pending.push(outcome);
      this.all.push(outcome);
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

    if (event.type === 'tool_approval_required') {
      // Unreachable while the category grant holds, and an unbounded wait if it ever stops
      // holding: the run parks until something approves, and on this path nothing can --
      // the voice model has two tools and neither is an approval. Reporting it is the
      // difference between a caller that hears why its request died and one that polls
      // until the call is dropped.
      this.fail(
        `Routing was asked to approve a call to ${agentIdFromDelegationTool(event.toolName)}, which it has no way to answer.`,
      );
      return;
    }

    if (event.type === 'error') {
      this.fail(event.error.message);
      return;
    }

    if (event.type === 'agent_end') {
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

let controller: AgentController | undefined;
let registry: RoutingMastra | undefined;
const progressBySessionId = new Map<string, RoutingProgress>();

/**
 * Remembers the Mastra instance the routing workflows are running under.
 *
 * The controller has to drive the supervisor that is *registered* on that instance, not a
 * second copy of it: `getRoutingSupervisorAgent()` builds a fresh agent per call, so calling
 * it here produced an agent the instance had never seen, whose `mastra` handle was
 * undefined.
 *
 * It arrives through the workflow steps because importing the instance directly would close
 * an import cycle — the instance imports these workflows in order to register them.
 */
export function rememberMastraRegistry(mastra: RoutingMastra | undefined): void {
  if (!mastra) {
    // The steps are the only route to the instance, so losing it here disables both the
    // registered supervisor and the task manager -- and does so quietly.
    logger.warn('Routing workflow step ran without a Mastra instance');
    return;
  }

  if (!registry) {
    logger.info('Routing resolved its Mastra instance', {});
  }
  registry = mastra;
}

/**
 * The supervisor the controller drives.
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

async function getController(): Promise<AgentController> {
  if (controller) {
    return controller;
  }

  controller = new AgentController({
    id: 'routing-controller',
    agent: await resolveSupervisorAgent(),
    storage: await getSqlStorageProvider(),
    // Without this every tool resolves to `ask` and parks. See ROUTING_TOOL_CATEGORY.
    toolCategoryResolver: () => ROUTING_TOOL_CATEGORY,
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
 * subscribing again per request would deliver each event to the buffer once per past
 * request.
 */
async function getSession(sessionId: string) {
  const session = await (await getController()).createSession({ resourceId: sessionId });

  // In-memory and idempotent, so it costs nothing to reassert and cannot be missed by a
  // session that outlived the grant. This is the half of the permission fix that makes the
  // category mean "allowed" rather than merely "named".
  session.grantCategory(ROUTING_TOOL_CATEGORY);

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
    if (!progress.agentFinished && !progress.isIdle()) {
      logger.info('Superseding a routing request that was still running', { sessionId });
      session.abort();
    }

    progress.reset();

    // Not awaited: the caller is a voice assistant on a short tool-call deadline, and the
    // whole contract is that it polls for results rather than waiting for them.
    void session
      .sendMessage({ content: userQuery })
      .then(() => {
        logger.info('Routing supervisor run settled', { sessionId, delegations: progress.all.length });
      })
      .catch((error: unknown) => {
        progress.fail(error instanceof Error ? error.message : String(error));
      });
  },

  async poll(sessionId) {
    const { progress } = await getSession(sessionId);
    return buildSnapshot(progress);
  },

  async waitForChange(sessionId, deadlineMs) {
    const { progress } = await getSession(sessionId);

    // Everything that changes what a poll would say arrives as a session event, so the wait
    // is the event stream against the deadline. Nothing has to be re-read from storage,
    // because nothing about this request lives there.
    await Promise.race([progress.wait(), delay(deadlineMs)]);
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

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
  registry = undefined;
}
