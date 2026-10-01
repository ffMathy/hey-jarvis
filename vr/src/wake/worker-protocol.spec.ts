import { describe, expect, it } from 'bun:test';
import { toWakeWorkerEvent, toWakeWorkerRequest } from './worker-protocol';

const COUNTERS = {
  processed: 1,
  scored: 1,
  inferenceMilliseconds: 8,
  dropped: 0,
  silentChunks: 0,
  level: 0.1,
  score: 0,
};

describe('messages to the wake worker', () => {
  it('reads every request', () => {
    expect(toWakeWorkerRequest({ type: 'load', assetBase: 'http://localhost/' })).toEqual({
      type: 'load',
      assetBase: 'http://localhost/',
    });
    const { port1 } = new MessageChannel();
    expect(toWakeWorkerRequest({ type: 'listen', port: port1, generation: 3 })).toEqual({
      type: 'listen',
      port: port1,
      generation: 3,
    });
    for (const type of ['unlisten', 'arm', 'disarm'] as const) expect(toWakeWorkerRequest({ type })).toEqual({ type });
    port1.close();
  });

  it('refuses anything else', () => {
    for (const value of [
      null,
      'load',
      7,
      {},
      { type: 'load' },
      { type: 'listen', port: {}, generation: 1 },
      { type: 'x' },
    ]) {
      expect(toWakeWorkerRequest(value)).toBeUndefined();
    }
  });
});

describe('messages from the wake worker', () => {
  it('reads every event', () => {
    expect(toWakeWorkerEvent({ type: 'phase', phase: 'warming' })).toEqual({ type: 'phase', phase: 'warming' });
    expect(toWakeWorkerEvent({ type: 'progress', fraction: 0.5 })).toEqual({ type: 'progress', fraction: 0.5 });
    expect(toWakeWorkerEvent({ type: 'failed', message: 'no' })).toEqual({ type: 'failed', message: 'no' });
    expect(toWakeWorkerEvent({ type: 'wake', score: 0.93 })).toEqual({ type: 'wake', score: 0.93 });
    expect(toWakeWorkerEvent({ type: 'stats', generation: 2, counters: COUNTERS })).toEqual({
      type: 'stats',
      generation: 2,
      counters: COUNTERS,
    });
  });

  it('refuses anything else, including counters with a field missing or not a number', () => {
    const { level: _level, ...missingLevel } = COUNTERS;
    for (const value of [
      undefined,
      { type: 'phase', phase: 'dancing' },
      { type: 'progress', fraction: Number.NaN },
      { type: 'wake' },
      { type: 'stats', generation: 1, counters: missingLevel },
      { type: 'stats', generation: 1, counters: { ...COUNTERS, score: '0.5' } },
      { type: 'stats', counters: COUNTERS },
    ]) {
      expect(toWakeWorkerEvent(value)).toBeUndefined();
    }
  });
});
