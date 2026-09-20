import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { clearDiagnostics, recentDiagnostics } from './diagnostics';
import { createLogger, unwrapErrors } from './logger';

/**
 * The symptom these tests pin down:
 *
 * ```
 * ERROR (Mastra): Failed to restart workflow run
 *     workflow: "emailCheckingWorkflow"
 *     runId: "sched_schedule_…"
 *     error: {}
 * ```
 *
 * Mastra hands the error to the logger as an ordinary field, Pino serializes the log object
 * with `JSON.stringify`, and every field worth reading on an Error is non-enumerable — so
 * the one thing the line existed to report was the one thing missing from it.
 */
describe('unwrapErrors', () => {
  it('describes an error that JSON.stringify would flatten to nothing', () => {
    const error = new Error('Snapshot not found for run sched_schedule_abc_1789402620000');

    expect(JSON.stringify(error)).toBe('{}');

    const unwrapped = unwrapErrors({ workflow: 'emailCheckingWorkflow', error });

    expect(unwrapped).toMatchObject({
      workflow: 'emailCheckingWorkflow',
      error: {
        name: 'Error',
        message: 'Snapshot not found for run sched_schedule_abc_1789402620000',
      },
    });
    expect(JSON.stringify(unwrapped)).toContain('Snapshot not found for run');
  });

  it('keeps the stack, which is where the throwing call site is named', () => {
    const unwrapped = unwrapErrors({ error: new Error('boom') });

    const { error } = unwrapped as { error: Record<string, unknown> };
    expect(typeof error.stack).toBe('string');
    expect(error.stack).toContain('boom');
  });

  it('keeps the extra fields a MastraError carries', () => {
    const mastraLikeError = Object.assign(new Error('Workflow with id emailCheckingWorkflow not found'), {
      id: 'MASTRA_GET_WORKFLOW_BY_ID_NOT_FOUND',
      domain: 'MASTRA',
      details: { status: 404 },
    });

    expect(unwrapErrors(mastraLikeError)).toMatchObject({
      message: 'Workflow with id emailCheckingWorkflow not found',
      id: 'MASTRA_GET_WORKFLOW_BY_ID_NOT_FOUND',
      domain: 'MASTRA',
      details: { status: 404 },
    });
  });

  it('follows the cause chain, so a wrapped error still names what actually failed', () => {
    const error = new Error('Error restarting workflow', { cause: new Error('This workflow run was not active') });

    expect(unwrapErrors(error)).toMatchObject({
      message: 'Error restarting workflow',
      cause: { message: 'This workflow run was not active' },
    });
  });

  it('unwraps errors nested inside objects and arrays', () => {
    const unwrapped = unwrapErrors({
      results: [{ failure: new Error('first') }, { failure: new Error('second') }],
    });

    expect(unwrapped).toMatchObject({
      results: [{ failure: { message: 'first' } }, { failure: { message: 'second' } }],
    });
  });

  it('leaves everything that is not an error alone', () => {
    const value = { runId: 'sched_schedule_abc', attempts: 3, ok: false, missing: null };

    expect(unwrapErrors(value)).toEqual(value);
  });

  it('leaves class instances intact rather than stripping them to plain objects', () => {
    class RunHandle {
      constructor(readonly runId: string) {}
    }
    const handle = new RunHandle('sched_schedule_abc');

    const unwrapped = unwrapErrors({ handle }) as { handle: RunHandle };

    expect(unwrapped.handle).toBeInstanceOf(RunHandle);
  });

  it('stops walking a cause chain deeper than it is worth following', () => {
    let error = new Error('root');
    for (let level = 0; level < 10; level++) {
      error = new Error(`level-${level}`, { cause: error });
    }

    expect(() => JSON.stringify(unwrapErrors(error))).not.toThrow();
  });

  it('survives a cycle in the log object', () => {
    const cyclic: Record<string, unknown> = { runId: 'sched_schedule_abc' };
    cyclic.self = cyclic;

    expect(() => unwrapErrors(cyclic)).not.toThrow();
  });
});

/**
 * `trackException` is how Mastra reports an error it has already handled, and Pino's own
 * implementation forwards it to the observability adapter and nowhere else. With no
 * telemetry backend attached that is a silent drop: a live routing run failed seven
 * delegations out of eight and the log named the agent seven times without once saying why.
 */
describe('createLogger', () => {
  it('prints a tracked exception instead of forwarding it into the void', () => {
    const logger = createLogger('test');
    const error = new Error('[Agent:RoutingSupervisor] - Failed agent tool execution for calendar', {
      cause: new Error('Could not load the default credentials'),
    });
    const printed = mock();
    logger.error = printed;

    logger.trackException(error);

    expect(printed).toHaveBeenCalledTimes(1);
    const [, fields] = printed.mock.calls[0] as [string, { error: Error }];
    expect(fields.error).toBe(error);
  });

  it('prints one from a child logger, which is the only kind an agent is given', () => {
    // `MastraBase.__setLogger` hands every agent `logger.child({ component })`, and Pino
    // builds that child from its own class. A root-only fix reaches nothing that reports
    // a delegation failure.
    const child = createLogger('test').child({ component: 'AGENT' });
    const printed = mock();
    child.error = printed;

    child.trackException(new Error('boom'));

    expect(printed).toHaveBeenCalledTimes(1);
  });

  it('keeps printing however deep the child chain goes', () => {
    const grandchild = createLogger('test').child({ component: 'AGENT' }).child({ runId: 'abc' });
    const printed = mock();
    grandchild.error = printed;

    grandchild.trackException(new Error('boom'));

    expect(printed).toHaveBeenCalledTimes(1);
  });

  it('carries the cause, which is the only place the real failure is kept', () => {
    const cause = new Error('Could not load the default credentials');
    const wrapper = new Error('[Agent:RoutingSupervisor] - Failed agent tool execution for calendar', { cause });

    const unwrapped = unwrapErrors({ error: wrapper }) as { error: { cause: { message: string } } };

    expect(unwrapped.error.cause.message).toBe('Could not load the default credentials');
  });
});

/**
 * Printing a failure answers "what went wrong" only for whoever is watching the terminal at
 * the time, and nothing Mastra reports about itself is a run, so none of it is in a trace
 * either. The ring in `diagnostics.ts` is the only copy anything inside the system can
 * read back — see the reflection vertical's `listRuntimeErrors`.
 */
describe('createLogger, recording what it is told', () => {
  beforeEach(() => {
    clearDiagnostics();
  });

  it('keeps an error with the fields it was logged with, errors unwrapped', () => {
    createLogger('Mastra').error('Scheduled workflow failed', {
      scheduleId: 'sched_abc',
      error: new Error('This workflow run was not active'),
    });

    const [record] = recentDiagnostics();
    expect(record).toMatchObject({ level: 'error', component: 'Mastra', message: 'Scheduled workflow failed' });
    // `unwrapErrors` has already run, so the reason survives rather than serializing to `{}`.
    expect(record.details).toMatchObject({
      scheduleId: 'sched_abc',
      error: { message: 'This workflow run was not active' },
    });
  });

  it('keeps a warning, which is how a retired workflow run reports itself', () => {
    createLogger('Mastra').warn('Retired a workflow run the current workflow cannot resume', {
      workflow: 'emailCheckingWorkflow',
    });

    expect(recentDiagnostics()[0]).toMatchObject({ level: 'warn', message: expect.stringContaining('Retired') });
  });

  it('keeps one from a child logger, which is the only kind an agent is given', () => {
    createLogger('Mastra').child({ component: 'AGENT' }).error('Failed agent tool execution for calendar');

    expect(recentDiagnostics()[0]).toMatchObject({ component: 'AGENT' });
  });

  it('keeps a tracked exception, which Pino would otherwise forward into the void', () => {
    createLogger('Mastra').trackException(new Error('Could not load the default credentials'));

    const [record] = recentDiagnostics();
    expect(record.level).toBe('error');
    expect(record.details).toMatchObject({ error: { message: 'Could not load the default credentials' } });
  });

  it('leaves info alone, so the ring holds failures rather than traffic', () => {
    createLogger('Mastra').info('Server started on port 4111');

    expect(recentDiagnostics()).toEqual([]);
  });
});
