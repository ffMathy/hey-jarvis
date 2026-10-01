import type { WorkerCounters } from './wake-health';

/**
 * The messages between the engine on the page and the wake worker.
 *
 * Audio does not travel on this channel: the AudioWorklet posts its frames to the worker over a
 * MessagePort of their own, so they go from the audio thread to the worker without ever waiting
 * on the page's main thread, which is busy drawing the room.
 */

export type WakeWorkerRequest =
  /** Download onnxruntime-web's wasm and the models from under `assetBase`, load them, warm up. */
  | { type: 'load'; assetBase: string }
  /** Take frames from this port from now on. `generation` tags the reports about it. */
  | { type: 'listen'; port: MessagePort; generation: number }
  /** Close the frames port. */
  | { type: 'unlisten' }
  /** Detections on: reset the pipeline and start the refractory period. */
  | { type: 'arm' }
  /** Detections off; chunks are counted but no longer scored. */
  | { type: 'disarm' };

/** How far the worker has got with the models. */
export type WorkerModelPhase = 'loading' | 'warming' | 'ready';

export type WakeWorkerEvent =
  | { type: 'phase'; phase: WorkerModelPhase }
  | { type: 'progress'; fraction: number }
  /** Loading failed, or the models stopped working; the worker is of no more use. */
  | { type: 'failed'; message: string }
  | { type: 'wake'; score: number }
  /** Four times a second while listening: the counters for the port of `generation`. */
  | { type: 'stats'; generation: number; counters: WorkerCounters };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toCounters(value: unknown): WorkerCounters | undefined {
  if (!isRecord(value)) return undefined;
  const { processed, scored, inferenceMilliseconds, dropped, silentChunks, level, score } = value;
  const allNumbers =
    isNumber(processed) &&
    isNumber(scored) &&
    isNumber(inferenceMilliseconds) &&
    isNumber(dropped) &&
    isNumber(silentChunks) &&
    isNumber(level) &&
    isNumber(score);
  return allNumbers ? { processed, scored, inferenceMilliseconds, dropped, silentChunks, level, score } : undefined;
}

/** The request `value` is, or undefined when it is none (a message from anything else). */
export function toWakeWorkerRequest(value: unknown): WakeWorkerRequest | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case 'load':
      return typeof value.assetBase === 'string' ? { type: 'load', assetBase: value.assetBase } : undefined;
    case 'listen':
      return value.port instanceof MessagePort && isNumber(value.generation)
        ? { type: 'listen', port: value.port, generation: value.generation }
        : undefined;
    case 'unlisten':
    case 'arm':
    case 'disarm':
      return { type: value.type };
    default:
      return undefined;
  }
}

function toPhase(value: unknown): WorkerModelPhase | undefined {
  return value === 'loading' || value === 'warming' || value === 'ready' ? value : undefined;
}

/** The event `value` is, or undefined when it is none. */
export function toWakeWorkerEvent(value: unknown): WakeWorkerEvent | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case 'phase': {
      const phase = toPhase(value.phase);
      return phase === undefined ? undefined : { type: 'phase', phase };
    }
    case 'progress':
      return isNumber(value.fraction) ? { type: 'progress', fraction: value.fraction } : undefined;
    case 'failed':
      return typeof value.message === 'string' ? { type: 'failed', message: value.message } : undefined;
    case 'wake':
      return isNumber(value.score) ? { type: 'wake', score: value.score } : undefined;
    case 'stats': {
      const counters = toCounters(value.counters);
      return counters !== undefined && isNumber(value.generation)
        ? { type: 'stats', generation: value.generation, counters }
        : undefined;
    }
    default:
      return undefined;
  }
}
