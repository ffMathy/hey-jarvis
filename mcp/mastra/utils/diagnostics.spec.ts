import { beforeEach, describe, expect, it } from 'bun:test';
import { clearDiagnostics, diagnosticCount, recentDiagnostics, rememberDiagnostic } from './diagnostics';

/**
 * The ring exists because Mastra's own failures had nowhere to go but the console — see the
 * file header. These tests pin the two properties that make it safe to leave running for
 * the life of a process: it is bounded, and it cannot break the logger it sits inside.
 */
describe('rememberDiagnostic', () => {
  beforeEach(() => {
    clearDiagnostics();
  });

  it('keeps what was reported, with the component that reported it', () => {
    rememberDiagnostic('error', 'Scheduled workflow failed', { scheduleId: 'sched_abc' }, { component: 'Mastra' });

    const [record] = recentDiagnostics();
    expect(record).toMatchObject({
      level: 'error',
      component: 'Mastra',
      message: 'Scheduled workflow failed',
      details: { scheduleId: 'sched_abc' },
    });
    expect(Date.parse(record.at)).not.toBeNaN();
  });

  it('returns the newest first, which is the one being asked about', () => {
    rememberDiagnostic('error', 'first');
    rememberDiagnostic('error', 'second');
    rememberDiagnostic('error', 'third');

    expect(recentDiagnostics().map((record) => record.message)).toEqual(['third', 'second', 'first']);
  });

  it('drops the oldest rather than growing without bound', () => {
    for (let index = 0; index < 250; index++) {
      rememberDiagnostic('warn', `report-${index}`);
    }

    expect(diagnosticCount()).toBe(200);
    // The 50 oldest are gone; the newest is still the one just reported.
    expect(recentDiagnostics({ limit: 1 })[0]?.message).toBe('report-249');
  });

  it('cuts a stack trace down rather than holding two hundred of them whole', () => {
    rememberDiagnostic('error', 'boom', { stack: 'x'.repeat(10_000) });

    const { details } = recentDiagnostics()[0];
    const stack = details?.stack as string;
    expect(stack.length).toBeLessThan(2100);
    expect(stack).toEndWith('(truncated)');
  });

  it('filters by level, so "is anything actually broken" is answerable', () => {
    rememberDiagnostic('warn', 'Retired a workflow run');
    rememberDiagnostic('error', 'Scheduled workflow failed');

    expect(recentDiagnostics({ level: 'error' }).map((record) => record.message)).toEqual([
      'Scheduled workflow failed',
    ]);
  });

  it('filters by time, so a lookback window means something', () => {
    rememberDiagnostic('error', 'old');

    // Records are stamped in ISO-8601, which resolves no finer than a millisecond, and two
    // calls in a row land inside the same one. So the clock is waited out rather than
    // merely read: without this the two records share a timestamp and which side of the
    // boundary each falls on is a coin toss.
    const boundary = Date.parse(recentDiagnostics()[0].at) + 1;
    let now = Date.now();
    while (now < boundary) {
      now = Date.now();
    }

    rememberDiagnostic('error', 'new');

    expect(recentDiagnostics({ since: new Date(boundary) }).map((record) => record.message)).toEqual(['new']);
  });

  it('leaves out the details bag entirely when nothing was logged beside the message', () => {
    rememberDiagnostic('warn', 'nothing else to say', {});

    expect(recentDiagnostics()[0]).not.toHaveProperty('details');
  });

  it('survives a value that will not serialize, because a log line must not fail', () => {
    const cyclic: Record<string, unknown> = { runId: 'abc' };
    cyclic.self = cyclic;

    expect(() => rememberDiagnostic('error', 'boom', cyclic)).not.toThrow();
    expect(diagnosticCount()).toBe(1);
  });

  it('is emptied by clearDiagnostics, so one test cannot read the failures of another', () => {
    rememberDiagnostic('error', 'boom');
    clearDiagnostics();

    expect(recentDiagnostics()).toEqual([]);
    expect(diagnosticCount()).toBe(0);
  });
});
