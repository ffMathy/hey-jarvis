import type { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { logger } from '../../utils/logger.js';
import { buildRoutingPlan, type PlannedChain, type RoutingPlan } from './plan.js';
import { sweepOldRoutingPlans } from './plan-retention.js';
import { getRoutingPlannerAgent, PLANNER_AGENT_ID, type PlannedAnswer, planDelegations } from './planner.js';
import {
  asDelegationSuspension,
  type DelegationSuspension,
  forgetOpenQuestions,
  listOpenQuestions,
  nextQuestionId,
  type OpenQuestion,
  readSuspension,
  rememberOpenQuestions,
  takeOpenQuestion,
} from './questions.js';

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
 * Its own union rather than Mastra's chunk type, because only these few things change what
 * a poll may say and the chunk union is wide. Naming them here is also what lets the poll
 * loop be tested without a model: the spec feeds these directly.
 */
export type RoutingEvent =
  /** A delegation the plan contains. Every one is announced when the plan is built. */
  | { type: 'delegation_start'; delegationId: string; taskId: string; agentId: string }
  /** A delegation finished, or failed with `isError`. */
  | { type: 'delegation_end'; delegationId: string; result: unknown; isError: boolean }
  /** A delegation stopped to ask something only the user can answer. See ./questions.ts. */
  | { type: 'delegation_suspended'; delegationId: string; suspension: DelegationSuspension }
  /** The request failed outright. */
  | { type: 'error'; message: string }
  /** The plan run ended. */
  | { type: 'finished' };

/** One delegation that has finished, as the poll loop reports it. */
export interface DelegationOutcome {
  /** The planner's name for the work, which is what the caller is told. Unique in a plan. */
  taskId: string;
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
  readonly outstandingByDelegationId = new Map<string, { taskId: string; agentId: string }>();
  /** Outcomes not yet handed to the caller. */
  pending: DelegationOutcome[] = [];
  /** Every outcome this request produced, for the closing recap. */
  all: DelegationOutcome[] = [];
  /**
   * Questions this request's delegations stopped to ask.
   *
   * Reported with the closing recap and not before: sir's answer arrives as a new request,
   * and a new request supersedes this one, so asking while other work is still running would
   * cancel that work the moment he replied.
   */
  questions: OpenQuestion[] = [];
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
   * The request's work ending is the whole of it -- its plan run, and any answers it carried
   * back to questions. Anything still outstanding when that ends has no later event coming, so
   * the end closes those out rather than this map being trusted to drain on its own -- waiting
   * on it is what once left a live request polling "Still processing" until the caller gave up.
   */
  isFinished(): boolean {
    return this.runFinished;
  }

  /** Whether this session has never been asked to route anything. */
  isIdle(): boolean {
    return (
      !this.runFinished &&
      this.all.length === 0 &&
      this.questions.length === 0 &&
      this.outstandingByDelegationId.size === 0
    );
  }

  /** Folds one event from the plan run into the buffer. */
  handle(event: RoutingEvent): void {
    if (event.type === 'delegation_start') {
      this.outstandingByDelegationId.set(event.delegationId, { taskId: event.taskId, agentId: event.agentId });
      return;
    }

    if (event.type === 'delegation_end') {
      const delegation = this.outstandingByDelegationId.get(event.delegationId);
      if (!delegation) {
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
      this.settle({
        taskId: delegation.taskId,
        agentId: delegation.agentId,
        result: answeredWithNothing ? 'finished without answering' : answer,
        failed: event.isError || answeredWithNothing,
      });
      return;
    }

    if (event.type === 'delegation_suspended') {
      const delegation = this.outstandingByDelegationId.get(event.delegationId);
      if (!delegation) {
        return;
      }
      this.outstandingByDelegationId.delete(event.delegationId);

      const readable = readSuspension(event.suspension);
      if ('problem' in readable) {
        this.settle({ ...delegation, result: `stopped part way: ${readable.problem}`, failed: true });
        return;
      }

      const question: OpenQuestion = {
        id: nextQuestionId(),
        ...delegation,
        question: readable.question,
        answerField: readable.answerField,
        agentRunId: event.suspension.agentRunId,
        toolCallId: event.suspension.toolCallId,
      };
      logger.info('Delegation is waiting on an answer from the user', { ...delegation, questionId: question.id });
      this.questions.push(question);
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

  /** Records a delegation that has finished, one way or another, and wakes whoever is polling. */
  private settle(outcome: DelegationOutcome): void {
    if (outcome.failed) {
      logger.error('Delegation did not complete', { ...outcome });
    }

    this.pending.push(outcome);
    this.all.push(outcome);
    this.wake();
  }

  /** Whether a delegation has yet to answer or ask. */
  isOutstanding(delegationId: string): boolean {
    return this.outstandingByDelegationId.has(delegationId);
  }

  /**
   * Closes out delegations that will never answer, so the caller hears about them.
   *
   * Dropping them silently would lose the fact that an agent was asked at all, and keeping
   * them open would leave the request unfinishable.
   */
  private abandonOutstandingDelegations(reason: string): void {
    for (const delegation of this.outstandingByDelegationId.values()) {
      logger.warn('Delegation never answered', { ...delegation, reason });
      const outcome: DelegationOutcome = { ...delegation, result: reason, failed: true };
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
  /** Questions the request is waiting on the user to answer. */
  questions: OpenQuestion[];
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
    inProgress: [...new Set([...progress.outstandingByDelegationId.values()].map((one) => one.taskId))],
    finished: progress.isFinished(),
    questions: progress.questions,
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
/** Stops whatever a session's request still has running, when a newer request supersedes it. */
const abortBySessionId = new Map<string, AbortController>();

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

/** The session the most recent request was started in, whichever that was. */
let latestStartedSessionId: string | undefined;

/**
 * The session a poll reads, which is the one it names -- unless no request was ever started
 * there, in which case it is the latest request's.
 *
 * A poll naming a session nothing was started in can only be a caller that lost track of its
 * session, and answering it from an empty buffer means "Still processing" with nothing in
 * progress, forever. That is not hypothetical: the voice agent is never shown a session id
 * (see `createInstructionsWorkflowTool`), yet on gpt-5.6-luna it filled the optional field in
 * anyway. A request that failed at once -- the planner found no agent for it -- was polled
 * under another id for as long as the conversation lasted, and the failure was never heard.
 *
 * A session that has been started keeps its own answers, so callers that do keep their ids
 * straight stay isolated from each other exactly as before.
 */
function resolvePolledSessionId(sessionId: string): string {
  if (progressBySessionId.has(sessionId) || latestStartedSessionId === undefined) {
    return sessionId;
  }

  logger.warn('Poll named a session no request was started in; reading the latest request instead', {
    polledSessionId: sessionId,
    latestStartedSessionId,
  });
  return latestStartedSessionId;
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
export function asRoutingEvents(chunk: unknown, plan: RoutingPlan): RoutingEvent[] {
  const parsed = asWorkflowChunk(chunk);
  if (parsed?.type === 'workflow-step-output') {
    return asSuspensionEvents(parsed.payload, plan);
  }

  if (parsed?.type !== 'workflow-step-result') {
    return [];
  }

  const stepId = parsed.payload.id;
  if (typeof stepId !== 'string') {
    return [];
  }

  const isError = parsed.payload.status !== 'success';

  if (plan.agentByStepId.has(stepId)) {
    return [{ type: 'delegation_end', delegationId: stepId, result: parsed.payload.output, isError }];
  }

  const delegationIds = plan.delegationIdsByChainStepId.get(stepId);
  if (!delegationIds || delegationIds.length === 0) {
    return [];
  }

  const lastDelegationId = delegationIds[delegationIds.length - 1];
  const chainResult: RoutingEvent = {
    type: 'delegation_end',
    delegationId: lastDelegationId,
    result: parsed.payload.output,
    isError,
  };

  // A chain that failed says nothing about where it failed, so the steps before the last are
  // left outstanding and the end of the run reports them as never having answered, which is
  // the truth as far as anything here knows it.
  if (isError) {
    return [chainResult];
  }

  // A chain that succeeded could not have, had any step in it failed. Those steps' own
  // results do not reach this stream -- only the chain's does -- so without this they would
  // sit outstanding until the run ended and then be reported as never having answered. That
  // was a lie with consequences: it is what told the user a recipe lookup had failed when its
  // answer was already in the reminder built from it.
  const earlier: RoutingEvent[] = delegationIds.slice(0, -1).map((delegationId) => ({
    type: 'delegation_end',
    delegationId,
    result: ANSWERED_INTO_THE_NEXT_STEP,
    isError: false,
  }));

  return [...earlier, chainResult];
}

/**
 * What the rest of a chain is reported as when a step in it stops to ask the user something.
 *
 * Those steps were waiting for that step's answer, which will now only come once the user has
 * answered, in a later request -- and nothing resumes a chain, only the agent that asked.
 */
const WAITING_ON_AN_EARLIER_QUESTION = 'did not run, because the step before it stopped to ask the user something';

/**
 * A delegation stopping to ask something, read off a step's streamed output.
 *
 * An agent step forwards everything its agent streams, so a tool call that suspends inside it
 * reaches the plan run as a `workflow-step-output` wrapping the agent's own
 * `tool-call-suspended` chunk. That is the only place it shows: the step itself never reports a
 * result, because Mastra's agent step waits for the agent to finish and a suspended agent does
 * not (see `consumeRun`).
 *
 * The step's name is its bare id here, but is read as the last dotted segment all the same,
 * since a nested step can be reported under its chain's id as well.
 */
function asSuspensionEvents(payload: Record<string, unknown>, plan: RoutingPlan): RoutingEvent[] {
  const suspension = asDelegationSuspension(payload.output);
  const { stepName } = payload;
  if (!suspension || typeof stepName !== 'string') {
    return [];
  }

  const delegationId = stepName.split('.').pop() ?? stepName;
  if (!plan.agentByStepId.has(delegationId)) {
    return [];
  }

  const chain = [...plan.delegationIdsByChainStepId.values()].find((ids) => ids.includes(delegationId)) ?? [];
  const blocked: RoutingEvent[] = chain.slice(chain.indexOf(delegationId) + 1).map((blockedId) => ({
    type: 'delegation_end',
    delegationId: blockedId,
    result: WAITING_ON_AN_EARLIER_QUESTION,
    isError: true,
  }));

  return [{ type: 'delegation_suspended', delegationId, suspension }, ...blocked];
}

/**
 * What a chained delegation is reported as when only the chain's own result reaches us.
 *
 * Its answer is not lost -- the next step in the chain was handed it, and what that step
 * produced is reported in full. What is lost is the text, so this says where it went rather
 * than inventing it.
 */
const ANSWERED_INTO_THE_NEXT_STEP = 'answered, and its answer was given to the next step of its chain';

/**
 * Reads the plan run into the caller's buffer, until the plan has nothing left to say.
 *
 * Usually that is the end of the stream, whether the run ended by finishing or by being
 * cancelled for a newer request. The exception is a delegation that stopped to ask the user
 * something: Mastra's agent step resolves on the agent's `onFinish`, and an agent that
 * suspended never finishes, so the step -- and with it the run and this stream -- would wait
 * forever. The caller would hear "Still processing" for as long as it kept asking. So once every
 * delegation in the plan has either answered or asked, the run is stopped here instead. The
 * agent that asked is not part of the run; it is suspended in storage in its own right, and is
 * what the answer resumes.
 */
async function consumeRun(
  sessionId: string,
  progress: RoutingProgress,
  plan: RoutingPlan,
  chunks: { getReader(): { read(): Promise<{ done: boolean; value?: unknown }>; releaseLock(): void } },
  stopRun: () => Promise<void>,
): Promise<void> {
  const reader = chunks.getReader();
  let waitingOnTheUser = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      for (const event of asRoutingEvents(value, plan)) {
        progress.handle(event);
        waitingOnTheUser ||= event.type === 'delegation_suspended';
      }

      const planHasNothingLeftToSay = [...plan.agentByStepId.keys()].every(
        (delegationId) => !progress.isOutstanding(delegationId),
      );
      if (waitingOnTheUser && planHasNothingLeftToSay) {
        logger.info('Stopping a routing plan run that is waiting on the user', { sessionId, planId: plan.id });
        await stopRun();
        break;
      }
    }
  } catch (error) {
    progress.fail(error instanceof Error ? error.message : String(error));
    return;
  } finally {
    reader.releaseLock();
  }

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
 * Registers a plan and runs it.
 *
 * Registering before running is what puts the plan in Studio whether or not the run goes
 * well: a request that fails half way is exactly the one worth looking at.
 */
async function runPlan(
  mastra: Mastra,
  sessionId: string,
  progress: RoutingProgress,
  userQuery: string,
  chains: PlannedChain[],
  signal: AbortSignal,
): Promise<void> {
  const plan = buildRoutingPlan(newPlanId(), chains);
  await mastra.addDynamicWorkflows(plan.graphs);
  logger.info('Registered a routing plan', { planId: plan.id, delegations: plan.delegationCount });

  // Every delegation is outstanding from here, before a single step has run, so the first
  // poll can already name the whole of the work.
  for (const [delegationId, agentId] of plan.agentByStepId) {
    progress.handle({
      type: 'delegation_start',
      delegationId,
      taskId: plan.taskIdByStepId.get(delegationId) ?? agentId,
      agentId,
    });
  }

  const run = await mastra.getWorkflowById(plan.id).createRun();
  const cancelRun = async () => {
    await run.cancel().catch((error: unknown) => {
      logger.warn('Could not cancel a routing plan run', { sessionId, planId: plan.id, error });
    });
  };
  signal.addEventListener('abort', () => void cancelRun(), { once: true });

  const output = run.stream({ inputData: { prompt: userQuery } });
  const consumed = consumeRun(sessionId, progress, plan, output.fullStream, cancelRun);

  // Sweeping after the run is under way, not before it: the sweep reads and writes storage,
  // and the caller is a voice assistant that has already been told to start polling.
  await sweepOldRoutingPlans(mastra);
  await consumed;
}

/** The delegation an answer is reported as, which is the task that asked the question. */
function answerDelegationId(question: OpenQuestion): string {
  return `answer-${question.id}`;
}

/**
 * Carries an answer back to the agent that asked for it, and reports what it does next.
 *
 * The agent is resumed where it stopped -- inside the tool call that suspended -- so the tool
 * gets the answer and the agent carries on from there: it either finishes and says what came
 * of it, or its tool stops on another question, which is asked in turn.
 */
async function resumeWithAnswer(
  mastra: Mastra,
  progress: RoutingProgress,
  question: OpenQuestion,
  answer: string,
  signal: AbortSignal,
): Promise<void> {
  const delegationId = answerDelegationId(question);

  try {
    const output = await mastra
      .getAgentById(question.agentId)
      .resumeStream(
        { [question.answerField]: answer },
        { runId: question.agentRunId, toolCallId: question.toolCallId, abortSignal: signal },
      );

    let suspension: DelegationSuspension | undefined;
    for await (const chunk of output.fullStream) {
      suspension = asDelegationSuspension(chunk) ?? suspension;
    }

    if (suspension) {
      progress.handle({ type: 'delegation_suspended', delegationId, suspension });
      return;
    }

    progress.handle({ type: 'delegation_end', delegationId, result: { text: await output.text }, isError: false });
  } catch (error) {
    progress.handle({
      type: 'delegation_end',
      delegationId,
      result: `could not carry the answer back: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    });
  }
}

/** The questions a request's answers are for, taken off the list of those still open. */
function takeAnsweredQuestions(answers: PlannedAnswer[]): { question: OpenQuestion; answer: string }[] {
  return answers.flatMap(({ questionId, answer }) => {
    const question = takeOpenQuestion(questionId);
    return question ? [{ question, answer }] : [];
  });
}

/**
 * Plans a request and does everything it asks: the new work in a plan run, and each answer it
 * gives to an open question carried back to the agent that asked.
 */
async function runRequest(
  mastra: Mastra,
  sessionId: string,
  progress: RoutingProgress,
  userQuery: string,
  signal: AbortSignal,
): Promise<void> {
  const { chains, answers } = await planDelegations(await resolvePlannerAgent(mastra), userQuery, listOpenQuestions());

  // Superseded while it was being planned: nothing will read this request, so it must not
  // start work -- and above all must not take the questions its answers are for.
  if (signal.aborted) {
    return;
  }

  const answered = takeAnsweredQuestions(answers);

  if (chains.length === 0 && answered.length === 0) {
    progress.fail('none of the specialized agents can handle this request');
    return;
  }

  // Outstanding from the start, like the plan's own delegations, so the first poll already
  // knows the answer is being worked on.
  for (const { question } of answered) {
    progress.handle({
      type: 'delegation_start',
      delegationId: answerDelegationId(question),
      taskId: question.taskId,
      agentId: question.agentId,
    });
  }

  // Settled rather than all: a plan run that fails must not close the request while an answer
  // is still being carried back, or a question that answer leads to would be asked of nobody.
  const outcomes = await Promise.allSettled([
    ...answered.map(({ question, answer }) => resumeWithAnswer(mastra, progress, question, answer, signal)),
    ...(chains.length > 0 ? [runPlan(mastra, sessionId, progress, userQuery, chains, signal)] : []),
  ]);

  // Kept for the next request to answer -- unless this one was superseded, in which case its
  // closing report will never be read and sir will never hear what it asked.
  if (progressBySessionId.get(sessionId) === progress) {
    rememberOpenQuestions(progress.questions);
  } else if (progress.questions.length > 0) {
    logger.warn('Dropping questions from a superseded routing request', {
      sessionId,
      questionIds: progress.questions.map((question) => question.id),
    });
  }

  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) {
    progress.fail(failure.reason instanceof Error ? failure.reason.message : String(failure.reason));
    return;
  }

  progress.handle({ type: 'finished' });
}

const planRuntime: RoutingRuntime = {
  async start(sessionId, userQuery) {
    const previous = progressFor(sessionId);

    // A new request supersedes the one before it, which is what the caller means: the voice
    // assistant has moved on. Cancelling is what makes that true rather than leaving the
    // previous plan running behind it.
    const abortPrevious = abortBySessionId.get(sessionId);
    if (abortPrevious && !previous.runFinished && !previous.isIdle()) {
      logger.info('Superseding a routing request that was still running', { sessionId });
      abortPrevious.abort();
    }
    const abort = new AbortController();
    abortBySessionId.set(sessionId, abort);

    // A fresh buffer rather than a cleared one. Cancelling a run does not stop it
    // instantly, and its reader holds whatever buffer it was started with -- so clearing in
    // place would let the old run's last few events land in the new request's report.
    const progress = new RoutingProgress();
    progressBySessionId.set(sessionId, progress);
    latestStartedSessionId = sessionId;

    const mastra = registry;
    if (!mastra) {
      progress.fail('routing has no Mastra instance to plan against');
      return;
    }

    // Not awaited: the caller is a voice assistant on a short tool-call deadline, and the
    // whole contract is that it polls for results rather than waiting for them.
    void runRequest(mastra, sessionId, progress, userQuery, abort.signal).catch((error: unknown) => {
      progress.fail(error instanceof Error ? error.message : String(error));
    });
  },

  async poll(sessionId) {
    return buildSnapshot(progressFor(resolvePolledSessionId(sessionId)));
  },

  async waitForChange(sessionId, deadlineMs) {
    // Everything that changes what a poll would say arrives on the run's own stream, so the
    // wait is that stream against the deadline.
    await Promise.race([progressFor(resolvePolledSessionId(sessionId)).wait(), delay(deadlineMs)]);
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
  abortBySessionId.clear();
  forgetOpenQuestions();
  latestStartedSessionId = undefined;
  registry = undefined;
}
