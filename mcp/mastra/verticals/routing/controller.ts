import type { Agent } from '@mastra/core/agent';
import type { AgentControllerEvent } from '@mastra/core/agent-controller';
import { AgentController } from '@mastra/core/agent-controller';
import type { BackgroundTask } from '@mastra/core/background-tasks';
import { getSqlStorageProvider } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { getRoutingSupervisorAgent, ROUTING_SUPERVISOR_AGENT_ID } from './agents.js';

/**
 * The routing runtime: one shared AgentController, one Session per caller, and one durable
 * background task per delegation.
 *
 * Two things this vertical used to own are now the framework's. The Session owns request
 * identity: the previous implementation kept the in-flight request in a module-global, so a
 * second request replaced the first and the poll tool — which takes no arguments, and so
 * cannot say which request it is asking about — could only ever be answered from whichever
 * request happened to be last. `createSession({ resourceId })` is get-or-create and
 * isolated, and it is what makes concurrent requests safe.
 *
 * The background task manager owns delegation state. A delegation is a row with a status,
 * a result and an error, scoped to the session's `resourceId` — not a promise held in this
 * process and folded into a buffer as events arrive. That is what the poll reads. It means
 * a result survives a restart between the call that started it and the call that asks for
 * it, and it is why `taskIdsInProgress` can mean something again.
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
 * itself — and the background task records it under that same name. Reading a tool name as an
 * agent id without taking the prefix off gets `agent-weather` where it means `weather`.
 */
const DELEGATION_TOOL_PREFIX = 'agent-';

/** The agent a delegation tool delegates to. */
export function agentIdFromDelegationTool(toolName: string): string {
  return toolName.startsWith(DELEGATION_TOOL_PREFIX) ? toolName.slice(DELEGATION_TOOL_PREFIX.length) : toolName;
}

/** A task that has not settled yet, and so is still worth telling the caller about. */
const ACTIVE_TASK_STATUSES = new Set<BackgroundTask['status']>(['pending', 'running', 'suspended']);

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
 * Delegation outcomes are not accumulated here — they live in the task records, and this
 * only remembers which of them have already been handed over. What is kept is the part the
 * task records cannot express: the supervisor's own closing text, and whether its loop has
 * ended.
 */
export class RoutingProgress {
  /**
   * The tool call ids this session has dispatched, which is how its delegations are found.
   *
   * Not the session's `resourceId`, which is the obvious choice and does not work: a
   * background task records the resourceId of the *run's memory scope*, and the supervisor
   * holds no memory, so the run has no scope and every row is written with `resourceId`
   * undefined. Filtering on it matched nothing, so a poll reported no delegations and no
   * progress, for ever.
   *
   * A tool call id comes off this session's own event stream, so it is session-scoped by
   * construction — the isolation no longer depends on a field the framework may not set.
   */
  readonly dispatchedToolCallIds = new Set<string>();
  /** Task ids already handed to the caller, so a result is reported exactly once. */
  readonly reportedTaskIds = new Set<string>();
  /** The supervisor's own closing text, once the run has produced it. */
  summary?: string;
  /** Whether the supervisor's loop has ended. Delegations may still be running. */
  agentFinished = false;
  error?: string;

  /** Polls parked waiting for the next delegation to land. */
  private waiters: (() => void)[] = [];

  /** Clears everything, for a new request on an existing session. */
  reset(): void {
    this.dispatchedToolCallIds.clear();
    this.reportedTaskIds.clear();
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

  /**
   * Resolves when the session next says something that changes what a poll may report.
   *
   * `agentFinished` deliberately does not short-circuit this. The supervisor's turn ending
   * does not end the request — delegations it dispatched outlive it — so returning here on
   * that alone would send the poll straight back round to find nothing new, and spin for
   * the whole deadline. An outright failure does change the answer, and it still wakes a
   * parked poll through {@link wake}.
   */
  wait(): Promise<void> {
    if (this.error) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Whether this session has never been asked to route anything. */
  isIdle(): boolean {
    return !this.agentFinished && this.dispatchedToolCallIds.size === 0 && this.reportedTaskIds.size === 0;
  }

  /** Folds one session event into the buffer. */
  handle(event: AgentControllerEvent): void {
    // Every delegation this request makes passes through here, which is what makes the
    // task rows findable afterwards.
    if (event.type === 'tool_start') {
      this.dispatchedToolCallIds.add(event.toolCallId);
      logger.info('Routing delegated', {
        agentId: agentIdFromDelegationTool(event.toolName),
        toolCallId: event.toolCallId,
      });
      return;
    }

    // `tool_end` is deliberately not a delegation outcome. A delegation dispatched as a
    // background task returns an acknowledgement the moment it is queued, so this fires
    // with that acknowledgement rather than with the agent's answer. Reporting it would
    // tell the user a question had been answered while it was still being asked.

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
      logger.info('Routing supervisor finished its turn', {
        delegations: this.dispatchedToolCallIds.size,
      });
      this.agentFinished = true;
      this.wake();
    }
  }

  /** Marks the request as failed, for an error the session never got to report. */
  fail(message: string): void {
    logger.error('Routing request failed', { error: message });
    this.error = message;
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

/**
 * Turns a settled task into something worth reading aloud.
 *
 * A failure reports the framework's own message rather than a generic one. Mastra records
 * the underlying error on the task — the reason the delegation failed, not merely that it
 * did — which is the thing an earlier implementation could not get at, because the only
 * copy it saw had already been wrapped for the model's benefit.
 */
export function describeSettledTask(task: BackgroundTask): DelegationOutcome {
  const agentId = agentIdFromDelegationTool(task.toolName);

  if (task.status === 'completed') {
    return { agentId, result: formatDelegationResult(task.result), failed: false };
  }

  const reason = task.error?.message ?? `The delegation ${task.status.replace('_', ' ')}.`;
  logger.error('Delegation did not complete', {
    agentId,
    taskId: task.id,
    status: task.status,
    error: task.error?.message,
    stack: task.error?.stack,
  });

  return { agentId, result: reason, failed: true };
}

/** What one poll can see of a request, once the task records are folded in. */
export interface RoutingSnapshot {
  /** Delegations that have settled since the last poll. */
  landed: DelegationOutcome[];
  /** Everything this request produced, for the closing recap. */
  all: DelegationOutcome[];
  /** Delegations still running, by task id. */
  inProgressTaskIds: string[];
  /** Whether the supervisor is done *and* nothing is still running. */
  finished: boolean;
  summary?: string;
  error?: string;
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

/** Just enough of the Mastra instance to reach the supervisor and the task records. */
interface RoutingMastra {
  getAgentById(id: string): Agent;
  backgroundTaskManager?: {
    listTasks(filter: { agentId?: string }): Promise<{ tasks: BackgroundTask[] }>;
  };
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
 * undefined. It is also the only route to `backgroundTaskManager`.
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
    logger.info('Routing resolved its Mastra instance', {
      backgroundTasksEnabled: Boolean(mastra.backgroundTaskManager),
    });
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
  const existing = progressBySessionId.get(sessionId);

  if (existing) {
    return { session, progress: existing };
  }

  const progress = new RoutingProgress();
  progressBySessionId.set(sessionId, progress);
  session.subscribe((event) => progress.handle(event));

  return { session, progress };
}

/** Every delegation this session has dispatched, settled or not. */
async function listSessionTasks(sessionId: string, progress: RoutingProgress): Promise<BackgroundTask[]> {
  const manager = registry?.backgroundTaskManager;
  if (!manager) {
    logger.warn('Background tasks are not enabled; no delegation can be reported', { sessionId });
    return [];
  }

  // Every delegation in the process belongs to the one supervisor, so this narrows the read
  // to routing and nothing else. Which of them are *this* caller's is then decided by the
  // tool call ids the session announced, rather than by a field on the row.
  const { tasks } = await manager.listTasks({ agentId: ROUTING_SUPERVISOR_AGENT_ID });
  const mine = tasks.filter((task) => progress.dispatchedToolCallIds.has(task.toolCallId));

  // The case every dead poll looks like from the outside: the supervisor is running and
  // nothing can be seen of it. Saying which half is missing -- no delegation announced, or
  // announced but no row to match -- is the difference between diagnosing it and guessing.
  if (mine.length === 0 && !progress.agentFinished) {
    logger.info('Routing poll found no delegations for this request', {
      sessionId,
      announced: progress.dispatchedToolCallIds.size,
      supervisorTasksInStore: tasks.length,
    });
  }

  return mine;
}

/** Folds the task records into what a single poll is allowed to say. */
export function buildSnapshot(progress: RoutingProgress, tasks: BackgroundTask[]): RoutingSnapshot {
  const settled = tasks.filter((task) => !ACTIVE_TASK_STATUSES.has(task.status));
  const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));

  const landed = settled.filter((task) => !progress.reportedTaskIds.has(task.id)).map(describeSettledTask);
  for (const task of settled) {
    progress.reportedTaskIds.add(task.id);
  }

  return {
    landed,
    all: settled.map(describeSettledTask),
    inProgressTaskIds: active.map((task) => task.id),
    // The supervisor's loop ending is not the request ending: it dispatches delegations that
    // outlive its own turn, which is the whole point of dispatching them in the background.
    finished: progress.agentFinished && active.length === 0,
    summary: progress.summary,
    error: progress.error,
  };
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

    // Resetting drops the tool call ids of the request being superseded, and a delegation is
    // only ever this request's if its id is in that set — so the previous request's rows stop
    // matching here rather than having to be swept up and marked reported.
    progress.reset();

    // Not awaited: the caller is a voice assistant on a short tool-call deadline, and the
    // whole contract is that it polls for results rather than waiting for them.
    void session
      .sendMessage({ content: userQuery })
      .then(() => {
        logger.info('Routing supervisor run settled', {
          sessionId,
          delegations: progress.dispatchedToolCallIds.size,
        });
      })
      .catch((error: unknown) => {
        progress.fail(error instanceof Error ? error.message : String(error));
      });
  },

  async poll(sessionId) {
    const { progress } = await getSession(sessionId);
    return buildSnapshot(progress, await listSessionTasks(sessionId, progress));
  },

  async waitForChange(sessionId, deadlineMs) {
    const { progress } = await getSession(sessionId);

    // Two things can change what a poll would say, and only one of them is an event. The
    // session announces its own ending; a delegation settling is a row changing in storage,
    // which nothing here is notified about. So the wait races the session against a re-read,
    // rather than trusting either alone.
    // `pollForSettledTask` already gives up at the deadline, so it bounds the race.
    await Promise.race([progress.wait(), pollForSettledTask(sessionId, progress, deadlineMs)]);
  },
};

/** How often a blocked poll re-reads the task records while it waits. */
const TASK_REREAD_INTERVAL_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Resolves once a delegation the caller has not heard about has settled. */
async function pollForSettledTask(sessionId: string, progress: RoutingProgress, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;

  while (Date.now() < until) {
    await delay(Math.min(TASK_REREAD_INTERVAL_MS, until - Date.now()));

    const tasks = await listSessionTasks(sessionId, progress);
    const hasNews = tasks.some(
      (task) => !ACTIVE_TASK_STATUSES.has(task.status) && !progress.reportedTaskIds.has(task.id),
    );
    if (hasNews) {
      return;
    }
  }
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
