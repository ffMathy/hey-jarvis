import type { StorageDomains } from '@mastra/core/storage';
import { z } from 'zod';
import { getMastraStorageProvider } from '../../storage/index.js';
import { diagnosticCount, recentDiagnostics } from '../../utils/diagnostics.js';
import { createTool } from '../../utils/tool-factory.js';
import { runReport, spanReport, traceReport } from './reports.js';

/**
 * Reading Jarvis's own machinery.
 *
 * Every other vertical reaches out at something — the house, the calendar, the weather.
 * This one reaches in, at the two places Mastra records what it did and what went wrong:
 *
 * - **Traces.** Every agent run, tool call and model call is sampled
 *   (`SamplingStrategyType.ALWAYS` in `mastra/index.ts`) and kept for fourteen days, with
 *   each span carrying its own error.
 * - **Workflow runs.** Kept for thirty days, each with the snapshot that says which step
 *   it stopped at and why.
 *
 * And one place it would otherwise not be recorded at all: the errors and warnings Mastra
 * reports about *itself* — a scheduled run that threw, a run retired at boot, an exception
 * an agent handled — which go to a logger and, with no telemetry backend attached, nowhere
 * else. `utils/diagnostics.ts` keeps those in a ring this reads.
 *
 * Nothing here writes. A vertical that could clear its own error log would be the last
 * thing worth trusting about an error.
 */

/** How far back a question reaches when it does not say. */
const DEFAULT_LOOKBACK_HOURS = 24;

/** The most records any one of these tools returns, however large a limit is asked for. */
const MAX_RESULTS = 50;

/** How long Mastra's own records are kept, so an answer can say what it cannot see. */
const TRACE_RETENTION_DAYS = 14;

type ObservabilityStore = NonNullable<StorageDomains['observability']>;
type WorkflowsStore = NonNullable<StorageDomains['workflows']>;

/**
 * The store Mastra's own traces live in.
 *
 * Throws rather than answering emptily when the domain is missing: "nothing failed" and "I
 * cannot see failures" are opposite answers, and a reflection vertical that confuses them
 * is worse than one that is absent.
 */
async function getObservabilityStore(): Promise<ObservabilityStore> {
  const store = await (await getMastraStorageProvider()).getStore('observability');
  if (!store) {
    throw new Error(
      'The configured storage provider does not implement the observability domain, so there are no traces to read.',
    );
  }
  return store;
}

/** The store Mastra's workflow runs live in. */
async function getWorkflowsStore(): Promise<WorkflowsStore> {
  const store = await (await getMastraStorageProvider()).getStore('workflows');
  if (!store) {
    throw new Error(
      'The configured storage provider does not implement the workflows domain, so there are no runs to read.',
    );
  }
  return store;
}

/** The start of a lookback window. */
function since(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Clamped at both ends. `Math.min` alone let a negative limit through, and SQLite reads a
 * negative LIMIT as "no limit" — so a caller building the input by hand could ask for one
 * page and be handed the whole spans table.
 */
function clampLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), MAX_RESULTS);
}

const lookbackHoursSchema = z
  .number()
  .positive()
  .optional()
  .default(DEFAULT_LOOKBACK_HOURS)
  .describe(`How many hours back to look (default ${DEFAULT_LOOKBACK_HOURS})`);

const spanReportSchema = z.object({
  spanId: z.string().describe('The span this describes'),
  parentSpanId: z.string().optional().describe('The span that contains this one, if any'),
  name: z.string().describe('What ran — an agent id, a tool id, a workflow step'),
  spanType: z.string().describe("Mastra's classification: agent_run, tool_call, llm_generation, …"),
  startedAt: z.string().optional().describe('When it started, ISO-8601'),
  durationMs: z.number().optional().describe('How long it ran; absent while it is still running'),
  failed: z.boolean().describe('Whether this span carries an error'),
  error: z.string().optional().describe('What the error said, with its underlying cause appended'),
  input: z.string().optional().describe('What it was given, trimmed'),
  output: z.string().optional().describe('What it answered, trimmed'),
});

const failedStepSchema = z.object({
  stepId: z.string().describe('The workflow step that did not succeed'),
  status: z.string().describe('The status it ended on — failed, suspended, canceled, …'),
  error: z.string().optional().describe('What the step reported, when it reported anything'),
});

/**
 * What has failed recently, across every agent and workflow.
 *
 * Filtered on `hasChildError` rather than on the trace's own status, because a run fails
 * from the inside: the tool call that broke carries the error, and the agent span above it
 * may well have recovered and finished cleanly. Asking only for traces whose *root* failed
 * misses exactly the failures worth asking about.
 */
export const listRecentFailures = createTool({
  id: 'listRecentFailures',
  description: `List the runs that failed recently — which agent or workflow it was, when, and what the error said.

Use this tool when:
- The user asks what has gone wrong, what is broken, or why something did not work
- The user asks whether an earlier request actually succeeded
- You need the traceId of a failure before looking at it in detail`,
  inputSchema: z.object({
    lookbackHours: lookbackHoursSchema,
    entityName: z
      .string()
      .optional()
      .describe('Only failures from this agent or workflow (e.g. "calendar", "weather"). Omit for all of them.'),
    limit: z.number().int().positive().optional().default(10).describe(`How many to return (max ${MAX_RESULTS})`),
  }),
  outputSchema: z.object({
    lookbackHours: z.number().describe('The window these failures were read from'),
    failureCount: z.number().describe('How many failures are in this answer'),
    failures: z
      .array(spanReportSchema.extend({ traceId: z.string(), entity: z.string() }))
      .describe('The failed runs, newest first'),
  }),
  execute: async (inputData) => {
    const store = await getObservabilityStore();

    const { spans } = await store.listTraces({
      filters: {
        hasChildError: true,
        startedAt: { start: since(inputData.lookbackHours) },
        ...(inputData.entityName ? { entityName: inputData.entityName } : {}),
      },
      pagination: { page: 0, perPage: clampLimit(inputData.limit) },
      orderBy: { field: 'startedAt', direction: 'DESC' },
    });

    return {
      lookbackHours: inputData.lookbackHours,
      failureCount: spans.length,
      failures: spans.map((span) => ({
        ...spanReport(span),
        traceId: span.traceId,
        entity: span.entityName ?? span.name,
      })),
    };
  },
});

/**
 * One trace, span by span, with the failure that started it named first.
 *
 * This is the tool that answers "why". The list above says a calendar request failed; this
 * says the request reached the calendar agent, which called `getCalendarEvents`, which was
 * refused by Google for want of a refreshed token.
 */
export const describeTrace = createTool({
  id: 'describeTrace',
  description: `Read one trace in full: every step of the run, which of them failed, and what each was given and returned.

Use this tool when:
- You have a traceId from listRecentFailures and need to know why it failed
- The user asks what happened during a specific request
- A failure needs explaining rather than just reporting`,
  inputSchema: z.object({
    traceId: z.string().describe('The trace to read, as listRecentFailures reports it'),
    includePayloads: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to include what each step was given and returned, trimmed. Turn off for a shorter answer.'),
  }),
  outputSchema: z.object({
    found: z.boolean().describe('Whether a trace with this id is still in storage'),
    traceId: z.string(),
    message: z.string().optional().describe('Why there is nothing to report, when nothing was found'),
    entity: z.string().optional().describe('The agent or workflow the trace is about'),
    startedAt: z.string().optional(),
    durationMs: z.number().optional(),
    failed: z.boolean().optional().describe('Whether anything in the trace failed'),
    failingSpans: z.array(spanReportSchema).optional().describe('The spans that failed, innermost — the cause — first'),
    spans: z.array(spanReportSchema).optional().describe('Every span in the trace, in the order it started'),
  }),
  execute: async (inputData) => {
    const store = await getObservabilityStore();
    const trace = await store.getTrace({ traceId: inputData.traceId });

    if (!trace || trace.spans.length === 0) {
      return {
        found: false,
        traceId: inputData.traceId,
        message: `No trace with id ${inputData.traceId}. Traces are kept for ${TRACE_RETENTION_DAYS} days, so an older one has been swept.`,
      };
    }

    return {
      found: true,
      ...traceReport(inputData.traceId, trace.spans, { includePayloads: inputData.includePayloads }),
    };
  },
});

/**
 * Workflow runs and the steps that stopped them.
 *
 * Separate from traces because they answer a different question. A trace covers one
 * request from the outside; a run covers a workflow that may have started on a schedule
 * with nobody asking, and it survives restarts. A scheduled email check that has failed
 * every hour since last night is in here, and in no trace anyone would think to look for.
 */
export const listWorkflowRuns = createTool({
  id: 'listWorkflowRuns',
  description: `List recent workflow runs with their status and, for the ones that failed, which step failed and why.

Use this tool when:
- The user asks about scheduled or background work — email checks, monitoring, meal planning
- The user asks whether something ran, or is still running
- A failure looks like it belongs to a workflow rather than to something just asked for`,
  inputSchema: z.object({
    lookbackHours: lookbackHoursSchema,
    workflowName: z
      .string()
      .optional()
      .describe('Only runs of this workflow (e.g. "emailCheckingWorkflow"). Omit for all of them.'),
    onlyFailed: z.boolean().optional().default(false).describe('Whether to return only the runs that failed'),
    limit: z.number().int().positive().optional().default(10).describe(`How many to return (max ${MAX_RESULTS})`),
  }),
  outputSchema: z.object({
    lookbackHours: z.number().describe('The window these runs were read from'),
    totalMatching: z.number().describe('How many runs match, including any beyond this page'),
    runs: z
      .array(
        z.object({
          workflowName: z.string(),
          runId: z.string(),
          status: z.string().describe('running, success, failed, suspended, …'),
          createdAt: z.string().optional(),
          updatedAt: z.string().optional(),
          error: z.string().optional().describe("The run's own failure, when it has one"),
          failedSteps: z.array(failedStepSchema).describe('The steps that did not succeed'),
        }),
      )
      .describe('The runs, newest first'),
  }),
  execute: async (inputData) => {
    const store = await getWorkflowsStore();

    const { runs, total } = await store.listWorkflowRuns({
      fromDate: since(inputData.lookbackHours),
      ...(inputData.workflowName ? { workflowName: inputData.workflowName } : {}),
      ...(inputData.onlyFailed ? { status: 'failed' as const } : {}),
      page: 0,
      perPage: clampLimit(inputData.limit),
    });

    return {
      lookbackHours: inputData.lookbackHours,
      totalMatching: total,
      runs: runs.map(runReport),
    };
  },
});

/**
 * What Mastra has said about itself since the process started.
 *
 * Bounded and in-process by design — see `utils/diagnostics.ts`. The scope is reported
 * alongside the records rather than left to be inferred, because an empty list here means
 * "nothing since the last restart", not "nothing has ever gone wrong", and those read
 * identically if nobody says which one it is.
 */
export const listRuntimeErrors = createTool({
  id: 'listRuntimeErrors',
  description: `List the errors and warnings Mastra has reported about itself since the server last started — scheduler failures, storage problems, exceptions agents handled internally.

Use this tool when:
- Nothing in the traces explains a problem
- The user asks whether the system itself is unhealthy, rather than one request
- A failure looks like configuration, credentials or storage rather than a bad request`,
  inputSchema: z.object({
    level: z.enum(['error', 'warn']).optional().describe('Only records at this level. Omit for both.'),
    limit: z.number().int().positive().optional().default(20).describe(`How many to return (max ${MAX_RESULTS})`),
  }),
  outputSchema: z.object({
    scope: z.string().describe('What period these records cover, to be stated in any answer built from them'),
    totalHeld: z.number().describe('How many records are being held in total, before filtering'),
    records: z
      .array(
        z.object({
          at: z.string().describe('When it was reported, ISO-8601'),
          level: z.enum(['error', 'warn']),
          component: z.string().optional().describe('Which part of Mastra reported it'),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional().describe('The fields logged alongside it'),
        }),
      )
      .describe('The records, newest first'),
  }),
  execute: async (inputData) => {
    const matching = recentDiagnostics({
      ...(inputData.level ? { level: inputData.level } : {}),
      limit: clampLimit(inputData.limit),
    });

    return {
      scope: 'Errors and warnings reported since this server process started. Restarting clears them.',
      totalHeld: diagnosticCount(),
      records: matching,
    };
  },
});

/**
 * The one-glance answer: is the machine healthy right now.
 *
 * Deliberately counts rather than lists. "Nine failures in the last day, all of them the
 * calendar" is the answer to "how are you"; the tools above are for what comes after it.
 */
export const getSystemHealth = createTool({
  id: 'getSystemHealth',
  description: `Summarize the health of the assistant itself: how many runs failed recently, which parts of it they were in, and how many errors the server has logged.

Use this tool when:
- The user asks how the system is doing, or whether everything is working
- You need a starting point before digging into a specific failure
- The user asks a broad "anything wrong?" question`,
  inputSchema: z.object({ lookbackHours: lookbackHoursSchema }),
  outputSchema: z.object({
    lookbackHours: z.number(),
    totalRuns: z.number().describe('How many traces were recorded in the window'),
    failedRuns: z.number().describe('How many of them contain a failure'),
    failuresByEntity: z
      .array(z.object({ entity: z.string(), count: z.number() }))
      .describe('Which agents and workflows the sampled failures were in, busiest first'),
    loggedErrorsSinceStartup: z.number().describe('Errors Mastra has reported about itself since the last restart'),
    mostRecentLoggedError: z.string().optional().describe('The message of the latest of those'),
  }),
  execute: async (inputData) => {
    const store = await getObservabilityStore();
    const startedAt = { start: since(inputData.lookbackHours) };

    // Two counts over the same window, so the ratio means something. The second asks for a
    // single row because only `pagination.total` is wanted from it.
    const [failed, all] = await Promise.all([
      store.listTraces({ filters: { hasChildError: true, startedAt }, pagination: { page: 0, perPage: MAX_RESULTS } }),
      store.listTraces({ filters: { startedAt }, pagination: { page: 0, perPage: 1 } }),
    ]);

    const countByEntity = new Map<string, number>();
    for (const span of failed.spans) {
      const entity = span.entityName ?? span.name;
      countByEntity.set(entity, (countByEntity.get(entity) ?? 0) + 1);
    }

    const errors = recentDiagnostics({ level: 'error' });

    return {
      lookbackHours: inputData.lookbackHours,
      totalRuns: all.pagination?.total ?? 0,
      failedRuns: failed.pagination?.total ?? failed.spans.length,
      // Only the sampled page is grouped, so this names the usual suspects rather than
      // claiming a full tally when there are more failures than one page holds.
      failuresByEntity: [...countByEntity.entries()]
        .sort(([, left], [, right]) => right - left)
        .map(([entity, count]) => ({ entity, count })),
      loggedErrorsSinceStartup: errors.length,
      ...(errors[0] ? { mostRecentLoggedError: errors[0].message } : {}),
    };
  },
});

export const reflectionTools = {
  listRecentFailures,
  describeTrace,
  listWorkflowRuns,
  listRuntimeErrors,
  getSystemHealth,
};
