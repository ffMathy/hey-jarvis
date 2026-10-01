import type { WakeState } from './types';

/**
 * Whether the wake word is really listening, and what to do when it is not.
 *
 * A wake word that has silently died looks exactly like one that is listening — nothing is drawn
 * either way — and the phone's design forbids that for the conversation, so the headset forbids
 * it for the wake word. The things that kill it are mostly outside the page's control: the
 * headset sleeping, the system taking the microphone ("Hey Meta", a call), a privacy mute, the
 * audio context being interrupted, a worker crashing. So the engine watches what it can observe —
 * chunks arriving and being scored, the microphone track, the audio context, the level — and
 * this module turns one observation of all of that into a verdict: the state, the words for the
 * status line, and whether to try to recover.
 *
 * Pure, so every rule below is pinned by `wake-health.spec.ts` without a browser.
 */

/** How often the engine looks. */
export const WATCHDOG_INTERVAL_MILLISECONDS = 500;

/**
 * How much later than due a watchdog tick may come and still be trusted to judge the audio.
 *
 * The worker's reports reach the page as messages, so a page held up for a second — a long frame,
 * a garbage collection, a software-rendered room in the browser tests — reads them a second late,
 * and a tick that fires the moment it is free, before the reports queued behind it, would see a
 * stream that stopped. A tick later than this judges nothing; the next one, on time, judges with
 * the reports read.
 */
export const LATE_TICK_MILLISECONDS = WATCHDOG_INTERVAL_MILLISECONDS / 2;

/** The window chunk rates and inference times are measured over. */
export const STATS_WINDOW_MILLISECONDS = 2000;

/** A healthy stream: one 80 ms chunk every 80 ms. */
export const HEALTHY_CHUNKS_PER_SECOND = 12.5;

/**
 * Below this over a full window, chunks are being dropped often enough that the pipeline's
 * context between chunks keeps breaking, and "hey jarvis" would mostly be missed.
 */
export const MINIMUM_CHUNKS_PER_SECOND = 10;

/**
 * Time after starting (or recovering) before a missing stream counts as a failure: the worklet
 * module has to load and the first ten render quanta have to fill a chunk.
 */
export const START_GRACE_MILLISECONDS = 3000;

/** No chunk for this long means the audio stopped (the critique's "frames stop for more than 1 s"). */
export const STALL_MILLISECONDS = 1000;

/** The worker reports four times a second; this long without a report means it is gone or stuck. */
export const WORKER_SILENT_MILLISECONDS = 3000;

/** Chunks of exact digital zero before the microphone counts as muted: 125 × 80 ms = 10 s. */
export const MUTED_AFTER_SILENT_CHUNKS = 125;

/** The words for the status line, one per reason he is not listening. */
export const WAKE_PROBLEMS = {
  notLoaded: 'Jarvis is not listening yet.',
  loading: 'Getting ready to hear “Hey Jarvis”…',
  modelsFailed: 'Jarvis could not load his wake word.',
  notStarted: 'Jarvis is not listening to the microphone.',
  starting: 'Starting to listen…',
  reconnecting: 'Reconnecting the microphone…',
  stopped: 'The microphone stopped — pinch to wake me',
  muted: 'Your microphone seems muted',
  fallingBehind: 'This headset is too busy to listen for “Hey Jarvis” properly',
  disarmed: 'Jarvis is not listening for “Hey Jarvis” right now.',
} as const;

/** What the worker counts, cumulative since it was handed the current audio port. */
export interface WorkerCounters {
  /** Chunks taken off the queue, scored or not. */
  processed: number;
  /** Chunks the models scored (only while armed and loaded). */
  scored: number;
  /** Total time the scored chunks took, ms. */
  inferenceMilliseconds: number;
  /** Chunks dropped because too many were waiting. */
  dropped: number;
  /** Consecutive chunks of exact digital zero, up to the latest. */
  silentChunks: number;
  /** RMS of the latest chunk, 0–1. */
  level: number;
  /** Latest wake score, 0–1. */
  score: number;
}

export interface StatsSample {
  /** When the engine received it, on its own clock (ms). */
  at: number;
  counters: WorkerCounters;
}

export interface StatsRates {
  latest: StatsSample | undefined;
  chunksPerSecond: number;
  millisecondsPerChunk: number;
  /** How much time the rates cover, ms (less than the window just after starting). */
  span: number;
  /** When a report last showed more chunks processed than the one before it. */
  lastProgressAt: number | undefined;
}

export interface StatsHistory {
  record(at: number, counters: WorkerCounters): void;
  clear(): void;
  rates(): StatsRates;
}

/**
 * The worker's reports over the last window, turned into rates.
 *
 * Rates are measured between reports rather than against the current time, so a report that is
 * a quarter of a second old does not read as a slow stream; a worker that stops reporting at all
 * is caught by the report's age instead.
 */
export function createStatsHistory(windowMilliseconds = STATS_WINDOW_MILLISECONDS): StatsHistory {
  let samples: StatsSample[] = [];
  let lastProgressAt: number | undefined;
  let millisecondsPerChunk = 0;

  return {
    record(at, counters) {
      const previous = samples.at(-1);
      if (previous === undefined ? counters.processed > 0 : counters.processed > previous.counters.processed) {
        lastProgressAt = at;
      }
      samples.push({ at, counters });
      // Keep one report from before the window, so the rates span the whole of it.
      const firstInWindow = samples.findIndex((sample) => sample.at >= at - windowMilliseconds);
      if (firstInWindow > 1) samples = samples.slice(firstInWindow - 1);
    },
    clear() {
      samples = [];
      lastProgressAt = undefined;
    },
    rates() {
      const latest = samples.at(-1);
      const oldest = samples[0];
      if (latest === undefined || oldest === undefined || latest.at <= oldest.at) {
        return { latest, chunksPerSecond: 0, millisecondsPerChunk, span: 0, lastProgressAt };
      }
      const seconds = (latest.at - oldest.at) / 1000;
      const scored = latest.counters.scored - oldest.counters.scored;
      if (scored > 0) {
        millisecondsPerChunk = (latest.counters.inferenceMilliseconds - oldest.counters.inferenceMilliseconds) / scored;
      }
      return {
        latest,
        chunksPerSecond: (latest.counters.processed - oldest.counters.processed) / seconds,
        millisecondsPerChunk,
        span: latest.at - oldest.at,
        lastProgressAt,
      };
    },
  };
}

export type ModelPhase = 'unloaded' | 'loading' | 'warming' | 'ready' | 'failed';

export interface ModelState {
  phase: ModelPhase;
  problem?: string;
  /** Whether the failure came after the models had loaded and run: a worker that crashed or ran out of memory. */
  failedWhileRunning?: boolean;
}

export interface AudioObservation {
  /** When the engine last started or recovered the stream. */
  startedAt: number;
  track: 'live' | 'ended';
  trackMuted: boolean;
  /** The AudioContext's state: 'running', 'suspended', 'interrupted' or 'closed'. */
  context: string;
}

export interface WakeObservation {
  now: number;
  models: ModelState;
  /** Undefined until `start`, and after `stop`. */
  audio?: AudioObservation;
  stats: StatsRates;
  armed: boolean;
  recovery: { running: boolean; failure?: { problem: string; needsGesture: boolean } };
}

export interface WakeVerdict {
  state: WakeState;
  problem?: string;
  /** Whether recovering needs a user gesture: the last attempt could not resume audio without one. */
  needsGesture: boolean;
  /** Whether the engine should try to recover (it spaces the attempts out itself). */
  recover: boolean;
}

function verdict(state: WakeState, problem: string | undefined, recover = false): WakeVerdict {
  return { state, problem, needsGesture: false, recover };
}

function modelVerdict(models: WakeObservation['models']): WakeVerdict | undefined {
  switch (models.phase) {
    case 'failed':
      // A failed load is not retried on its own: it is usually a missing file or a runtime this
      // browser cannot run, and retrying would fetch 17 MB again for the same answer (`rebuild`
      // retries). Models that loaded and then failed — a crashed worker, memory running out —
      // are worth a new worker, spaced out like any other recovery.
      return verdict('broken', models.problem ?? WAKE_PROBLEMS.modelsFailed, models.failedWhileRunning === true);
    case 'unloaded':
      return verdict('unloaded', WAKE_PROBLEMS.notLoaded);
    case 'loading':
    case 'warming':
      return verdict(models.phase, WAKE_PROBLEMS.loading);
    case 'ready':
      return undefined;
  }
}

/** What is wrong with the capture itself — the track and the audio context — if anything. */
function captureVerdict(audio: AudioObservation, starting: boolean): WakeVerdict | undefined {
  if (audio.track === 'ended' || audio.context === 'closed') return verdict('broken', WAKE_PROBLEMS.stopped, true);
  if (audio.context !== 'running') {
    return starting ? verdict('ready', WAKE_PROBLEMS.starting) : verdict('broken', WAKE_PROBLEMS.stopped, true);
  }
  // A muted track comes back by itself with an `unmute` event; opening another capture would
  // not help, since whatever muted this one mutes that too.
  if (audio.trackMuted) return verdict('ready', WAKE_PROBLEMS.muted);
  return undefined;
}

/** What is wrong with the chunks reaching the worker, if anything. */
function flowVerdict(stats: StatsRates, now: number, starting: boolean): WakeVerdict | undefined {
  if (starting && stats.lastProgressAt === undefined) return verdict('ready', WAKE_PROBLEMS.starting);
  const reportAge = stats.latest === undefined ? Number.POSITIVE_INFINITY : now - stats.latest.at;
  const sinceProgress = stats.lastProgressAt === undefined ? Number.POSITIVE_INFINITY : now - stats.lastProgressAt;
  if (reportAge > WORKER_SILENT_MILLISECONDS || sinceProgress > STALL_MILLISECONDS) {
    return verdict('broken', WAKE_PROBLEMS.stopped, true);
  }
  // Exact zeros for 10 s is not a quiet room — every real microphone has a noise floor — but a
  // capture that is alive and delivering nothing. A fresh capture sometimes fixes that.
  if ((stats.latest?.counters.silentChunks ?? 0) >= MUTED_AFTER_SILENT_CHUNKS) {
    return verdict('ready', WAKE_PROBLEMS.muted, true);
  }
  if (stats.span >= STATS_WINDOW_MILLISECONDS * 0.75 && stats.chunksPerSecond < MINIMUM_CHUNKS_PER_SECOND) {
    return verdict('ready', WAKE_PROBLEMS.fallingBehind);
  }
  return undefined;
}

/** What is wrong with a started stream, if anything; undefined when audio is flowing. */
function streamVerdict(audio: AudioObservation, observation: WakeObservation): WakeVerdict | undefined {
  const starting = observation.now - audio.startedAt < START_GRACE_MILLISECONDS;
  return captureVerdict(audio, starting) ?? flowVerdict(observation.stats, observation.now, starting);
}

/** One observation of the engine, judged. */
export function judgeWakeHealth(observation: WakeObservation): WakeVerdict {
  const fromModels = modelVerdict(observation.models);
  if (fromModels !== undefined) return fromModels;
  if (observation.recovery.running) return verdict('ready', WAKE_PROBLEMS.reconnecting);
  if (observation.audio === undefined) return verdict('ready', WAKE_PROBLEMS.notStarted);

  const fromStream = streamVerdict(observation.audio, observation);
  const scored = (observation.stats.latest?.counters.scored ?? 0) > 0;
  // Only a chunk the models really scored, from this stream, counts as listening.
  if (fromStream === undefined && scored) return verdict('listening', undefined);

  const failure = observation.recovery.failure;
  if (failure !== undefined) {
    return { state: 'broken', problem: failure.problem, needsGesture: failure.needsGesture, recover: true };
  }
  if (fromStream !== undefined) return fromStream;
  return verdict('ready', observation.armed ? WAKE_PROBLEMS.starting : WAKE_PROBLEMS.disarmed);
}
