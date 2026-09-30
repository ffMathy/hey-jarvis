import { createDetectionGate } from './detection-gate';
import { rootMeanSquare } from './pcm-frames';
import { createSerialQueue } from './serial-queue';
import type { WorkerCounters } from './wake-health';
import { CHUNK_SAMPLES, createWakePipeline, type WakeModels, type WakePipeline } from './wake-pipeline';
import type { WakeWorkerEvent, WakeWorkerRequest } from './worker-protocol';

/**
 * What the wake worker does, apart from being a worker.
 *
 * Loads the models, then takes the AudioWorklet's frames off their port, one chunk at a time,
 * through the pipeline and the detection gate, and reports what it counted four times a second.
 * `wake.worker.ts` wires this to the worker's global scope and to onnxruntime-web; the tests
 * wire it to a fake.
 */

/** How often the worker reports its counters while listening. */
export const STATS_INTERVAL_MILLISECONDS = 250;

/** Of the progress bar, the share that is downloading and loading; the warm-up is the rest. */
const LOADING_SHARE = 0.9;

/** What the AudioWorklet's port looks like from here; a MessagePort is one. */
export interface FrameSource {
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export interface WakeWorkerCoreDependencies {
  loadModels(assetBase: string, onProgress: (fraction: number) => void): Promise<WakeModels>;
  post(event: WakeWorkerEvent): void;
  now(): number;
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  /** The warm-up noise's source; seeded in tests. */
  random?: () => number;
}

type WorkerTask = { kind: 'chunk'; samples: Int16Array; generation: number } | { kind: 'reset' };

export interface WakeWorkerCore {
  /** A request from the page. `port` is typed loosely so tests can pass a fake frame source. */
  handle(request: WakeWorkerRequest | { type: 'listen'; port: FrameSource; generation: number }): void;
  /** Resolves once every chunk handed over so far has been through the pipeline. */
  idle(): Promise<void>;
  dispose(): void;
}

function freshCounters(): WorkerCounters {
  return { processed: 0, scored: 0, inferenceMilliseconds: 0, dropped: 0, silentChunks: 0, level: 0, score: 0 };
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createWakeWorkerCore(dependencies: WakeWorkerCoreDependencies): WakeWorkerCore {
  const gate = createDetectionGate();
  let pipeline: WakePipeline | undefined;
  let loading = false;
  let failed = false;
  let source: FrameSource | undefined;
  let generation = 0;
  let counters = freshCounters();
  let statsTimer: ReturnType<typeof setInterval> | undefined;

  function fail(message: string) {
    if (failed) return;
    failed = true;
    pipeline = undefined;
    dependencies.post({ type: 'failed', message });
  }

  async function processChunk(samples: Int16Array) {
    counters.processed++;
    counters.level = rootMeanSquare(samples);
    counters.silentChunks = counters.level === 0 ? counters.silentChunks + 1 : 0;
    // While disarmed the chunk is only counted: the models are the expensive part, and a call
    // with Jarvis is exactly when the headset has least to spare. Arming resets the pipeline
    // anyway, so nothing scored in between would have been kept.
    if (pipeline === undefined || !gate.armed) return;
    const started = dependencies.now();
    const score = await pipeline.push(samples);
    counters.inferenceMilliseconds += dependencies.now() - started;
    counters.scored++;
    counters.score = score;
    if (gate.observe(score)) dependencies.post({ type: 'wake', score });
  }

  const queue = createSerialQueue<WorkerTask>({
    async run(task) {
      if (task.kind === 'reset') {
        pipeline?.reset();
      } else if (task.generation === generation) {
        await processChunk(task.samples);
      }
    },
    isDroppable: (task) => task.kind === 'chunk',
    onDropped: (task) => {
      if (task.kind === 'chunk' && task.generation === generation) counters.dropped++;
    },
    onError: (error) => fail(`The wake word stopped working: ${describe(error)}`),
  });

  async function load(assetBase: string) {
    if (loading || pipeline !== undefined || failed) return;
    loading = true;
    dependencies.post({ type: 'phase', phase: 'loading' });
    try {
      const models = await dependencies.loadModels(assetBase, (fraction) =>
        dependencies.post({ type: 'progress', fraction: fraction * LOADING_SHARE }),
      );
      dependencies.post({ type: 'phase', phase: 'warming' });
      const warmed = createWakePipeline(models, dependencies.random);
      await warmed.warmUp();
      pipeline = warmed;
      dependencies.post({ type: 'progress', fraction: 1 });
      dependencies.post({ type: 'phase', phase: 'ready' });
    } catch (error) {
      fail(`Jarvis could not load his wake word: ${describe(error)}`);
    } finally {
      loading = false;
    }
  }

  function postStats() {
    dependencies.post({ type: 'stats', generation, counters: { ...counters } });
  }

  function stopStats() {
    if (statsTimer !== undefined) dependencies.clearInterval(statsTimer);
    statsTimer = undefined;
  }

  function closeSource() {
    if (source !== undefined) {
      source.onmessage = null;
      source.close();
    }
    source = undefined;
  }

  function listen(port: FrameSource, portGeneration: number) {
    closeSource();
    source = port;
    generation = portGeneration;
    counters = freshCounters();
    port.onmessage = (event) => {
      const samples = event.data;
      if (!(samples instanceof Int16Array) || samples.length !== CHUNK_SAMPLES) return;
      queue.add({ kind: 'chunk', samples, generation: portGeneration });
    };
    stopStats();
    statsTimer = dependencies.setInterval(postStats, STATS_INTERVAL_MILLISECONDS);
    postStats();
  }

  return {
    handle(request) {
      switch (request.type) {
        case 'load':
          void load(request.assetBase);
          break;
        case 'listen':
          listen(request.port, request.generation);
          break;
        case 'unlisten':
          closeSource();
          stopStats();
          break;
        case 'arm':
          gate.arm();
          queue.add({ kind: 'reset' });
          break;
        case 'disarm':
          gate.disarm();
          break;
      }
    },
    idle: () => queue.idle(),
    dispose() {
      closeSource();
      stopStats();
    },
  };
}
