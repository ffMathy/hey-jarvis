import { describe, expect, it } from 'bun:test';
import { REFRACTORY_CHUNKS } from './detection-gate';
import { MAXIMUM_WAITING } from './serial-queue';
import { CHUNK_SAMPLES, EMBEDDING_SIZE, MEL_BINS, melFrameCount, type WakeModels } from './wake-pipeline';
import { createWakeWorkerCore, type FrameSource, STATS_INTERVAL_MILLISECONDS } from './wake-worker-core';
import type { WakeWorkerEvent } from './worker-protocol';

/**
 * The worker's behaviour with fake graphs, a fake frames port and a hand-driven clock.
 *
 * The fake classifier scores a chunk by its first sample: chunks of 30000 score 0.9, anything
 * else 0.01 — so a test says "hey jarvis" by sending a loud chunk.
 */

const LOUD = 30000;

function fakeModels(options: { failEmbedding?: boolean; hold?: () => Promise<void> | undefined } = {}): WakeModels {
  let lastLoud = false;
  return {
    async melspectrogram(samples) {
      await options.hold?.();
      lastLoud = samples.at(-1) === LOUD;
      return new Float32Array(melFrameCount(samples.length) * MEL_BINS);
    },
    async embed() {
      if (options.failEmbedding) throw new Error('embedding exploded');
      return new Float32Array(EMBEDDING_SIZE);
    },
    async classify() {
      return lastLoud ? 0.9 : 0.01;
    },
  };
}

interface FakeSource extends FrameSource {
  closed: boolean;
  send(data: unknown): void;
}

function fakeSource(): FakeSource {
  const source: FakeSource = {
    onmessage: null,
    closed: false,
    close() {
      source.closed = true;
    },
    send(data) {
      source.onmessage?.(new MessageEvent('message', { data }));
    },
  };
  return source;
}

function harness(models: WakeModels = fakeModels(), loadError?: Error) {
  const events: WakeWorkerEvent[] = [];
  const timers: Array<() => void> = [];
  let clock = 0;
  const core = createWakeWorkerCore({
    async loadModels(_assetBase, onProgress) {
      onProgress(0.5);
      if (loadError !== undefined) throw loadError;
      onProgress(1);
      return models;
    },
    post: (event) => events.push(event),
    now: () => {
      clock += 4;
      return clock;
    },
    setInterval: (callback, milliseconds) => {
      expect(milliseconds).toBe(STATS_INTERVAL_MILLISECONDS);
      timers.push(callback);
      return setTimeout(() => undefined, 0);
    },
    clearInterval: () => {
      timers.length = 0;
    },
    random: () => 0.5,
  });
  const ofType = <Type extends WakeWorkerEvent['type']>(type: Type) =>
    events.filter((event): event is Extract<WakeWorkerEvent, { type: Type }> => event.type === type);
  return { core, events, timers, ofType };
}

/** Waits until the worker has finished loading, one way or the other. */
async function loadingOver(events: WakeWorkerEvent[]) {
  const over = () =>
    events.some((event) => event.type === 'failed' || (event.type === 'phase' && event.phase === 'ready'));
  while (!over()) await Bun.sleep(1);
}

async function loaded(models?: WakeModels) {
  const context = harness(models);
  context.core.handle({ type: 'load', assetBase: 'http://localhost/hey-jarvis/vr/' });
  await loadingOver(context.events);
  return context;
}

function chunk(value = 100) {
  return new Int16Array(CHUNK_SAMPLES).fill(value);
}

describe('the wake worker', () => {
  it('reports loading, then warming, then ready, with progress up to 1', async () => {
    const { ofType } = await loaded();
    expect(ofType('phase').map((event) => event.phase)).toEqual(['loading', 'warming', 'ready']);
    const fractions = ofType('progress').map((event) => event.fraction);
    expect(fractions).toEqual([0.45, 0.9, 1]);
  });

  it('reports a failed load in words, once', async () => {
    const { core, events, ofType } = harness(fakeModels(), new Error('models/melspectrogram.onnx (HTTP 404)'));
    core.handle({ type: 'load', assetBase: 'http://localhost/' });
    await loadingOver(events);
    core.handle({ type: 'load', assetBase: 'http://localhost/' });
    await Bun.sleep(5);
    expect(ofType('failed').map((event) => event.message)).toEqual([
      'Jarvis could not load his wake word: models/melspectrogram.onnx (HTTP 404)',
    ]);
  });

  it('counts chunks while disarmed without scoring them', async () => {
    const { core, ofType, timers } = await loaded();
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    for (let index = 0; index < 4; index++) source.send(chunk());
    await core.idle();
    timers[0]();
    const last = ofType('stats').at(-1);
    expect(last?.generation).toBe(1);
    expect(last?.counters).toMatchObject({ processed: 4, scored: 0, dropped: 0 });
    expect(last?.counters.level).toBeCloseTo(100 / 32768, 6);
  });

  it('scores chunks once armed, and wakes on "hey jarvis" after the refractory period', async () => {
    const { core, ofType, timers } = await loaded();
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    core.handle({ type: 'arm' });
    for (let index = 0; index < REFRACTORY_CHUNKS; index++) {
      source.send(chunk());
      await core.idle();
    }
    source.send(chunk(LOUD));
    await core.idle();
    expect(ofType('wake').map((event) => event.score)).toEqual([0.9]);
    timers[0]();
    const counters = ofType('stats').at(-1)?.counters;
    expect(counters).toMatchObject({ processed: REFRACTORY_CHUNKS + 1, scored: REFRACTORY_CHUNKS + 1, score: 0.9 });
    // The fake clock moves 4 ms per reading: every chunk took 4 ms.
    expect(counters?.inferenceMilliseconds).toBe(4 * (REFRACTORY_CHUNKS + 1));
  });

  it('does not wake while disarmed, however loud', async () => {
    const { core, ofType } = await loaded();
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    core.handle({ type: 'arm' });
    core.handle({ type: 'disarm' });
    for (let index = 0; index < 40; index++) {
      source.send(chunk(LOUD));
      await core.idle();
    }
    expect(ofType('wake')).toEqual([]);
  });

  it('ignores anything on the port that is not a 1280-sample int16 frame', async () => {
    const { core, ofType, timers } = await loaded();
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    source.send('hello');
    source.send(new Int16Array(128));
    await core.idle();
    timers[0]();
    expect(ofType('stats').at(-1)?.counters.processed).toBe(0);
  });

  it('counts consecutive chunks of exact silence', async () => {
    const { core, ofType, timers } = await loaded();
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    for (const value of [0, 0, 5, 0, 0, 0]) {
      source.send(chunk(value));
      await core.idle();
    }
    timers[0]();
    expect(ofType('stats').at(-1)?.counters).toMatchObject({ silentChunks: 3, level: 0 });
  });

  it('drops the oldest chunks when the models fall behind, and counts them', async () => {
    let release: () => void = () => undefined;
    let held: Promise<void> | undefined;
    const { core, ofType, timers } = await loaded(fakeModels({ hold: () => held }));
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    core.handle({ type: 'arm' });
    await core.idle();
    for (let index = 0; index < 8; index++) source.send(chunk());
    release();
    await core.idle();
    timers[0]();
    // The first chunk ran; of the seven waiting behind it, the newest three were kept.
    expect(ofType('stats').at(-1)?.counters).toMatchObject({ dropped: 8 - 1 - MAXIMUM_WAITING, scored: 4 });
  });

  it('starts counting afresh on a new port, and closes the old one', async () => {
    const { core, ofType, timers } = await loaded();
    const first = fakeSource();
    core.handle({ type: 'listen', port: first, generation: 1 });
    first.send(chunk());
    await core.idle();
    const second = fakeSource();
    core.handle({ type: 'listen', port: second, generation: 2 });
    expect(first.closed).toBe(true);
    expect(first.onmessage).toBeNull();
    second.send(chunk());
    await core.idle();
    timers[0]();
    const last = ofType('stats').at(-1);
    expect(last?.generation).toBe(2);
    expect(last?.counters.processed).toBe(1);
  });

  it('stops reporting when told to stop listening', async () => {
    const { core, timers } = await loaded();
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    expect(timers).toHaveLength(1);
    core.handle({ type: 'unlisten' });
    expect(source.closed).toBe(true);
    expect(timers).toHaveLength(0);
  });

  it('reports models that fail their warm-up as a failed load', async () => {
    const context = harness(fakeModels({ failEmbedding: true }));
    context.core.handle({ type: 'load', assetBase: 'http://localhost/' });
    await loadingOver(context.events);
    expect(context.ofType('failed')[0]?.message).toBe('Jarvis could not load his wake word: embedding exploded');
  });

  it('reports a failure while scoring as the wake word having stopped', async () => {
    let fail = false;
    const models = fakeModels();
    const flaky: WakeModels = {
      ...models,
      async embed(window) {
        if (fail) throw new Error('out of memory');
        return models.embed(window);
      },
    };
    const { core, ofType } = await loaded(flaky);
    const source = fakeSource();
    core.handle({ type: 'listen', port: source, generation: 1 });
    core.handle({ type: 'arm' });
    fail = true;
    source.send(chunk());
    source.send(chunk());
    await core.idle();
    expect(ofType('failed').map((event) => event.message)).toEqual(['The wake word stopped working: out of memory']);
  });
});
