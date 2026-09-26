import type { SpanRecord, WorkflowRun } from '@mastra/core/storage';
import type { WorkflowRunState } from '@mastra/core/workflows';

/**
 * Turning what Mastra stores about itself into something worth saying out loud.
 *
 * Everything here is a pure function over a record, and that is the point: the tools in
 * `tools.ts` do nothing but fetch and call these, so the part that can be wrong about a
 * failure — which span actually failed, what the error said, which step of a run stopped
 * it — is testable without a database, a model or a live server.
 *
 * The shapes are deliberately narrow. A span row carries three dozen columns and a whole
 * serialized agent payload; a voice answer needs the name, the time, and the reason. What
 * is dropped here is dropped on purpose.
 */

/**
 * How much of an input or output payload survives.
 *
 * Enough to see which request a span was serving, short enough that a trace of twenty
 * spans is still an answer rather than a transcript.
 */
const MAX_PAYLOAD_LENGTH = 500;

/** How long a single error message may be before it is cut. */
const MAX_ERROR_LENGTH = 1000;

/** How deep {@link errorSummary} follows a `cause` chain. */
const MAX_CAUSE_DEPTH = 3;

function truncateTo(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}… (truncated)` : value;
}

/** Stringifies a value, falling back to its type when it will not serialize. */
function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return `[unserializable ${typeof value}]`;
  }
}

/**
 * The one line that says what went wrong.
 *
 * A failure reaches storage in whatever shape the thing that failed had: a string, an
 * Error serialized to `{name, message, stack}`, or a `MastraError` whose own message names
 * only the wrapper — `[Agent:RoutingSupervisor] - Failed agent tool execution for calendar`
 * — and keeps the real reason as its `cause`. So the chain is followed, and the reasons are
 * joined rather than replaced: the wrapper says where it broke, the cause says why, and
 * either one alone has been the half that was not useful.
 *
 * `stack` is deliberately not included. It is the longest field on the record and the
 * least answerable out loud; `describe-trace` hands back the span it belongs to, and that
 * is where someone reading a stack should be looking.
 */
export function errorSummary(error: unknown, depth = 0): string {
  if (error === null || error === undefined) {
    return '';
  }

  if (typeof error === 'string') {
    return truncateTo(error, MAX_ERROR_LENGTH);
  }

  if (typeof error !== 'object') {
    return truncateTo(String(error), MAX_ERROR_LENGTH);
  }

  const message = 'message' in error && typeof error.message === 'string' ? error.message : undefined;
  const name = 'name' in error && typeof error.name === 'string' && error.name !== 'Error' ? error.name : undefined;

  const head = message ? (name ? `${name}: ${message}` : message) : stringify(error);

  const cause = depth < MAX_CAUSE_DEPTH && 'cause' in error ? errorSummary(error.cause, depth + 1) : '';
  // A cause that only repeats the wrapper adds a clause and no information.
  const joined = cause && !head.includes(cause) ? `${head} (caused by: ${cause})` : head;

  return truncateTo(joined, MAX_ERROR_LENGTH);
}

/** One span, as a reflection answer describes it. */
export interface SpanReport {
  spanId: string;
  parentSpanId?: string;
  /** What the span is called — an agent id, a tool id, a workflow step. */
  name: string;
  /** Mastra's own classification: `agent_run`, `tool_call`, `llm_generation`, … */
  spanType: string;
  startedAt?: string;
  /** How long it ran, in milliseconds. Absent while it is still running. */
  durationMs?: number;
  failed: boolean;
  /** Why it failed, when it did. */
  error?: string;
  /** What it was given, trimmed. Only present when payloads were asked for. */
  input?: string;
  /** What it answered, trimmed. Only present when payloads were asked for. */
  output?: string;
}

/** The span fields a report is built from — anything span-shaped will do. */
type SpanLike = Pick<SpanRecord, 'spanId' | 'name' | 'spanType'> &
  Partial<Pick<SpanRecord, 'parentSpanId' | 'startedAt' | 'endedAt' | 'error' | 'input' | 'output' | 'entityName'>>;

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function durationMs(span: SpanLike): number | undefined {
  const started = toIso(span.startedAt);
  const ended = toIso(span.endedAt);
  return started && ended ? new Date(ended).getTime() - new Date(started).getTime() : undefined;
}

/** Describes one span, optionally carrying the trimmed payloads it was given and returned. */
export function spanReport(span: SpanLike, options: { includePayloads?: boolean } = {}): SpanReport {
  const error = span.error === null || span.error === undefined ? undefined : errorSummary(span.error);

  return {
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    spanType: String(span.spanType),
    ...(toIso(span.startedAt) ? { startedAt: toIso(span.startedAt) } : {}),
    ...(durationMs(span) === undefined ? {} : { durationMs: durationMs(span) }),
    failed: error !== undefined,
    ...(error ? { error } : {}),
    ...(options.includePayloads && span.input !== null && span.input !== undefined
      ? { input: truncateTo(stringify(span.input), MAX_PAYLOAD_LENGTH) }
      : {}),
    ...(options.includePayloads && span.output !== null && span.output !== undefined
      ? { output: truncateTo(stringify(span.output), MAX_PAYLOAD_LENGTH) }
      : {}),
  };
}

/** A whole trace, with the spans that failed pulled to the front. */
export interface TraceReport {
  traceId: string;
  /** The agent, workflow or tool the trace is about, when the root span names one. */
  entity?: string;
  startedAt?: string;
  durationMs?: number;
  /** Whether anything in the trace failed. */
  failed: boolean;
  /**
   * The spans that carry an error, innermost first, each with its trimmed payloads.
   *
   * Which is the answer to "why did this fail": a run fails from the inside out, so the
   * first failing span is the tool or model call that broke and every span above it is
   * the wrapper that passed the failure on.
   */
  failingSpans: SpanReport[];
  /** Every span in the trace, in the order it started. */
  spans: SpanReport[];
}

/**
 * Orders spans so a cause comes before the wrapper that reported it.
 *
 * Depth is not stored, so it is counted: a span whose parent is in this trace sits below
 * that parent. Sorted deepest-first, the innermost failure — the one that actually broke —
 * is the first thing the report names.
 */
function depthOf(span: SpanLike, byId: Map<string, SpanLike>): number {
  let depth = 0;
  let current = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;

  // Bounded by the span count, so a parent chain that somehow loops cannot hang the walk.
  while (current && depth <= byId.size) {
    depth += 1;
    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }

  return depth;
}

/** The spans of one trace that carry an error, the innermost -- the cause -- first. */
function failingInnermostFirst(spans: SpanLike[]): SpanLike[] {
  const byId = new Map(spans.map((span) => [span.spanId, span]));

  return spans
    .filter((span) => span.error !== null && span.error !== undefined)
    .sort((left, right) => depthOf(right, byId) - depthOf(left, byId));
}

/**
 * The failure that started a trace's troubles, without its payloads, or nothing when nothing in
 * it failed.
 *
 * What a list of failures carries for each one, so "why didn't that work?" is answered from the
 * list: a failed run's root span usually carries no error of its own -- it failed from the inside
 * -- and without this every failure in the list took another tool call to explain.
 */
export function innermostFailure(spans: SpanLike[]): SpanReport | undefined {
  const [innermost] = failingInnermostFirst(spans);
  return innermost ? spanReport(innermost) : undefined;
}

/**
 * Builds the report for one trace out of its spans.
 *
 * The failing spans carry their payloads whatever `includePayloads` says, because what the
 * broken call was given is often the reason it broke. The option decides only whether every
 * other span carries them too: a routed request is dozens of spans, and their payloads are most
 * of what a model would otherwise have to read before it could answer.
 */
export function traceReport(
  traceId: string,
  spans: SpanLike[],
  options: { includePayloads?: boolean } = {},
): TraceReport {
  const inStartOrder = [...spans].sort((left, right) =>
    (toIso(left.startedAt) ?? '').localeCompare(toIso(right.startedAt) ?? ''),
  );

  const root = spans.find((span) => !span.parentSpanId) ?? inStartOrder[0];
  const reports = inStartOrder.map((span) => spanReport(span, options));

  const failing = failingInnermostFirst(spans).map((span) => spanReport(span, { includePayloads: true }));

  return {
    traceId,
    ...(root?.entityName ? { entity: root.entityName } : {}),
    ...(root && toIso(root.startedAt) ? { startedAt: toIso(root.startedAt) } : {}),
    ...(root && durationMs(root) !== undefined ? { durationMs: durationMs(root) } : {}),
    failed: failing.length > 0,
    failingSpans: failing,
    spans: reports,
  };
}

/** A step of a workflow run that did not succeed. */
export interface FailedStepReport {
  stepId: string;
  status: string;
  error?: string;
}

/** One workflow run, as a reflection answer describes it. */
export interface RunReport {
  workflowName: string;
  runId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  /** The run's own failure, when it has one. */
  error?: string;
  /** The steps that failed, which is usually where the reason actually is. */
  failedSteps: FailedStepReport[];
}

/**
 * A run's snapshot, which storage hands back as either an object or the JSON it was stored
 * as, depending on the adapter.
 */
function snapshotOf(snapshot: WorkflowRunState | string | undefined): WorkflowRunState | undefined {
  if (!snapshot) {
    return undefined;
  }
  if (typeof snapshot !== 'string') {
    return snapshot;
  }

  try {
    return JSON.parse(snapshot) as WorkflowRunState;
  } catch {
    return undefined;
  }
}

/** A step result as a snapshot stores it — one entry, or one per `foreach` iteration. */
interface StepResultLike {
  status?: unknown;
  error?: unknown;
}

/**
 * A status that is not a failure.
 *
 * Everything else is, including the ones that are not the word "failed": a suspended step
 * is a run stalled waiting for a human, and a canceled one is a run that stopped without
 * finishing. Both are answers to "why did nothing happen?".
 */
const SETTLED_STATUSES: ReadonlySet<string> = new Set(['success', 'running']);

/**
 * The failure a single step result records, or nothing when it did not fail.
 *
 * A `foreach` step stores one of these per item, which is why this takes the entry rather
 * than the step: "the step failed" and "the step failed on one of forty items" are
 * different answers and only the second is worth having.
 */
function stepFailure(stepId: string, entry: StepResultLike): FailedStepReport | undefined {
  const status = typeof entry?.status === 'string' ? entry.status : undefined;
  if (!status || SETTLED_STATUSES.has(status)) {
    return undefined;
  }

  const error = errorSummary(entry?.error);
  return { stepId, status, ...(error ? { error } : {}) };
}

/**
 * The steps of a run that did not succeed.
 *
 * `context` is where the engine records what each step did, keyed by step id, with `input`
 * sitting among them as a non-step entry — so it is skipped by name.
 */
export function failedSteps(snapshot: WorkflowRunState | string | undefined): FailedStepReport[] {
  const state = snapshotOf(snapshot);
  if (!state?.context) {
    return [];
  }

  return Object.entries(state.context)
    .filter(([stepId]) => stepId !== 'input')
    .flatMap(([stepId, result]) =>
      ((Array.isArray(result) ? result : [result]) as StepResultLike[])
        .map((entry) => stepFailure(stepId, entry))
        .filter((failure) => failure !== undefined),
    );
}

/** Describes one workflow run, including which of its steps stopped it. */
export function runReport(run: WorkflowRun): RunReport {
  const state = snapshotOf(run.snapshot);
  const error = errorSummary(state?.error);

  return {
    workflowName: run.workflowName,
    runId: run.runId,
    status: state?.status ?? 'unknown',
    ...(toIso(run.createdAt) ? { createdAt: toIso(run.createdAt) } : {}),
    ...(toIso(run.updatedAt) ? { updatedAt: toIso(run.updatedAt) } : {}),
    ...(error ? { error } : {}),
    failedSteps: failedSteps(run.snapshot),
  };
}
