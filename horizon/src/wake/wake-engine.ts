import { MICROPHONE_BLOCKED, type StoppableStream } from './microphone';
import type { MicrophonePermission, MicrophoneProfile, WakeDiagnostics, WakeHealth } from './types';
import {
  type AudioObservation,
  createStatsHistory,
  judgeWakeHealth,
  LATE_TICK_MILLISECONDS,
  type ModelState,
  WAKE_PROBLEMS,
  WATCHDOG_INTERVAL_MILLISECONDS,
  type WakeVerdict,
  WORKER_SILENT_MILLISECONDS,
  type WorkerCounters,
} from './wake-health';
import type { WakeWorkerEvent, WakeWorkerRequest, WorkerModelPhase } from './worker-protocol';

/**
 * The wake engine: the worker, the audio graph and the microphone, held together and watched.
 *
 * Everything that touches a browser API comes in through `WakeEngineDependencies`, so the whole
 * of this — loading, starting, arming, the watchdog and every recovery path — runs under
 * `bun test` against fakes; `index.ts` hands in the real worker, AudioContext and getUserMedia.
 */

/** A microphone track, as the engine watches it; a MediaStreamTrack is one. */
export interface WakeTrack extends EventTarget {
  readonly readyState: 'live' | 'ended';
  readonly muted: boolean;
  stop(): void;
}

/** A microphone stream, as the engine uses it; a MediaStream is one. */
export interface WakeStream extends StoppableStream {
  getAudioTracks(): WakeTrack[];
  getTracks(): WakeTrack[];
}

/** The 16 kHz AudioContext with the frame-packing worklet in it (`audio-graph.ts`). */
export interface WakeAudioGraph<Stream> {
  /** The AudioContext's state: 'running', 'suspended', 'interrupted' or 'closed'. */
  readonly state: string;
  /** The rate the AudioContext really runs at. */
  readonly sampleRate: number;
  /** Whether the worklet's processor threw, which stops it for good. */
  readonly failed: boolean;
  /** Resolves once the worklet is loaded and connected. */
  readonly ready: Promise<void>;
  /** Hands the worklet the port to post its frames to, replacing the last one. */
  sendFramesTo(port: MessagePort): void;
  /** Feeds this stream into the worklet, replacing the last one; undefined disconnects it. */
  listen(stream: Stream | undefined): void;
  resume(): Promise<void>;
  /** Called when the context's state changes. */
  onStateChange(listener: () => void): void;
  close(): void;
}

export interface WakeWorkerHandle {
  post(request: WakeWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface WakeEngineDependencies<Stream extends WakeStream> {
  /** The folder the page is served from; the worker finds `vendor/` and `models/` under it. */
  assetBase: URL;
  /** The profile a recovery reopens the microphone with. */
  profile: MicrophoneProfile;
  /** Starts the worker; `onCrash` is for an error the worker could not report itself. */
  spawnWorker(onEvent: (event: WakeWorkerEvent) => void, onCrash: (message: string) => void): WakeWorkerHandle;
  /** Creates the audio graph. Called inside the gesture that starts listening, the first time. */
  createAudioGraph(): WakeAudioGraph<Stream>;
  openMicrophone(profile: MicrophoneProfile): Promise<Stream>;
  microphonePermission(): Promise<MicrophonePermission>;
  now(): number;
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
}

/** The engine over any stream type; with MediaStream it is the contract's `WakeEngine`. */
export interface WakeEngineOver<Stream> {
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
  start(stream: Stream): Promise<void>;
  stop(): void;
  arm(): void;
  disarm(): void;
  onWake(listener: (score: number) => void): () => void;
  onHealth(listener: (health: WakeHealth) => void): () => void;
  readonly health: WakeHealth;
  readonly diagnostics: WakeDiagnostics;
  rebuild(): Promise<void>;
  dispose(): void;
}

/** Recovery waits this long for the audio context to resume before deciding it needs a gesture. */
export const RESUME_TIMEOUT_MILLISECONDS = 1500;

/** The first automatic recovery waits this long after the last; each further one twice as long. */
export const FIRST_RECOVERY_DELAY_MILLISECONDS = 5000;

/** The longest wait between automatic recoveries. */
export const LONGEST_RECOVERY_DELAY_MILLISECONDS = 60000;

/** The track events that can change the health. */
const TRACK_EVENTS = ['ended', 'mute', 'unmute'] as const;

/** Recoveries in a row after which the audio graph is rebuilt from scratch, not just resumed. */
const RECOVERIES_BEFORE_FRESH_GRAPH = 2;

/**
 * Recovering needs a user gesture: the audio context would not resume, or the microphone would
 * need a permission prompt, and the engine never prompts on its own.
 */
export class GestureNeededError extends Error {
  constructor() {
    super(WAKE_PROBLEMS.stopped);
    this.name = 'GestureNeededError';
  }
}

/**
 * A recovery that `start`, `stop` or `dispose` overtook while it waited: the listening it was
 * for has ended, so it gives up quietly instead of acting on it or recording a verdict about it.
 */
class RecoveryOvertakenError extends Error {
  constructor() {
    super('The wake engine was stopped or started again during a recovery.');
    this.name = 'RecoveryOvertakenError';
  }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolved, rejected) => {
    resolve = resolved;
    reject = rejected;
  });
  // A load nobody awaited must not surface as an unhandled rejection; the health says it failed.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function sameHealth(first: WakeHealth, second: WakeHealth) {
  return (
    first.state === second.state &&
    first.problem === second.problem &&
    first.needsGesture === second.needsGesture &&
    first.chunksPerSecond === second.chunksPerSecond &&
    first.millisecondsPerChunk === second.millisecondsPerChunk &&
    first.level === second.level &&
    first.score === second.score &&
    first.armed === second.armed
  );
}

export function assembleWakeEngine<Stream extends WakeStream>(
  dependencies: WakeEngineDependencies<Stream>,
): WakeEngineOver<Stream> {
  const wakeListeners = new Set<(score: number) => void>();
  const healthListeners = new Set<(health: WakeHealth) => void>();
  const progressListeners = new Set<(fraction: number) => void>();
  const stats = createStatsHistory();

  let worker: WakeWorkerHandle | undefined;
  let models: ModelState = { phase: 'unloaded' };
  let loading: Deferred | undefined;
  let graph: WakeAudioGraph<Stream> | undefined;
  let stream: Stream | undefined;
  /** A stream the engine opened itself (in a recovery), which it stops when done with it. */
  let ownStream: Stream | undefined;
  let listening = false;
  let connecting = false;
  let startedAt = 0;
  let generation = 0;
  let armed = false;
  let recovery: { running: boolean; failure?: { problem: string; needsGesture: boolean } } = { running: false };
  let recovering: Promise<void> | undefined;
  /**
   * Bumped by every `start`, `stop` and `dispose`. A recovery notes it before its first await and
   * checks it after each one, because the permission read, the resume and getUserMedia can each
   * take seconds, and whatever it opens after the listening ended would never be stopped.
   */
  let listeningSession = 0;
  let lastRecoveryAt = Number.NEGATIVE_INFINITY;
  let recoveriesInARow = 0;
  let recoveries = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  /** When the watchdog last ticked, to tell a tick the page held up from one on time. */
  let lastTickAt = 0;
  let disposed = false;
  let health: WakeHealth = {
    state: 'unloaded',
    problem: WAKE_PROBLEMS.notLoaded,
    chunksPerSecond: 0,
    millisecondsPerChunk: 0,
    level: 0,
    score: 0,
    armed: false,
    needsGesture: false,
  };

  // ── health ──

  function observeAudio(): AudioObservation | undefined {
    if (!listening || graph === undefined) return undefined;
    const track = stream?.getAudioTracks()[0];
    return {
      // Until the worklet is connected the stream is still starting, however long that takes.
      startedAt: connecting ? dependencies.now() : startedAt,
      track: track?.readyState === 'live' ? 'live' : 'ended',
      trackMuted: track?.muted ?? false,
      context: graph.state,
    };
  }

  function evaluate(): WakeVerdict {
    const rates = stats.rates();
    const verdict = judgeWakeHealth({
      now: dependencies.now(),
      models,
      audio: observeAudio(),
      stats: rates,
      armed,
      recovery,
    });
    if (verdict.state === 'listening') {
      recoveriesInARow = 0;
      recovery = { running: false };
    }
    const next: WakeHealth = {
      state: verdict.state,
      problem: verdict.problem,
      needsGesture: verdict.needsGesture,
      chunksPerSecond: rates.chunksPerSecond,
      millisecondsPerChunk: rates.millisecondsPerChunk,
      level: rates.latest?.counters.level ?? 0,
      score: rates.latest?.counters.score ?? 0,
      armed,
    };
    if (!sameHealth(health, next)) {
      health = next;
      for (const listener of healthListeners) listener(next);
    }
    return verdict;
  }

  function recoveryDelay() {
    const doublings = Math.max(0, recoveriesInARow - 1);
    return Math.min(LONGEST_RECOVERY_DELAY_MILLISECONDS, FIRST_RECOVERY_DELAY_MILLISECONDS * 2 ** doublings);
  }

  function tick() {
    const now = dependencies.now();
    const late = now - lastTickAt > WATCHDOG_INTERVAL_MILLISECONDS + LATE_TICK_MILLISECONDS;
    lastTickAt = now;
    // The page was held up, and the worker's reports from meanwhile are still waiting to be read:
    // judged now, its own stall would read as the microphone's (see LATE_TICK_MILLISECONDS).
    if (late) return;
    const verdict = evaluate();
    const due = dependencies.now() - lastRecoveryAt >= recoveryDelay();
    if (verdict.recover && listening && !connecting && recovering === undefined && due) {
      // The failure is recorded in the health; nobody is waiting on an automatic attempt.
      recover(false).catch(() => undefined);
    }
  }

  function startWatchdog() {
    if (watchdog === undefined) lastTickAt = dependencies.now();
    watchdog ??= dependencies.setInterval(tick, WATCHDOG_INTERVAL_MILLISECONDS);
  }

  function stopWatchdog() {
    if (watchdog !== undefined) dependencies.clearInterval(watchdog);
    watchdog = undefined;
  }

  // ── the worker ──

  function failModels(message: string) {
    models = { phase: 'failed', problem: message, failedWhileRunning: models.phase === 'ready' };
    loading?.reject(new Error(message));
    loading = undefined;
    progressListeners.clear();
    // onnxruntime-web never recovers from a failed initialisation in the same worker, and a
    // pipeline that threw mid-chunk has lost its buffers; a new worker is the only way back.
    worker?.terminate();
    worker = undefined;
    evaluate();
  }

  function onModelPhase(phase: WorkerModelPhase) {
    models = { phase };
    if (phase === 'ready') {
      loading?.resolve();
      loading = undefined;
      for (const listener of progressListeners) listener(1);
      progressListeners.clear();
      // A worker started again after a failure has to be told what the last one was told.
      if (armed) worker?.post({ type: 'arm' });
    }
    evaluate();
  }

  function onStats(reportGeneration: number, counters: WorkerCounters) {
    // A report about a port that has since been replaced counts nothing.
    if (reportGeneration !== generation) return;
    stats.record(dependencies.now(), counters);
    // Straight away while not yet listening, so the hint appears with the first scored chunk.
    if (health.state !== 'listening') evaluate();
  }

  function onWorkerEvent(event: WakeWorkerEvent) {
    switch (event.type) {
      case 'phase':
        onModelPhase(event.phase);
        break;
      case 'progress':
        for (const listener of progressListeners) listener(event.fraction);
        break;
      case 'failed':
        failModels(event.message);
        break;
      case 'wake':
        // Arming and disarming cross threads; a wake the worker sent before hearing "disarm" is dropped.
        if (armed) for (const listener of wakeListeners) listener(event.score);
        break;
      case 'stats':
        onStats(event.generation, event.counters);
        break;
    }
  }

  function spawnWorker() {
    const spawned = dependencies.spawnWorker(
      (event) => {
        if (worker === spawned) onWorkerEvent(event);
      },
      (message) => {
        if (worker === spawned) failModels(`The wake word's worker stopped: ${message}`);
      },
    );
    worker = spawned;
    return spawned;
  }

  function load(): Promise<void> {
    if (models.phase === 'ready') return Promise.resolve();
    if (loading !== undefined) return loading.promise;
    const spawned = worker ?? spawnWorker();
    loading = deferred();
    models = { phase: 'loading' };
    spawned.post({ type: 'load', assetBase: dependencies.assetBase.href });
    evaluate();
    return loading.promise;
  }

  function restartWorker() {
    worker?.terminate();
    worker = undefined;
    loading?.reject(new Error('The wake word was restarted.'));
    loading = undefined;
    models = { phase: 'unloaded' };
  }

  // ── the audio ──

  function onTrackChange() {
    evaluate();
  }

  function releaseOwnStream() {
    if (ownStream === undefined) return;
    for (const track of ownStream.getTracks()) track.stop();
    ownStream = undefined;
  }

  /** Judges the health again the moment a track ends, mutes or unmutes, not at the next tick. */
  function watchTracks(watched: Stream | undefined, watching: boolean) {
    for (const track of watched?.getAudioTracks() ?? []) {
      for (const type of TRACK_EVENTS) {
        if (watching) {
          track.addEventListener(type, onTrackChange);
        } else {
          track.removeEventListener(type, onTrackChange);
        }
      }
    }
  }

  function useStream(next: Stream | undefined, owned: boolean) {
    watchTracks(stream, false);
    if (ownStream !== next) releaseOwnStream();
    stream = next;
    if (owned) ownStream = next;
    watchTracks(next, true);
  }

  /**
   * Starts a new session of listening, or of not listening: a recovery still running gives up at
   * its next await, and what the last session's recoveries found — a failure that needed a pinch,
   * how many attempts there were in a row — is forgotten, since it was about another stream.
   */
  function beginListeningSession() {
    listeningSession++;
    recovering = undefined;
    recovery = { running: false };
    recoveriesInARow = 0;
    lastRecoveryAt = Number.NEGATIVE_INFINITY;
  }

  function createGraph() {
    graph?.close();
    const created = dependencies.createAudioGraph();
    created.onStateChange(() => {
      if (graph === created) evaluate();
    });
    graph = created;
    return created;
  }

  /** Points the worklet at the worker over a fresh port, and the stream at the worklet. */
  function connect() {
    if (graph === undefined || worker === undefined || stream === undefined || !listening) return;
    generation++;
    stats.clear();
    const channel = new MessageChannel();
    graph.sendFramesTo(channel.port1);
    worker.post({ type: 'listen', port: channel.port2, generation }, [channel.port2]);
    graph.listen(stream);
    startedAt = dependencies.now();
  }

  async function start(next: Stream) {
    if (disposed) throw new Error('The wake engine was disposed.');
    // Synchronously, before anything is awaited: creating or resuming the AudioContext only
    // counts as allowed by the user while the gesture that called this is still running.
    const current = graph === undefined || graph.state === 'closed' || graph.failed ? createGraph() : graph;
    if (current.state !== 'running') current.resume().catch(() => undefined);
    beginListeningSession();
    useStream(next, false);
    listening = true;
    connecting = true;
    startWatchdog();
    evaluate();
    try {
      await Promise.all([load(), current.ready]);
      connect();
    } finally {
      connecting = false;
      evaluate();
    }
  }

  function stop() {
    beginListeningSession();
    listening = false;
    graph?.listen(undefined);
    worker?.post({ type: 'unlisten' });
    useStream(undefined, false);
    releaseOwnStream();
    stats.clear();
    stopWatchdog();
    evaluate();
  }

  // ── recovery ──

  function workerSilent() {
    const latest = stats.rates().latest;
    return latest === undefined
      ? dependencies.now() - startedAt > WORKER_SILENT_MILLISECONDS
      : dependencies.now() - latest.at > WORKER_SILENT_MILLISECONDS;
  }

  async function resumeWithin(target: WakeAudioGraph<Stream>) {
    await Promise.race([
      target.resume().catch(() => undefined),
      new Promise<void>((resolve) => dependencies.setTimeout(resolve, RESUME_TIMEOUT_MILLISECONDS)),
    ]);
  }

  /** The graph to recover with: the current one, or a new one when it is beyond resuming. */
  function recoveryGraph() {
    const current = graph;
    if (
      current === undefined ||
      current.state === 'closed' ||
      current.failed ||
      recoveriesInARow > RECOVERIES_BEFORE_FRESH_GRAPH
    ) {
      return { target: createGraph(), fresh: true };
    }
    return { target: current, fresh: false };
  }

  /** Whether `start`, `stop` or `dispose` has run since a recovery noted `session`. */
  function overtaken(session: number) {
    return disposed || session !== listeningSession;
  }

  function giveUpIfOvertaken(session: number) {
    if (overtaken(session)) throw new RecoveryOvertakenError();
  }

  /** Gets the recovery's context running, or throws that it takes a gesture to. */
  async function runGraph(target: WakeAudioGraph<Stream>, session: number) {
    await target.ready;
    giveUpIfOvertaken(session);
    if (target.state !== 'running') await resumeWithin(target);
    giveUpIfOvertaken(session);
    if (target.state !== 'running') throw new GestureNeededError();
  }

  /** Opens the microphone again and makes it the engine's own stream. */
  async function reopenMicrophone(session: number) {
    const reopened = await dependencies.openMicrophone(dependencies.profile);
    if (overtaken(session)) {
      // Nobody else would ever stop a capture that arrives after the engine was told to stop,
      // and it would keep the headset's microphone on while the user is back on the page.
      for (const track of reopened.getTracks()) track.stop();
      throw new RecoveryOvertakenError();
    }
    useStream(reopened, true);
  }

  /**
   * Gets audio flowing again, in the plan's order: the permission, then the context, then the
   * microphone. `userInitiated` is whether this runs inside a gesture, where a prompt may show.
   */
  async function recoverAudio(userInitiated: boolean, session: number) {
    const permission = await dependencies.microphonePermission();
    giveUpIfOvertaken(session);
    if (permission === 'denied') throw new Error(MICROPHONE_BLOCKED);

    const { target, fresh } = recoveryGraph();
    // A context that was running when this began was not the problem, so the capture was: a
    // track that ended, or a stream that stalled or went to exact zeros.
    const captureSuspect = !fresh && target.state === 'running';
    await runGraph(target, session);

    const track = stream?.getAudioTracks()[0];
    if (track === undefined || track.readyState === 'ended' || captureSuspect) {
      // Opening the microphone without a gesture is fine once it is granted; a prompt is not,
      // and inside the room it could not even be shown.
      if (permission === 'prompt' && !userInitiated) throw new GestureNeededError();
      await reopenMicrophone(session);
    }
    connect();
  }

  async function runRecovery(userInitiated: boolean, session: number) {
    lastRecoveryAt = dependencies.now();
    recoveriesInARow++;
    recoveries++;
    recovery = { running: true };
    evaluate();
    try {
      if (worker === undefined || models.phase === 'failed' || (listening && workerSilent())) restartWorker();
      await load();
      giveUpIfOvertaken(session);
      if (listening) await recoverAudio(userInitiated, session);
      recovery = { running: false };
    } catch (error) {
      // An overtaken recovery's outcome is about listening that has ended; the session that
      // overtook it has already reset what recovering means, and nobody is waiting on it.
      if (overtaken(session)) return;
      recovery = {
        running: false,
        failure: { problem: describe(error), needsGesture: error instanceof GestureNeededError },
      };
      throw error;
    } finally {
      evaluate();
    }
  }

  function recover(userInitiated: boolean) {
    if (recovering !== undefined) return recovering;
    const running = runRecovery(userInitiated, listeningSession).finally(() => {
      // A new session may have forgotten this recovery and begun another one meanwhile.
      if (recovering === running) recovering = undefined;
    });
    recovering = running;
    return running;
  }

  return {
    prepare(onProgress) {
      if (disposed) return Promise.reject(new Error('The wake engine was disposed.'));
      if (models.phase === 'ready') {
        onProgress?.(1);
        return Promise.resolve();
      }
      if (onProgress !== undefined) progressListeners.add(onProgress);
      return load();
    },
    start,
    stop,
    arm() {
      armed = true;
      worker?.post({ type: 'arm' });
      evaluate();
    },
    disarm() {
      armed = false;
      worker?.post({ type: 'disarm' });
      evaluate();
    },
    onWake(listener) {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    },
    onHealth(listener) {
      healthListeners.add(listener);
      return () => healthListeners.delete(listener);
    },
    get health() {
      return health;
    },
    get diagnostics() {
      const track = listening ? stream?.getAudioTracks()[0] : undefined;
      return {
        contextState: graph?.state,
        sampleRate: graph?.sampleRate,
        trackState: track?.readyState,
        trackMuted: track?.muted,
        droppedChunks: stats.rates().latest?.counters.dropped ?? 0,
        recoveries,
        profile: dependencies.profile,
      };
    },
    rebuild() {
      if (disposed) return Promise.reject(new Error('The wake engine was disposed.'));
      return recover(true);
    },
    dispose() {
      disposed = true;
      beginListeningSession();
      stopWatchdog();
      listening = false;
      useStream(undefined, false);
      releaseOwnStream();
      restartWorker();
      graph?.close();
      graph = undefined;
      wakeListeners.clear();
      healthListeners.clear();
      progressListeners.clear();
    },
  };
}
