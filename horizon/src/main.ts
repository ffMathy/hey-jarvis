import { initialDebugState, publishDebugState } from './debug-hook';
import { createBrowserMicrophoneGate } from './page/microphone';
import { type RoomMode, type RoomOutcome, startPage } from './page/page';
import type { KeyValueStorage } from './page/settings';
import { canEnterRoom, requestRoomSession } from './xr/room-session';

/**
 * The headset app: the 2D page, and the room it opens.
 *
 * This file is where the parts are chosen. The page (`page/`) walks the user to the room; the room
 * (`app/room-runtime.ts`) runs the state machine over the XR stage; and what fills the room comes
 * in through the ports in `app/ports.ts`. Today those are Milestone 0's stand-ins — the phone's
 * flat drawing, put 1.6 m ahead, summoned on entering because there is no wake word yet to wait
 * for, with no conversation — and each of the other modules replaces one of them here:
 *
 * - `src/wake/`: a preparation task for the page (`wake.prepare`), `wake` in the room options,
 *   the microphone gate's permission check (`microphonePermission`), and `stopMicrophone`; then
 *   `summonOnEntry` goes, since the wake word is how he is summoned.
 * - `src/conversation/`: `createConversation`, making a `JarvisSession` from the saved settings.
 * - `src/hologram3d/`: `createHologram`, with `createJarvisHologram3D` (`?flat` keeps this one).
 * - `src/room/`: `placement`, with the room model and its per-frame snapshot in `observe`.
 */

const debug = publishDebugState(initialDebugState());
const flags = new URLSearchParams(window.location.search);

// The room — three, the hologram, CanvasKit and its wasm — is loaded apart from the page, so the
// page can show its button before megabytes of rendering have arrived; but it is started at once,
// not on the click, so by the time someone has found the button it is usually here.
const roomLoading = import('./app/room-runtime');
const standInsLoading = import('./app/milestone-zero');
const painterLoading = import('./hologram3d/canvaskit').then(({ loadPainter }) =>
  loadPainter(new URL('vendor/', document.baseURI)),
);
// Awaited on entering the room; until then a failure only has to not be reported twice.
roomLoading.catch(() => undefined);
standInsLoading.catch(() => undefined);
painterLoading.catch(() => undefined);

/**
 * `localStorage`, reached for on every call rather than once: reading the property itself throws
 * when the browser has storage switched off, and the settings code turns a throw into "nothing
 * stored" only where it happens inside a call.
 */
const browserStorage: KeyValueStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

async function openRoom(
  sessionRequest: Promise<XRSession>,
  mode: RoomMode,
  onInside: () => void,
): Promise<RoomOutcome> {
  const session = await sessionRequest;
  try {
    const [{ runRoom }, standIns] = await Promise.all([roomLoading, standInsLoading]);
    return await runRoom(session, {
      mode,
      createHologram: async () => {
        const hologram = standIns.createFlatHologramStandIn(await painterLoading);
        debug.surface = hologram.surface;
        return hologram;
      },
      placement: standIns.createAheadPlacement(),
      summonOnEntry: true,
      showHud: flags.has('debug'),
      debug,
      onInside,
    });
  } catch (error) {
    // A session nothing is drawing in is an empty room the user would have to find their own way
    // out of, so one that opened before the failure is closed with it.
    session.end().catch(() => undefined);
    throw error;
  }
}

startPage(document, {
  storage: browserStorage,
  // Handed on as the plain global and only ever called as a plain function, which is how the
  // browser's fetch expects to be called.
  fetch,
  microphone: createBrowserMicrophoneGate(),
  preparations: [],
  canEnterRoom: () => canEnterRoom(navigator.xr),
  enterRoom: (mode, _settings, onInside) => {
    const xr = navigator.xr;
    if (xr === undefined) return Promise.reject(new Error('This browser has no WebXR.'));
    // Asked for here, before anything is awaited, while the click's activation still counts.
    return openRoom(requestRoomSession(xr), mode, onInside);
  },
  debug,
});
