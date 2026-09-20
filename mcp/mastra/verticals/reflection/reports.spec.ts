import { describe, expect, it } from 'bun:test';
import { errorSummary, failedSteps, runReport, spanReport, traceReport } from './reports';

/**
 * What the reflection vertical is allowed to say about a failure.
 *
 * These are the functions that decide which span is reported as the cause and what its
 * error reads as, so every way of getting that wrong is a wrong answer about the system's
 * own health — the kind nobody can check without going to the database themselves.
 */

/** A span row, with only the fields a report reads. */
function span(overrides: Record<string, unknown> = {}) {
  return {
    spanId: 'span-1',
    name: 'calendar',
    spanType: 'agent_run',
    startedAt: new Date('2026-09-20T10:00:00Z'),
    endedAt: new Date('2026-09-20T10:00:02Z'),
    ...overrides,
  } as Parameters<typeof spanReport>[0];
}

describe('errorSummary', () => {
  it('reads a plain string error as it stands', () => {
    expect(errorSummary('Request timed out')).toBe('Request timed out');
  });

  it('names the error type when it is not just Error', () => {
    expect(errorSummary({ name: 'TypeError', message: 'undefined is not an object' })).toBe(
      'TypeError: undefined is not an object',
    );
  });

  /**
   * The failure that made this worth writing. A routing delegation is wrapped in a
   * `MastraError` whose message names the agent and nothing else; the reason is in its
   * cause. Reporting only the wrapper names the symptom, and reporting only the cause
   * loses where it happened — so both go in the line.
   */
  it('appends the cause, which is where the real reason is kept', () => {
    const summary = errorSummary({
      message: '[Agent:RoutingSupervisor] - Failed agent tool execution for calendar',
      cause: { message: 'Could not load the default credentials' },
    });

    expect(summary).toContain('Failed agent tool execution for calendar');
    expect(summary).toContain('Could not load the default credentials');
  });

  it('does not repeat a cause that only restates the wrapper', () => {
    const summary = errorSummary({ message: 'boom', cause: { message: 'boom' } });

    expect(summary).toBe('boom');
  });

  it('stops following a cause chain deeper than it is worth', () => {
    let error: Record<string, unknown> = { message: 'root' };
    for (let level = 0; level < 10; level++) {
      error = { message: `level-${level}`, cause: error };
    }

    expect(() => errorSummary(error)).not.toThrow();
  });

  it('is empty for a run that failed without recording a reason', () => {
    expect(errorSummary(undefined)).toBe('');
    expect(errorSummary(null)).toBe('');
  });

  it('cuts a message that would otherwise be read out in full', () => {
    const summary = errorSummary('x'.repeat(5000));

    expect(summary.length).toBeLessThan(1100);
    expect(summary).toEndWith('(truncated)');
  });
});

describe('spanReport', () => {
  it('reports a span that ended cleanly as not failed', () => {
    expect(spanReport(span())).toMatchObject({ spanId: 'span-1', name: 'calendar', failed: false, durationMs: 2000 });
  });

  it('marks a span with an error as failed and says what it said', () => {
    const report = spanReport(span({ error: { message: 'invalid_grant' } }));

    expect(report.failed).toBe(true);
    expect(report.error).toBe('invalid_grant');
  });

  it('leaves the duration off a span that is still running', () => {
    expect(spanReport(span({ endedAt: null }))).not.toHaveProperty('durationMs');
  });

  it('withholds payloads unless they were asked for', () => {
    const withoutPayloads = spanReport(span({ input: { query: 'calendar today' } }));
    const withPayloads = spanReport(span({ input: { query: 'calendar today' } }), { includePayloads: true });

    expect(withoutPayloads).not.toHaveProperty('input');
    expect(withPayloads.input).toContain('calendar today');
  });

  it('trims a payload rather than handing back a whole agent transcript', () => {
    const report = spanReport(span({ output: 'y'.repeat(5000) }), { includePayloads: true });

    expect(report.output?.length).toBeLessThan(600);
  });
});

describe('traceReport', () => {
  /**
   * A run fails from the inside out: the tool call breaks, and every span above it is a
   * wrapper reporting that something below it did. So the deepest failing span is the
   * answer to "why", and reporting the outermost one instead says only "the agent failed",
   * which is what the caller already knew.
   */
  it('names the innermost failure first, because that is the cause', () => {
    const report = traceReport('trace-1', [
      span({ spanId: 'root', name: 'routePrompt', spanType: 'workflow_run', error: { message: 'delegation failed' } }),
      span({ spanId: 'agent', parentSpanId: 'root', name: 'calendar', error: { message: 'tool execution failed' } }),
      span({
        spanId: 'tool',
        parentSpanId: 'agent',
        name: 'getCalendarEvents',
        spanType: 'tool_call',
        error: { message: 'invalid_grant: token expired' },
      }),
    ]);

    expect(report.failed).toBe(true);
    expect(report.failingSpans.map((failing) => failing.name)).toEqual([
      'getCalendarEvents',
      'calendar',
      'routePrompt',
    ]);
  });

  it('reports the spans in the order they started, so the run reads forwards', () => {
    const report = traceReport('trace-1', [
      span({ spanId: 'second', startedAt: new Date('2026-09-20T10:00:05Z') }),
      span({ spanId: 'first', startedAt: new Date('2026-09-20T10:00:00Z') }),
    ]);

    expect(report.spans.map((reported) => reported.spanId)).toEqual(['first', 'second']);
  });

  it('takes the entity and timing from the root span', () => {
    const report = traceReport('trace-1', [
      span({ spanId: 'root', entityName: 'weather' }),
      span({ spanId: 'child', parentSpanId: 'root', entityName: 'ignored' }),
    ]);

    expect(report).toMatchObject({ traceId: 'trace-1', entity: 'weather', durationMs: 2000 });
  });

  it('reports a trace where nothing failed as not failed', () => {
    const report = traceReport('trace-1', [span()]);

    expect(report.failed).toBe(false);
    expect(report.failingSpans).toEqual([]);
  });

  it('does not hang on a parent chain that refers to itself', () => {
    const report = traceReport('trace-1', [
      span({ spanId: 'a', parentSpanId: 'b', error: { message: 'boom' } }),
      span({ spanId: 'b', parentSpanId: 'a' }),
    ]);

    expect(report.failingSpans).toHaveLength(1);
  });
});

describe('failedSteps', () => {
  it('names the step that stopped the run and what it reported', () => {
    const steps = failedSteps({
      context: {
        input: { userQuery: 'check my email' },
        fetchMessages: { status: 'success' },
        summarize: { status: 'failed', error: { message: 'Model overloaded' } },
      },
    } as never);

    expect(steps).toEqual([{ stepId: 'summarize', status: 'failed', error: 'Model overloaded' }]);
  });

  it('reads a snapshot storage handed back as JSON', () => {
    const snapshot = JSON.stringify({ context: { summarize: { status: 'failed', error: { message: 'boom' } } } });

    expect(failedSteps(snapshot)).toEqual([{ stepId: 'summarize', status: 'failed', error: 'boom' }]);
  });

  /**
   * A `foreach` step stores one result per item, so "the step failed" and "the step failed
   * on two of forty items" are different answers and only the second is useful.
   */
  it('reports each failing iteration of a step that ran over a list', () => {
    const steps = failedSteps({
      context: {
        notifyEach: [
          { status: 'success' },
          { status: 'failed', error: { message: 'no such device' } },
          { status: 'failed', error: { message: 'unreachable' } },
        ],
      },
    } as never);

    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.error)).toEqual(['no such device', 'unreachable']);
  });

  it('reports a suspended step, which is stalled rather than finished', () => {
    const steps = failedSteps({ context: { awaitApproval: { status: 'suspended' } } } as never);

    expect(steps).toEqual([{ stepId: 'awaitApproval', status: 'suspended' }]);
  });

  it('leaves out the input entry, which is not a step', () => {
    expect(failedSteps({ context: { input: { status: 'failed' } } } as never)).toEqual([]);
  });

  it('has nothing to say about a snapshot that is missing or unreadable', () => {
    expect(failedSteps(undefined)).toEqual([]);
    expect(failedSteps('not json at all')).toEqual([]);
  });
});

describe('runReport', () => {
  it('describes a failed run down to the step that stopped it', () => {
    const report = runReport({
      workflowName: 'emailCheckingWorkflow',
      runId: 'sched_schedule_abc',
      createdAt: new Date('2026-09-20T09:00:00Z'),
      updatedAt: new Date('2026-09-20T09:00:30Z'),
      snapshot: {
        status: 'failed',
        error: { message: 'Run failed' },
        context: { summarize: { status: 'failed', error: { message: 'Model overloaded' } } },
      },
    } as never);

    expect(report).toMatchObject({
      workflowName: 'emailCheckingWorkflow',
      runId: 'sched_schedule_abc',
      status: 'failed',
      error: 'Run failed',
      createdAt: '2026-09-20T09:00:00.000Z',
      failedSteps: [{ stepId: 'summarize', error: 'Model overloaded' }],
    });
  });

  it('says the status is unknown rather than guessing at a run with no snapshot', () => {
    const report = runReport({
      workflowName: 'weatherMonitoringWorkflow',
      runId: 'run-1',
      createdAt: new Date('2026-09-20T09:00:00Z'),
      updatedAt: new Date('2026-09-20T09:00:00Z'),
      snapshot: '',
    } as never);

    expect(report.status).toBe('unknown');
    expect(report.failedSteps).toEqual([]);
  });
});
