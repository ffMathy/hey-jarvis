import type { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { logger } from '../../utils/logger.js';
import { buildRoutingPlan, type PlannedChain, type RoutingPlan } from './plan.js';
import { sweepOldRoutingPlans } from './plan-retention.js';
import { getRoutingPlannerAgent, PLANNER_AGENT_ID, planDelegations } from './planner.js';

/**
 * The routing runtime: plan a request, register the plan as a workflow, run it, report it.
 *
 * Routing has been three things. A task DAG with a wave scheduler this vertical owned; then
 * a supervisor agent delegating inside one tool-call loop; now a workflow Mastra builds per
 * request. The middle one is why: its loop was opaque, so a run could not be looked at, and
 * a request that went wrong could only be read back from logs.
 *
 * A plan is a workflow, so Studio draws it -- the root, its chains, every agent step, what
 * each was asked and what it answered. The run is also persisted, which the delegation loop
 * never was. What this file still owns is the part Jarvis talks to: one buffer per caller,
 * folded from the run's own event stream, reported exactly once.
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
 * What a routing request can report, folded from the plan run's event stream.
 *
 * Its own union rather than Mastra's chunk type, because only these four things change what
 * a poll may say and the chunk union is wide. Naming them here is also what lets the poll
 * loop be tested without a model: the spec feeds these directly.
 */
export type RoutingEvent =
  /** A delegation the plan contains. Every one is announced when the plan is built. */
  | { type: 'delegation_start'; delegationId: string; agentId: string }
  /** A delegation finished, or failed with `isError`. */
  | { type: 'delegation_end'; delegationId: string; result: unknown; isError: boolean }
  /** The request failed outright. */
  | { type: 'error'; message: string }
  /** The plan run ended. */
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
 * Everything a poll can report is folded in here as the run emits it: which delegations are
 * outstanding, what the finished ones said, and whether the run has ended.
 */
export class RoutingProgress {
  /**
   * Delegations that have not yet answered, by step id.
   *
   * Every delegation in the plan is entered here the moment the plan is built, before
   * anything runs. That is what makes "in progress" answerable on the first poll: the plan
   * is written down in advance, so the work outstanding is known rather than inferred from
   * whatever has happened to start. The supervisor this replaced could not say that -- a
   * delegation existed only once it had been called.
   */
  readonly outstandingByDelegationId = new Map<string, string>();
  /** Outcomes not yet handed to the caller. */
  pending: DelegationOutcome[] = [];
  /** Every outcome this request produced, for the closing recap. */
  all: DelegationOutcome[] = [];
  /** Whether the plan run has ended. */
  runFinished = false;
  error?: string;

  /** Polls parked waiting for the next delegation to land. */
  private waiters: (() => void)[] = [];

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
   * The run ending is the whole of it. Anything still outstanding when it ends has no later
   * event coming, so the end of the run closes those out rather than this map being trusted
   * to drain on its own -- waiting on it is what once left a live request polling
   * "Still processing" until the caller gave up.
   */
  isFinished(): boolean {
    return this.runFinished;
  }

  /** Whether this session has never been asked to route anything. */
  isIdle(): boolean {
    return !this.runFinished && this.all.length === 0 && this.outstandingByDelegationId.size === 0;
  }

  /** Folds one event from the plan run into the buffer. */
  handle(event: RoutingEvent): void {
    if (event.type === 'delegation_start') {
      this.outstandingByDelegationId.set(event.delegationId, event.agentId);
      return;
    }

    if (event.type === 'delegation_end') {
      const agentId = this.outstandingByDelegationId.get(event.delegationId);
      if (!agentId) {
        // Already reported. A chain reports its own result as well as its steps', so the
        // same answer can arrive twice; relaying it twice would have Jarvis say it twice.
        return;
      }
      this.outstandingByDelegationId.delete(event.delegationId);

      const answer = formatDelegationResult(event.result);

      // An empty answer is not one. An agent that stops on a tool-calls step returns no text
      // at all, which reaches the caller as a delegation that succeeded and said nothing --
      // and Jarvis, told to summarize it, has nothing to summarize and no reason to mention
      // that anything went wrong.
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

    if (event.type === 'error') {
      this.fail(event.message);
      return;
    }

    if (event.type === 'finished') {
      logger.info('Routing plan run settled', {
        delegations: this.all.length,
        unanswered: this.outstandingByDelegationId.size,
      });
      this.abandonOutstandingDelegations('did not report a result before the plan finished');
      this.runFinished = true;
      this.wake();
    }
  }

  /**
   * Closes out delegations that will never answer, so the caller hears about them.
   *
   * Dropping them silently would lose the fact that an agent was asked at all, and keeping
   * them open would leave the request unfinishable.
   */
  private abandonOutstandingDelegations(reason: string): void {
    for (const agentId of this.outstandingByDelegationId.values()) {
      logger.warn('Delegation never answered', { agentId, reason });
      const outcome: DelegationOutcome = { agentId, result: reason, failed: true };
      this.pending.push(outcome);
      this.all.push(outcome);
    }
    this.outstandingByDelegationId.clear();
  }

  /** Marks the request as failed, for an error the run never got to report. */
  fail(message: string): void {
    logger.error('Routing request failed', { error: message });
    this.error = message;
    this.abandonOutstandingDelegations('was still running when the request failed');
    this.runFinished = true;
    this.wake();
  }
}

/**
 * Renders whatever a delegation returned as text.
 *
 * An agent step's result is `{ text }`, but a step that failed or returned something else
 * has to read as *something* rather than as `[object Object]`.
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
  /** Whether the plan run is done. */
  finished: boolean;
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
    inProgress: [...new Set(progress.outstandingByDelegationId.values())],
    finished: progress.isFinished(),
    error: progress.error,
  };
}

/**
 * How the workflows reach a routing request.
 *
 * An interface rather than a direct call so the poll loop can be tested without a model or a
 * workflow run: the reporting, deadlines and hand-over rules are this vertical's logic and
 * worth covering, while planning and running a real request is not something a unit test can
 * do.
 */
export interface RoutingRuntime {
  /** Starts a request, replacing anything the session was already doing. */
  start(sessionId: string, userQuery: string): Promise<void>;
  /** What the caller has not been told yet, and what is still outstanding. */
  poll(sessionId: string): Promise<RoutingSnapshot>;
  /** Resolves when the request next changes, or after `deadlineMs`. */
  waitForChange(sessionId: string, deadlineMs: number): Promise<void>;
}

let registry: Mastra | undefined;
const progressBySessionId = new Map<string, RoutingProgress>();
const cancelBySessionId = new Map<string, () => Promise<void>>();

/**
 * Remembers the Mastra instance the routing workflows are running under.
 *
 * A plan is registered on that instance and run from it, and the agents its steps name are
 * the ones registered there. It arrives through the workflow steps because importing the
 * instance directly would close an import cycle -- the instance imports these workflows in
 * order to register them.
 */
export function rememberMastraRegistry(mastra: Mastra | undefined): void {
  if (!mastra) {
    logger.warn('Routing workflow step ran without a Mastra instance');
    return;
  }

  if (!registry) {
    logger.info('Routing resolved its Mastra instance', {});
  }
  registry = mastra;
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

/** Just the shape of a workflow run event this vertical reads. */
interface WorkflowChunk {
  type: string;
  payload: Record<string, unknown>;
}

function asWorkflowChunk(chunk: unknown): WorkflowChunk | undefined {
  if (typeof chunk !== 'object' || chunk === null || !('type' in chunk) || !('payload' in chunk)) {
    return undefined;
  }
  const { type, payload } = chunk;
  if (typeof type !== 'string' || typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  return { type, payload: payload as Record<string, unknown> };
}

/**
 * One chunk off the plan run's stream, as far as routing needs to read it.
 *
 * Only step results matter. A step result closes the delegation that step is; starts are not
 * read from the stream at all, because the plan already said what it would delegate and
 * every delegation is outstanding from the moment it is written down rather than from the
 * moment it happens to run.
 *
 * `workflow-finish` is deliberately *not* read. A chain is a nested workflow sharing the
 * root's pubsub, so its own finish event reaches this stream too -- and taking the first one
 * for the request's would close the request the moment the fastest chain was done, reporting
 * every other chain as having never answered. The end of the request is the end of the
 * stream, which is a thing only the root run has.
 *
 * A chain's own result arrives alongside its steps', carrying the last step's answer. It is
 * folded in under the same rule -- the first event to close a delegation reports it, the
 * rest are dropped -- which makes the reporting correct whether or not a nested run's events
 * reach this stream.
 */
export function asRoutingEvent(chunk: unknown, plan: RoutingPlan): RoutingEvent | undefined {
  const parsed = asWorkflowChunk(chunk);
  if (parsed?.type !== 'workflow-step-result') {
    return undefined;
  }

  const stepId = parsed.payload.id;
  if (typeof stepId !== 'string') {
    return undefined;
  }

  const delegationId = plan.agentByStepId.has(stepId) ? stepId : lastDelegationOfChain(plan, stepId);
  if (!delegationId) {
    return undefined;
  }

  return {
    type: 'delegation_end',
    delegationId,
    result: parsed.payload.output,
    isError: parsed.payload.status !== 'success',
  };
}

/**
 * The delegation a chain's own result belongs to, if the step id names a chain.
 *
 * A chain's output is its last agent step's `{ text }`, so that is the one it can answer for.
 * Earlier steps in the chain are closed by their own results when those reach this stream,
 * and by the end of the run when they do not.
 */
function lastDelegationOfChain(plan: RoutingPlan, stepId: string): string | undefined {
  const stepIds = plan.delegationIdsByChainStepId.get(stepId);
  return stepIds?.[stepIds.length - 1];
}

/**
 * Reads the plan run into the caller's buffer, to the end.
 *
 * The stream ending is the run ending, whether it ended by finishing or by being cancelled
 * for a newer request, so `finished` is reported from the same place either way.
 */
async function consumeRun(
  sessionId: string,
  progress: RoutingProgress,
  plan: RoutingPlan,
  chunks: { getReader(): { read(): Promise<{ done: boolean; value?: unknown }>; releaseLock(): void } },
): Promise<void> {
  const reader = chunks.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const event = asRoutingEvent(value, plan);
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
  logger.info('Routing plan run settled', { sessionId, planId: plan.id, delegations: progress.all.length });
}

/**
 * The planner to ask.
 *
 * The one *registered* on the instance, not a second copy: `getRoutingPlannerAgent()` builds
 * a fresh agent per call -- and a fresh catalogue of ten agents with it -- so calling it per
 * request would put that cost on the latency-critical path. Building one is the fallback for
 * a caller that never went through the registered workflows, and it is warned about.
 */
async function resolvePlannerAgent(mastra: Mastra): Promise<Agent> {
  try {
    const registered = mastra.getAgentById(PLANNER_AGENT_ID);
    if (registered) {
      return registered;
    }
  } catch (error) {
    logger.warn('Could not resolve the registered routing planner', {
      agentId: PLANNER_AGENT_ID,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.warn('Routing planner is not registered on the Mastra instance; building an unregistered one', {
    agentId: PLANNER_AGENT_ID,
  });
  return getRoutingPlannerAgent();
}

/** A plan id that sorts by when it was made, which is how the sweep decides what to keep. */
function newPlanId(): string {
  return `routing-plan-${Date.now()}`;
}

/**
 * Plans a request, registers the plan, and runs it.
 *
 * Registering before running is what puts the plan in Studio whether or not the run goes
 * well: a request that fails half way is exactly the one worth looking at.
 */
async function runPlan(mastra: Mastra, sessionId: string, progress: RoutingProgress, userQuery: string): Promise<void> {
  const chains: PlannedChain[] = await planDelegations(await resolvePlannerAgent(mastra), userQuery);

  if (chains.length === 0) {
    progress.fail('none of the specialized agents can handle this request');
    return;
  }

  const plan = buildRoutingPlan(newPlanId(), chains);
  await mastra.addDynamicWorkflows(plan.graphs);
  logger.info('Registered a routing plan', { planId: plan.id, delegations: plan.delegationCount });

  // Every delegation is outstanding from here, before a single step has run, so the first
  // poll can already name the whole of the work.
  for (const [delegationId, agentId] of plan.agentByStepId) {
    progress.handle({ type: 'delegation_start', delegationId, agentId });
  }

  const run = await mastra.getWorkflowById(plan.id).createRun();
  cancelBySessionId.set(sessionId, () => run.cancel());

  const output = run.stream({ inputData: { prompt: userQuery } });
  const consumed = consumeRun(sessionId, progress, plan, output.fullStream);

  // Sweeping after the run is under way, not before it: the sweep reads and writes storage,
  // and the caller is a voice assistant that has already been told to start polling.
  await sweepOldRoutingPlans(mastra);
  await consumed;
}

const planRuntime: RoutingRuntime = {
  async start(sessionId, userQuery) {
    const previous = progressFor(sessionId);

    // A new request supersedes the one before it, which is what the caller means: the voice
    // assistant has moved on. Cancelling is what makes that true rather than leaving the
    // previous plan running behind it.
    const cancel = cancelBySessionId.get(sessionId);
    if (cancel && !previous.runFinished && !previous.isIdle()) {
      logger.info('Superseding a routing request that was still running', { sessionId });
      void cancel().catch((error: unknown) => {
        logger.warn('Could not cancel the superseded routing run', { sessionId, error });
      });
    }
    cancelBySessionId.delete(sessionId);

    // A fresh buffer rather than a cleared one. Cancelling a run does not stop it
    // instantly, and its reader holds whatever buffer it was started with -- so clearing in
    // place would let the old run's last few events land in the new request's report.
    const progress = new RoutingProgress();
    progressBySessionId.set(sessionId, progress);

    const mastra = registry;
    if (!mastra) {
      progress.fail('routing has no Mastra instance to plan against');
      return;
    }

    // Not awaited: the caller is a voice assistant on a short tool-call deadline, and the
    // whole contract is that it polls for results rather than waiting for them.
    void runPlan(mastra, sessionId, progress, userQuery).catch((error: unknown) => {
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

let runtime: RoutingRuntime = planRuntime;

export function getRoutingRuntime(): RoutingRuntime {
  return runtime;
}

/** Substitutes the routing runtime. Used by tests. */
export function setRoutingRuntime(next: RoutingRuntime): void {
  runtime = next;
}

/** Restores the real runtime and forgets every session's buffered progress. */
export function resetRoutingRuntime(): void {
  runtime = planRuntime;
  progressBySessionId.clear();
  cancelBySessionId.clear();
  registry = undefined;
}
