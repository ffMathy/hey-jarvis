/**
 * The wake engine's public surface: what the app sees of "Hey Jarvis".
 *
 * Types only, so the app shell, the HUD and the tests can name them without loading anything.
 */

/**
 * Where the engine is.
 *
 * - `unloaded`: `prepare` has not been called.
 * - `loading`: onnxruntime-web and the three models are downloading and loading in the worker.
 * - `warming`: the models are running the warm-up.
 * - `ready`: loaded and warmed, but not (yet) hearing live audio — not started, just started,
 *   reconnecting, muted, or disarmed before anything was scored.
 * - `listening`: the models have scored a chunk of live audio from this stream, and it is flowing.
 * - `broken`: something failed; `problem` says what, and `rebuild` is the way back.
 */
export type WakeState = 'unloaded' | 'loading' | 'warming' | 'ready' | 'listening' | 'broken';

export interface WakeHealth {
  state: WakeState;
  /** Why it is broken or not listening, in words for the status line; undefined when listening. */
  problem?: string;
  /** 80 ms chunks processed per second over the last 2 s (12.5 when healthy). */
  chunksPerSecond: number;
  /** Mean inference time per chunk, ms. */
  millisecondsPerChunk: number;
  /** RMS of the last chunk, 0–1 (float scale), for the HUD and the "microphone muted?" check. */
  level: number;
  /** Latest wake score 0–1. */
  score: number;
  armed: boolean;
  /**
   * Whether `rebuild` has to be called inside a user gesture (an XR select) to recover: the
   * engine's own attempt could not get audio running again without one.
   */
  needsGesture: boolean;
}

/**
 * The microphone's processing.
 *
 * `processed` (echo cancellation, noise suppression and automatic gain on) is the default: it is
 * what the ElevenLabs SDK asks for, so the wake stream and the call's capture are the same kind
 * and Android never switches its audio mode in the middle of the greeting — which is what made
 * the phone's greeting clipped and thin. `raw` (all three off) is for trying on a headset whether
 * openWakeWord hears better without them; it is chosen in `?debug`.
 */
export type MicrophoneProfile = 'processed' | 'raw';

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** What the `?debug` HUD shows about the wake engine beyond its health. */
export interface WakeDiagnostics {
  /** The wake AudioContext's state ('running', 'suspended', 'interrupted', 'closed'); undefined before `start`. */
  contextState: string | undefined;
  /** The rate that context really runs at: 16000, unless the browser ignored the request and the worklet resamples. */
  sampleRate: number | undefined;
  /** The microphone track being listened to; undefined when not listening. */
  trackState: 'live' | 'ended' | undefined;
  trackMuted: boolean | undefined;
  /** Chunks dropped since the stream was last connected, because inference fell behind. */
  droppedChunks: number;
  /** Recoveries attempted since the engine was created. */
  recoveries: number;
  profile: MicrophoneProfile;
}

export interface WakeEngine {
  /** Loads ORT + the three models in the worker and runs the warm-up. Safe to call before any gesture. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
  /**
   * Starts listening to this stream. Call inside a user gesture the first time (creates/resumes the
   * 16 kHz AudioContext). The stream is NOT stopped by the engine; `dispose` stops what it opened itself.
   */
  start(stream: MediaStream): Promise<void>;
  /**
   * Stops listening, keeping the models loaded and the audio context running (never suspended).
   * For when the XR session ends and the app stops its own microphone tracks: without it, the
   * watchdog would see the stream end and open the microphone again.
   */
  stop(): void;
  /** Detections on. Resets the buffers and starts the refractory period now. */
  arm(): void;
  /** Detections off (audio still flows, so health stays observable). */
  disarm(): void;
  onWake(listener: (score: number) => void): () => void;
  onHealth(listener: (health: WakeHealth) => void): () => void;
  readonly health: WakeHealth;
  /** For the HUD: the audio context, the track and the counters behind the health. */
  readonly diagnostics: WakeDiagnostics;
  /** Watchdog recovery; may need user activation (call again inside a select if it rejects). */
  rebuild(): Promise<void>;
  dispose(): void;
}
