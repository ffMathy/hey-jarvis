import { describe, expect, it } from 'bun:test';
import { MICROPHONE_BLOCKED } from './microphone';
import type { MicrophonePermission, WakeHealth } from './types';
import {
  assembleWakeEngine,
  FIRST_RECOVERY_DELAY_MILLISECONDS,
  type WakeAudioGraph,
  type WakeStream,
  type WakeTrack,
  type WakeWorkerHandle,
} from './wake-engine';
import { WAKE_PROBLEMS, WATCHDOG_INTERVAL_MILLISECONDS, type WorkerCounters } from './wake-health';
import type { WakeWorkerEvent, WakeWorkerRequest } from './worker-protocol';

/**
 * The engine against fakes of everything it touches: a worker that says what it is told to, an
 * audio graph whose context state the test sets, microphone tracks the test ends and mutes, and
 * a clock and watchdog the test drives by hand.
 */

class FakeTrack extends EventTarget implements WakeTrack {
  readyState: 'live' | 'ended' = 'live';
  muted = false;
  stopped = false;
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.dispatchEvent(new Event(muted ? 'mute' : 'unmute'));
  }
}

class FakeStream implements WakeStream {
  readonly track = new FakeTrack();
  getAudioTracks() {
    return [this.track];
  }
  getTracks() {
    return [this.track];
  }
}

class FakeGraph implements WakeAudioGraph<FakeStream> {
  state = 'running';
  sampleRate = 16000;
  failed = false;
  ready = Promise.resolve();
  /** Whether `resume` works, as it would inside a gesture or with the page already activated. */
  resumable = true;
  resumes = 0;
  closed = false;
  readonly ports: MessagePort[] = [];
  readonly streams: Array<FakeStream | undefined> = [];
  private readonly listeners: Array<() => void> = [];
  sendFramesTo(port: MessagePort) {
    this.ports.push(port);
  }
  listen(stream: FakeStream | undefined) {
    this.streams.push(stream);
  }
  resume() {
    this.resumes++;
    if (!this.resumable) return new Promise<void>(() => undefined);
    this.setState('running');
    return Promise.resolve();
  }
  onStateChange(listener: () => void) {
    this.listeners.push(listener);
  }
  setState(state: string) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  close() {
    this.closed = true;
    this.state = 'closed';
  }
}

class FakeWorker implements WakeWorkerHandle {
  readonly requests: WakeWorkerRequest[] = [];
  terminated = false;
  constructor(
    readonly emit: (event: WakeWorkerEvent) => void,
    readonly crash: (message: string) => void,
  ) {}
  post(request: WakeWorkerRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  types() {
    return this.requests.map((request) => request.type);
  }
  /** The generation of the latest port it was told to listen to. */
  generation() {
    const listens = this.requests.filter((request) => request.type === 'listen');
    const last = listens.at(-1);
    return last?.type === 'listen' ? last.generation : 0;
  }
  ready() {
    this.emit({ type: 'phase', phase: 'warming' });
    this.emit({ type: 'phase', phase: 'ready' });
  }
}

function counters(overrides: Partial<WorkerCounters> = {}): WorkerCounters {
  return {
    processed: 0,
    scored: 0,
    inferenceMilliseconds: 0,
    dropped: 0,
    silentChunks: 0,
    level: 0.05,
    score: 0.01,
    ...overrides,
  };
}

async function flush() {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function scenario(options: { permission?: MicrophonePermission } = {}) {
  const workers: FakeWorker[] = [];
  const graphs: FakeGraph[] = [];
  const opened: FakeStream[] = [];
  const healths: WakeHealth[] = [];
  let permission: MicrophonePermission = options.permission ?? 'granted';
  let clock = 1000;
  let tick: (() => void) | undefined;
  const engine = assembleWakeEngine<FakeStream>({
    assetBase: new URL('https://ffmathy.github.io/hey-jarvis/horizon/'),
    profile: 'processed',
    spawnWorker(onEvent, onCrash) {
      const worker = new FakeWorker(onEvent, onCrash);
      workers.push(worker);
      return worker;
    },
    createAudioGraph() {
      const graph = new FakeGraph();
      graphs.push(graph);
      return graph;
    },
    async openMicrophone(profile) {
      expect(profile).toBe('processed');
      const stream = new FakeStream();
      opened.push(stream);
      return stream;
    },
    microphonePermission: async () => permission,
    now: () => clock,
    setInterval: (callback, milliseconds) => {
      expect(milliseconds).toBe(WATCHDOG_INTERVAL_MILLISECONDS);
      tick = callback;
      return setTimeout(() => undefined, 0);
    },
    clearInterval: () => {
      tick = undefined;
    },
    setTimeout: (callback) => setTimeout(callback, 0),
  });
  engine.onHealth((health) => healths.push(health));

  const context = {
    engine,
    workers,
    graphs,
    opened,
    healths,
    worker: () => {
      const worker = workers.at(-1);
      if (worker === undefined) throw new Error('No worker was started.');
      return worker;
    },
    graph: () => {
      const graph = graphs.at(-1);
      if (graph === undefined) throw new Error('No audio graph was made.');
      return graph;
    },
    setPermission(next: MicrophonePermission) {
      permission = next;
    },
    isWatching() {
      return tick !== undefined;
    },
    /**
     * Moves the clock on, one watchdog tick at a time, with no chunks arriving. The worker goes on
     * reporting its unchanged counters, as the real one does while its port is quiet, unless it
     * is `silent`.
     */
    async advance(milliseconds: number, worker: 'reporting' | 'silent' = 'reporting') {
      for (let passed = 0; passed < milliseconds; passed += WATCHDOG_INTERVAL_MILLISECONDS) {
        clock += WATCHDOG_INTERVAL_MILLISECONDS;
        const current = workers.at(-1);
        if (worker === 'reporting' && current !== undefined && current.generation() > 0) report(current, 0, {});
        tick?.();
        await flush();
      }
    },
    /**
     * The page held up for `milliseconds` while the audio went on: the clock moves on with no
     * report read, the watchdog's overdue tick fires first, and then the worker's reports from
     * meanwhile — every chunk it went on scoring — are read.
     */
    async holdUpPage(milliseconds: number) {
      clock += milliseconds;
      tick?.();
      report(context.worker(), Math.round(milliseconds / 80), {});
      await flush();
    },
    /** The worker reporting a healthy, scored stream for `milliseconds`, four times a second. */
    async flow(milliseconds: number, overrides: Partial<WorkerCounters> = {}) {
      const worker = context.worker();
      for (let passed = 0; passed < milliseconds; passed += 250) {
        clock += 250;
        report(worker, 3, overrides);
        if ((passed + 250) % WATCHDOG_INTERVAL_MILLISECONDS === 0) tick?.();
      }
      await flush();
    },
  };

  // What the fake worker has counted on its current port; a new port starts again from zero, as
  // the real worker's counters do.
  let processed = 0;
  let countedGeneration = 0;
  function report(worker: FakeWorker, newChunks: number, overrides: Partial<WorkerCounters>) {
    if (worker.generation() !== countedGeneration) {
      countedGeneration = worker.generation();
      processed = 0;
    }
    processed += newChunks;
    worker.emit({
      type: 'stats',
      generation: worker.generation(),
      counters: counters({ processed, scored: processed, inferenceMilliseconds: processed * 8, ...overrides }),
    });
  }
  return context;
}

/**
 * A scenario that has loaded, started on `stream`, armed, and been hearing scored chunks for
 * longer than a fresh stream's grace period — so every failure is judged as one.
 */
async function listening(options: { permission?: MicrophonePermission } = {}) {
  const context = scenario(options);
  const stream = new FakeStream();
  const preparing = context.engine.prepare();
  context.worker().ready();
  await preparing;
  await context.engine.start(stream);
  context.engine.arm();
  await context.flow(3500);
  expect(context.engine.health.state).toBe('listening');
  return { ...context, stream };
}

describe('loading the wake engine', () => {
  it('loads the models in a worker from under the page, with progress', async () => {
    const { engine, worker, healths } = scenario();
    const progress: number[] = [];
    const preparing = engine.prepare((fraction) => progress.push(fraction));
    expect(worker().requests).toEqual([{ type: 'load', assetBase: 'https://ffmathy.github.io/hey-jarvis/horizon/' }]);
    worker().emit({ type: 'progress', fraction: 0.4 });
    worker().ready();
    await preparing;
    expect(progress).toEqual([0.4, 1]);
    expect(healths.map((health) => health.state)).toEqual(['loading', 'warming', 'ready']);
    expect(engine.health.problem).toBe(WAKE_PROBLEMS.notStarted);
  });

  it('loads once, however many times it is asked', async () => {
    const { engine, workers } = scenario();
    const first = engine.prepare();
    const second = engine.prepare();
    expect(workers).toHaveLength(1);
    workers[0].ready();
    await Promise.all([first, second]);
    const progress: number[] = [];
    await engine.prepare((fraction) => progress.push(fraction));
    expect(progress).toEqual([1]);
    expect(workers[0].types()).toEqual(['load']);
  });

  it('is broken with the worker’s words when loading fails, and rebuild starts a new worker', async () => {
    const { engine, workers } = scenario();
    const preparing = engine.prepare();
    workers[0].emit({ type: 'failed', message: 'Jarvis could not load his wake word: HTTP 404' });
    await expect(preparing).rejects.toThrow('HTTP 404');
    expect(workers[0].terminated).toBe(true);
    expect(engine.health).toMatchObject({ state: 'broken', problem: 'Jarvis could not load his wake word: HTTP 404' });

    const rebuilding = engine.rebuild();
    expect(workers).toHaveLength(2);
    workers[1].ready();
    await rebuilding;
    expect(engine.health.state).toBe('ready');
  });

  it('starts a new worker on its own when the models fail after running', async () => {
    const context = await listening();
    context.worker().emit({ type: 'failed', message: 'The wake word stopped working: out of memory' });
    expect(context.engine.health).toMatchObject({
      state: 'broken',
      problem: 'The wake word stopped working: out of memory',
    });
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.workers).toHaveLength(2);
    context.worker().ready();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.worker().types()).toEqual(['load', 'arm', 'listen']);
  });

  it('treats a crashed worker as failed models', async () => {
    const { engine, workers } = scenario();
    const preparing = engine.prepare();
    workers[0].crash('SyntaxError in the worker script');
    await expect(preparing).rejects.toThrow("The wake word's worker stopped: SyntaxError in the worker script");
    expect(engine.health.state).toBe('broken');
  });
});

describe('listening', () => {
  it('makes the audio graph before anything is awaited, inside the gesture', async () => {
    const { engine, worker, graphs } = scenario();
    const preparing = engine.prepare();
    worker().ready();
    await preparing;
    const starting = engine.start(new FakeStream());
    expect(graphs).toHaveLength(1);
    await starting;
  });

  it('resumes a suspended context inside the gesture too', async () => {
    const context = scenario();
    const preparing = context.engine.prepare();
    context.worker().ready();
    await preparing;
    await context.engine.start(new FakeStream());
    context.engine.stop();
    context.graph().state = 'suspended';
    const starting = context.engine.start(new FakeStream());
    expect(context.graph().resumes).toBe(1);
    await starting;
  });

  it('points the worklet at the worker over a fresh port, and the stream at the worklet', async () => {
    const context = scenario();
    const stream = new FakeStream();
    const starting = context.engine.start(stream);
    context.worker().ready();
    await starting;
    const listen = context.worker().requests.find((request) => request.type === 'listen');
    expect(listen).toMatchObject({ type: 'listen', generation: 1 });
    expect(context.graph().ports).toHaveLength(1);
    expect(context.graph().streams).toEqual([stream]);
  });

  it('is listening only once the worker has scored a chunk of this stream', async () => {
    const context = scenario();
    const starting = context.engine.start(new FakeStream());
    context.worker().ready();
    await starting;
    expect(context.engine.health).toMatchObject({ state: 'ready', problem: WAKE_PROBLEMS.starting });
    // Chunks arriving but, disarmed, none scored.
    await context.flow(500, { scored: 0, inferenceMilliseconds: 0 });
    expect(context.engine.health).toMatchObject({ state: 'ready', problem: WAKE_PROBLEMS.disarmed });
    context.engine.arm();
    expect(context.engine.health.problem).toBe(WAKE_PROBLEMS.starting);
    await context.flow(250);
    expect(context.engine.health).toMatchObject({ state: 'listening', problem: undefined, armed: true });
    expect(context.engine.health.chunksPerSecond).toBeCloseTo(12, 0);
    expect(context.engine.health.millisecondsPerChunk).toBeCloseTo(8, 6);
  });

  it('ignores reports about a port it has since replaced', async () => {
    const context = await listening();
    context.stream.track.end();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.worker().generation()).toBe(2);
    context.worker().emit({ type: 'stats', generation: 1, counters: counters({ processed: 999, scored: 999 }) });
    expect(context.engine.health.state).not.toBe('listening');
  });
});

describe('arming', () => {
  it('tells the worker, and passes wakes on only while armed', async () => {
    const context = await listening();
    const wakes: number[] = [];
    context.engine.onWake((score) => wakes.push(score));
    context.worker().emit({ type: 'wake', score: 0.97 });
    context.engine.disarm();
    context.worker().emit({ type: 'wake', score: 0.95 });
    expect(wakes).toEqual([0.97]);
    expect(
      context
        .worker()
        .types()
        .filter((type) => type === 'arm' || type === 'disarm'),
    ).toEqual(['arm', 'disarm']);
    expect(context.engine.health.armed).toBe(false);
  });

  it('arms a worker that was started again after a failure', async () => {
    const context = await listening();
    context.worker().emit({ type: 'failed', message: 'The wake word stopped working: out of memory' });
    const rebuilding = context.engine.rebuild();
    context.worker().ready();
    await rebuilding;
    expect(context.workers).toHaveLength(2);
    expect(context.workers[1].types()).toEqual(['load', 'arm', 'listen']);
  });

  it('can stop listening to a wake listener', async () => {
    const context = await listening();
    const wakes: number[] = [];
    const stopListening = context.engine.onWake((score) => wakes.push(score));
    stopListening();
    context.worker().emit({ type: 'wake', score: 0.97 });
    expect(wakes).toEqual([]);
  });
});

describe('the watchdog', () => {
  it('opens the microphone again when the track ends, and listens to the new one', async () => {
    const context = await listening();
    context.stream.track.end();
    expect(context.engine.health).toMatchObject({ state: 'broken', problem: WAKE_PROBLEMS.stopped });
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.opened).toHaveLength(1);
    expect(context.graph().streams.at(-1)).toBe(context.opened[0]);
    expect(context.worker().generation()).toBe(2);
    await context.flow(500);
    expect(context.engine.health.state).toBe('listening');
    // The app's own stream is the app's to stop.
    expect(context.stream.track.stopped).toBe(false);
  });

  it('opens the microphone again when chunks stop with the context running', async () => {
    const context = await listening();
    await context.advance(1500);
    expect(context.opened).toHaveLength(1);
    expect(context.worker().generation()).toBe(2);
  });

  it('does not take the page being held up for the microphone stopping', async () => {
    const context = await listening();
    await context.holdUpPage(1500);
    expect(context.engine.health.state).toBe('listening');
    // The reports that were waiting are read, and the next tick, on time, finds the stream flowing.
    await context.flow(1000);
    expect(context.engine.health.state).toBe('listening');
    expect(context.opened).toHaveLength(0);
    expect(context.healths.some((health) => health.state === 'broken')).toBe(false);
  });

  it('still judges the stream once the ticks come on time again', async () => {
    const context = await listening();
    await context.holdUpPage(1500);
    await context.advance(1500);
    expect(context.opened).toHaveLength(1);
  });

  it('resumes a suspended context and keeps the same microphone', async () => {
    const context = await listening();
    context.graph().setState('suspended');
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.graph().resumes).toBe(1);
    expect(context.graph().state).toBe('running');
    expect(context.opened).toHaveLength(0);
    expect(context.graph().streams.at(-1)).toBe(context.stream);
  });

  it('says a pinch is needed when the context will not resume, and recovers inside one', async () => {
    const context = await listening();
    context.graph().resumable = false;
    context.graph().setState('interrupted');
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.engine.health).toMatchObject({
      state: 'broken',
      problem: 'The microphone stopped — pinch to wake me',
      needsGesture: true,
    });

    // The select: user activation, so the context resumes.
    context.graph().resumable = true;
    await context.engine.rebuild();
    await context.flow(1000);
    expect(context.engine.health).toMatchObject({ state: 'listening', needsGesture: false });
  });

  it('never prompts for the microphone on its own', async () => {
    const context = await listening({ permission: 'prompt' });
    context.stream.track.end();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.opened).toHaveLength(0);
    expect(context.engine.health).toMatchObject({ state: 'broken', needsGesture: true });
    await context.engine.rebuild();
    expect(context.opened).toHaveLength(1);
  });

  it('says so when the microphone has been blocked', async () => {
    const context = await listening();
    context.setPermission('denied');
    context.stream.track.end();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.engine.health).toMatchObject({ state: 'broken', problem: MICROPHONE_BLOCKED, needsGesture: false });
    expect(context.opened).toHaveLength(0);
  });

  it('waits out a muted track', async () => {
    const context = await listening();
    context.stream.track.setMuted(true);
    expect(context.engine.health).toMatchObject({ state: 'ready', problem: WAKE_PROBLEMS.muted });
    await context.flow(3000);
    expect(context.opened).toHaveLength(0);
    context.stream.track.setMuted(false);
    expect(context.engine.health.state).toBe('listening');
  });

  it('spaces its attempts out, twice as long each time', async () => {
    const context = await listening({ permission: 'prompt' });
    context.stream.track.end();
    const attempts = () => context.healths.filter((health) => health.problem === WAKE_PROBLEMS.reconnecting).length;
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(attempts()).toBe(1);
    await context.advance(FIRST_RECOVERY_DELAY_MILLISECONDS - WATCHDOG_INTERVAL_MILLISECONDS);
    expect(attempts()).toBe(1);
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(attempts()).toBe(2);
    await context.advance(2 * FIRST_RECOVERY_DELAY_MILLISECONDS - WATCHDOG_INTERVAL_MILLISECONDS);
    expect(attempts()).toBe(2);
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(attempts()).toBe(3);
  });

  it('starts a new worker when the old one stops reporting', async () => {
    const context = await listening();
    // A second without chunks is a stall, and the first recovery reopens the microphone; the
    // worker still has the benefit of the doubt then. No reports for 3 s more, and it has none.
    await context.advance(1500, 'silent');
    expect(context.opened).toHaveLength(1);
    expect(context.workers).toHaveLength(1);
    await context.advance(FIRST_RECOVERY_DELAY_MILLISECONDS, 'silent');
    expect(context.workers[0].terminated).toBe(true);
    expect(context.workers).toHaveLength(2);
    context.worker().ready();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.worker().types()).toEqual(['load', 'arm', 'listen']);
  });

  it('builds a new audio graph when the worklet has failed', async () => {
    const context = await listening();
    context.graph().failed = true;
    context.stream.track.end();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.graphs).toHaveLength(2);
    expect(context.graphs[0].closed).toBe(true);
  });
});

describe('the diagnostics', () => {
  it('show the audio context, the track and the counters behind the health', async () => {
    const context = await listening();
    expect(context.engine.diagnostics).toEqual({
      contextState: 'running',
      sampleRate: 16000,
      trackState: 'live',
      trackMuted: false,
      droppedChunks: 0,
      recoveries: 0,
      profile: 'processed',
    });
    context.stream.track.end();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    expect(context.engine.diagnostics.recoveries).toBe(1);
    context.engine.stop();
    expect(context.engine.diagnostics.trackState).toBeUndefined();
  });
});

describe('stopping and disposing', () => {
  it('stops listening without the watchdog opening the microphone again', async () => {
    const context = await listening();
    context.engine.stop();
    expect(context.graph().streams.at(-1)).toBeUndefined();
    expect(context.worker().types().at(-1)).toBe('unlisten');
    expect(context.isWatching()).toBe(false);
    expect(context.engine.health).toMatchObject({ state: 'ready', problem: WAKE_PROBLEMS.notStarted });
    context.stream.track.end();
    await context.advance(2000);
    expect(context.opened).toHaveLength(0);
  });

  it('stops what it opened itself, and nothing else', async () => {
    const context = await listening();
    context.stream.track.end();
    await context.advance(WATCHDOG_INTERVAL_MILLISECONDS);
    const own = context.opened[0];
    context.engine.dispose();
    expect(own.track.stopped).toBe(true);
    expect(context.stream.track.stopped).toBe(false);
    expect(context.worker().terminated).toBe(true);
    expect(context.graph().closed).toBe(true);
    await expect(context.engine.start(new FakeStream())).rejects.toThrow('disposed');
  });
});
