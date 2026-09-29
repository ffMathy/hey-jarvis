import { describe, expect, it } from 'bun:test';
import {
  createStatsHistory,
  judgeWakeHealth,
  MUTED_AFTER_SILENT_CHUNKS,
  type StatsRates,
  WAKE_PROBLEMS,
  type WakeObservation,
  type WorkerCounters,
} from './wake-health';

function counters(overrides: Partial<WorkerCounters> = {}): WorkerCounters {
  return {
    processed: 0,
    scored: 0,
    inferenceMilliseconds: 0,
    dropped: 0,
    silentChunks: 0,
    level: 0.05,
    score: 0,
    ...overrides,
  };
}

/** Rates as a healthy stream two seconds into listening, scored and reporting just now. */
function healthyRates(now: number, overrides: Partial<StatsRates> = {}): StatsRates {
  return {
    latest: { at: now - 100, counters: counters({ processed: 100, scored: 100, inferenceMilliseconds: 800 }) },
    chunksPerSecond: 12.5,
    millisecondsPerChunk: 8,
    span: 2000,
    lastProgressAt: now - 100,
    ...overrides,
  };
}

const NOW = 100000;

/** A started, armed, flowing, scored engine; each test breaks one thing. */
function observation(overrides: Partial<WakeObservation> = {}): WakeObservation {
  return {
    now: NOW,
    models: { phase: 'ready' },
    audio: { startedAt: NOW - 60000, track: 'live', trackMuted: false, context: 'running' },
    stats: healthyRates(NOW),
    armed: true,
    recovery: { running: false },
    ...overrides,
  };
}

describe('judging the wake engine', () => {
  it('is listening when a scored stream is flowing, with nothing to say', () => {
    expect(judgeWakeHealth(observation())).toEqual({
      state: 'listening',
      problem: undefined,
      needsGesture: false,
      recover: false,
    });
  });

  it('reports the models’ progress before anything else', () => {
    expect(judgeWakeHealth(observation({ models: { phase: 'unloaded' } }))).toMatchObject({
      state: 'unloaded',
      problem: WAKE_PROBLEMS.notLoaded,
    });
    expect(judgeWakeHealth(observation({ models: { phase: 'loading' } }))).toMatchObject({
      state: 'loading',
      problem: WAKE_PROBLEMS.loading,
    });
    expect(judgeWakeHealth(observation({ models: { phase: 'warming' } }))).toMatchObject({ state: 'warming' });
  });

  it('is broken when the models failed, with their reason, and leaves retrying to rebuild', () => {
    const judged = judgeWakeHealth(observation({ models: { phase: 'failed', problem: 'HTTP 404' } }));
    expect(judged).toEqual({ state: 'broken', problem: 'HTTP 404', needsGesture: false, recover: false });
  });

  it('is ready but not listening before it has been started, and after it was stopped', () => {
    expect(judgeWakeHealth(observation({ audio: undefined }))).toMatchObject({
      state: 'ready',
      problem: WAKE_PROBLEMS.notStarted,
      recover: false,
    });
  });

  it('says it is reconnecting while a recovery runs', () => {
    expect(judgeWakeHealth(observation({ recovery: { running: true } }))).toMatchObject({
      state: 'ready',
      problem: WAKE_PROBLEMS.reconnecting,
      recover: false,
    });
  });

  it('is only listening once the models have scored live audio', () => {
    const unscored = healthyRates(NOW, {
      latest: { at: NOW - 100, counters: counters({ processed: 100, scored: 0 }) },
    });
    expect(judgeWakeHealth(observation({ stats: unscored }))).toMatchObject({
      state: 'ready',
      problem: WAKE_PROBLEMS.starting,
    });
    expect(judgeWakeHealth(observation({ stats: unscored, armed: false }))).toMatchObject({
      state: 'ready',
      problem: WAKE_PROBLEMS.disarmed,
    });
  });

  it('stays listening while disarmed, as long as the stream keeps flowing', () => {
    expect(judgeWakeHealth(observation({ armed: false })).state).toBe('listening');
  });

  it('gives a fresh stream time to start', () => {
    const justStarted = observation({
      audio: { startedAt: NOW - 1000, track: 'live', trackMuted: false, context: 'suspended' },
      stats: { latest: undefined, chunksPerSecond: 0, millisecondsPerChunk: 0, span: 0, lastProgressAt: undefined },
    });
    expect(judgeWakeHealth(justStarted)).toMatchObject({ state: 'ready', problem: WAKE_PROBLEMS.starting });
    const runningNoChunksYet = observation({
      audio: { startedAt: NOW - 1000, track: 'live', trackMuted: false, context: 'running' },
      stats: { latest: undefined, chunksPerSecond: 0, millisecondsPerChunk: 0, span: 0, lastProgressAt: undefined },
    });
    expect(judgeWakeHealth(runningNoChunksYet)).toMatchObject({ state: 'ready', recover: false });
  });

  it('recovers when the microphone track ended', () => {
    const judged = judgeWakeHealth(
      observation({ audio: { startedAt: 0, track: 'ended', trackMuted: false, context: 'running' } }),
    );
    expect(judged).toMatchObject({ state: 'broken', problem: WAKE_PROBLEMS.stopped, recover: true });
  });

  it('recovers when the audio context is suspended, interrupted or closed', () => {
    for (const context of ['suspended', 'interrupted', 'closed']) {
      const judged = judgeWakeHealth(
        observation({ audio: { startedAt: 0, track: 'live', trackMuted: false, context } }),
      );
      expect(judged).toMatchObject({ state: 'broken', problem: WAKE_PROBLEMS.stopped, recover: true });
    }
  });

  it('waits out a muted track rather than opening another', () => {
    const judged = judgeWakeHealth(
      observation({ audio: { startedAt: 0, track: 'live', trackMuted: true, context: 'running' } }),
    );
    expect(judged).toMatchObject({ state: 'ready', problem: WAKE_PROBLEMS.muted, recover: false });
  });

  it('recovers when chunks stop for more than a second', () => {
    const stalled = healthyRates(NOW, { lastProgressAt: NOW - 1500 });
    expect(judgeWakeHealth(observation({ stats: stalled }))).toMatchObject({
      state: 'broken',
      problem: WAKE_PROBLEMS.stopped,
      recover: true,
    });
  });

  it('recovers when the worker stops reporting', () => {
    const silentWorker = healthyRates(NOW, {
      latest: { at: NOW - 3500, counters: counters({ processed: 100, scored: 100 }) },
      lastProgressAt: NOW - 800,
    });
    expect(judgeWakeHealth(observation({ stats: silentWorker }))).toMatchObject({ state: 'broken', recover: true });
  });

  it('calls ten seconds of exact zeros a muted microphone, and tries a fresh capture', () => {
    const zeros = healthyRates(NOW, {
      latest: {
        at: NOW - 100,
        counters: counters({ processed: 200, scored: 200, silentChunks: MUTED_AFTER_SILENT_CHUNKS, level: 0 }),
      },
    });
    expect(judgeWakeHealth(observation({ stats: zeros }))).toMatchObject({
      state: 'ready',
      problem: WAKE_PROBLEMS.muted,
      recover: true,
    });
    const quietRoom = healthyRates(NOW, {
      latest: {
        at: NOW - 100,
        counters: counters({ processed: 200, scored: 200, silentChunks: MUTED_AFTER_SILENT_CHUNKS - 1, level: 0 }),
      },
    });
    expect(judgeWakeHealth(observation({ stats: quietRoom })).state).toBe('listening');
  });

  it('says so when the stream is falling behind, over a full window only', () => {
    expect(judgeWakeHealth(observation({ stats: healthyRates(NOW, { chunksPerSecond: 6 }) }))).toMatchObject({
      state: 'ready',
      problem: WAKE_PROBLEMS.fallingBehind,
      recover: false,
    });
    expect(judgeWakeHealth(observation({ stats: healthyRates(NOW, { chunksPerSecond: 6, span: 500 }) })).state).toBe(
      'listening',
    );
  });

  it('shows the last recovery’s failure until the stream is flowing again', () => {
    const failure = { problem: WAKE_PROBLEMS.stopped, needsGesture: true };
    const stillStopped = observation({
      audio: { startedAt: 0, track: 'live', trackMuted: false, context: 'suspended' },
      recovery: { running: false, failure },
    });
    expect(judgeWakeHealth(stillStopped)).toEqual({
      state: 'broken',
      problem: WAKE_PROBLEMS.stopped,
      needsGesture: true,
      recover: true,
    });
    // The context came back on its own: listening, whatever the last attempt said.
    expect(judgeWakeHealth(observation({ recovery: { running: false, failure } })).state).toBe('listening');
  });
});

describe('the stats history', () => {
  it('measures chunks per second and time per chunk between reports across the window', () => {
    const history = createStatsHistory(2000);
    for (let report = 0; report <= 12; report++) {
      history.record(
        report * 250,
        counters({ processed: report * 3, scored: report * 3, inferenceMilliseconds: report * 30 }),
      );
    }
    const rates = history.rates();
    // 3 chunks per 250 ms: 12 per second, 10 ms each, over the last 2 s and the report before them.
    expect(rates.chunksPerSecond).toBeCloseTo(12, 6);
    expect(rates.millisecondsPerChunk).toBeCloseTo(10, 6);
    expect(rates.span).toBe(2250);
    expect(rates.lastProgressAt).toBe(3000);
    expect(rates.latest?.at).toBe(3000);
  });

  it('remembers when chunks last moved, and the last time per chunk while nothing is scored', () => {
    const history = createStatsHistory(2000);
    history.record(0, counters({ processed: 10, scored: 10, inferenceMilliseconds: 100 }));
    history.record(250, counters({ processed: 13, scored: 13, inferenceMilliseconds: 130 }));
    expect(history.rates().millisecondsPerChunk).toBeCloseTo(10, 6);
    // Disarmed: chunks still flow but none is scored.
    for (let report = 2; report <= 20; report++) {
      history.record(report * 250, counters({ processed: 13 + report, scored: 13, inferenceMilliseconds: 130 }));
    }
    history.record(5250, counters({ processed: 33, scored: 13, inferenceMilliseconds: 130 }));
    const rates = history.rates();
    expect(rates.millisecondsPerChunk).toBeCloseTo(10, 6);
    expect(rates.lastProgressAt).toBe(5000);
  });

  it('has nothing to say with fewer than two reports, or after being cleared', () => {
    const history = createStatsHistory();
    expect(history.rates()).toMatchObject({ chunksPerSecond: 0, span: 0, latest: undefined });
    history.record(100, counters({ processed: 1 }));
    expect(history.rates()).toMatchObject({ chunksPerSecond: 0, span: 0, lastProgressAt: 100 });
    history.clear();
    expect(history.rates()).toMatchObject({ latest: undefined, lastProgressAt: undefined });
  });
});
