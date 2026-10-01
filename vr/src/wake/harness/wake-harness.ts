import { createWakeEngine, type MicrophoneProfile, openWakeMicrophone, type WakeHealth } from '../index';

/**
 * A page with nothing on it but the wake engine, for the browser test.
 *
 * The app's own page will use the engine once the rest of the headset app is wired to it; until
 * then — and afterwards, to test the wake word without a headset and a room — this is the real
 * engine in a real browser: the worker built by Vite, onnxruntime-web loading its glue from
 * `vendor/`, the AudioWorklet in a 16 kHz context, a real (fake-device) microphone.
 * `tests/e2e/wake.spec.ts` builds it with the app's Vite config and reads `window.__wakeCheck`.
 */

export interface WakeCheck {
  health: WakeHealth;
  /** Every loading fraction the engine reported. */
  progress: number[];
  /** The score of every wake. */
  wakes: number[];
  /** The highest health score seen while listening. */
  highestScore: number;
  /** Whether `prepare` has finished. */
  prepared: boolean;
  /** The last thing that went wrong, as its message. */
  problem: string | null;
}

declare global {
  interface Window {
    __wakeCheck?: WakeCheck;
  }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const profile: MicrophoneProfile = new URLSearchParams(location.search).get('profile') === 'raw' ? 'raw' : 'processed';
const engine = createWakeEngine({ assetBase: new URL('./', document.baseURI), profile });
const check: WakeCheck = {
  health: engine.health,
  progress: [],
  wakes: [],
  highestScore: 0,
  prepared: false,
  problem: null,
};
window.__wakeCheck = check;

const healthLine = document.querySelector('#health');
engine.onHealth((health) => {
  check.health = health;
  check.highestScore = Math.max(check.highestScore, health.score);
  if (healthLine !== null) healthLine.textContent = JSON.stringify(health, null, 2);
});
engine.onWake((score) => check.wakes.push(score));

engine
  .prepare((fraction) => check.progress.push(fraction))
  .then(
    () => {
      check.prepared = true;
    },
    (error: unknown) => {
      check.problem = describe(error);
    },
  );

document.querySelector('#listen')?.addEventListener('click', () => {
  openWakeMicrophone(profile)
    .then((stream) => engine.start(stream))
    .then(() => engine.arm())
    .catch((error: unknown) => {
      check.problem = describe(error);
    });
});
