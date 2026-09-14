import { describe, expect, it } from 'bun:test';
import { unwrapErrors } from './logger';

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
