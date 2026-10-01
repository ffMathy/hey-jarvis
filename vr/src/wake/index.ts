import { createWakeAudioGraph } from './audio-graph';
import { microphonePermission, openWakeMicrophone } from './microphone';
import type { MicrophoneProfile, WakeEngine } from './types';
import { assembleWakeEngine } from './wake-engine';
import { toWakeWorkerEvent } from './worker-protocol';

/**
 * "Hey Jarvis": the wake engine, and the microphone it listens to.
 *
 * openWakeWord's models on onnxruntime-web in a worker, fed by an AudioWorklet in a 16 kHz
 * AudioContext, watched by a watchdog that says in words why it is not listening and gets it
 * listening again. See vr/AGENTS.md for how the pieces fit.
 */

export { MICROPHONE_BLOCKED, microphonePermission, openWakeMicrophone } from './microphone';
export type {
  MicrophonePermission,
  MicrophoneProfile,
  WakeDiagnostics,
  WakeEngine,
  WakeHealth,
  WakeState,
} from './types';
export { GestureNeededError } from './wake-engine';
export { WAKE_PROBLEMS } from './wake-health';

export interface WakeEngineOptions {
  /** The folder the page is served from (`new URL('./', document.baseURI)`): `vendor/` and `models/` are under it. */
  assetBase: URL;
  /** The microphone processing a recovery reopens the microphone with; `processed` unless `?debug` says otherwise. */
  profile?: MicrophoneProfile;
}

export function createWakeEngine(options: WakeEngineOptions): WakeEngine {
  return assembleWakeEngine<MediaStream>({
    assetBase: options.assetBase,
    profile: options.profile ?? 'processed',
    spawnWorker(onEvent, onCrash) {
      const worker = new Worker(new URL('./wake.worker.ts', import.meta.url), { type: 'module', name: 'wake word' });
      worker.addEventListener('message', (event) => {
        const parsed = toWakeWorkerEvent(event.data);
        if (parsed !== undefined) onEvent(parsed);
      });
      // An error the worker's own code did not catch: its script failed to load, or it threw
      // outside the core's handling. Reported as the models failing, so `rebuild` starts a new one.
      worker.addEventListener('error', (event) => {
        event.preventDefault();
        onCrash(event.message || 'it could not start');
      });
      worker.addEventListener('messageerror', () => onCrash('a message from it could not be read'));
      return {
        post: (request, transfer = []) => worker.postMessage(request, transfer),
        terminate: () => worker.terminate(),
      };
    },
    createAudioGraph: createWakeAudioGraph,
    openMicrophone: openWakeMicrophone,
    microphonePermission: () => microphonePermission(),
    now: () => performance.now(),
    setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    clearInterval: (handle) => clearInterval(handle),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  });
}
