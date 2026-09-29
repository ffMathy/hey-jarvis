import { initialDebugState, publishDebugState } from './debug-hook';
import { canEnterRoom, requestRoomSession } from './xr/room-session';

/**
 * The headset app's page: one button that takes you into your room, where Jarvis is.
 *
 * The 2D page is the only place a headset session can start from — entering an immersive
 * session needs a click — and the place you come back to when it ends.
 */

const debug = publishDebugState(initialDebugState());

function required<Found extends Element>(selector: string, kind: new () => Found): Found {
  const element = document.querySelector(selector);
  if (!(element instanceof kind)) {
    throw new Error(`The page has no ${selector}.`);
  }
  return element;
}

const enterButton = required('#enter-room', HTMLButtonElement);
const status = required('#status', HTMLElement);

function say(message: string) {
  status.textContent = message;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// The room — three, the hologram, CanvasKit and its wasm — is loaded apart from the page, so the
// page can show its button before megabytes of rendering have arrived; but it is started at
// once, not on the click, so by the time someone has found the button it is usually here.
const roomLoading = import('./xr/room-view');
const painterLoading = import('./hologram3d/canvaskit').then(({ loadPainter }) =>
  loadPainter(new URL('vendor/', document.baseURI)),
);
// Awaited on entering the room; until then a failure only has to not be reported twice.
roomLoading.catch(() => undefined);
painterLoading.catch(() => undefined);

async function enterRoom(sessionRequest: Promise<XRSession>) {
  let session: XRSession | undefined;
  try {
    session = await sessionRequest;
    say('');
    const [{ showJarvisInRoom }, painter] = await Promise.all([roomLoading, painterLoading]);
    await showJarvisInRoom(session, painter, debug);
    debug.phase = 'ready';
    say('');
  } catch (error) {
    // A session nothing is drawing in is an empty room the user would have to find their own
    // way out of, so one that opened before the failure is closed with it.
    session?.end().catch(() => undefined);
    debug.phase = 'failed';
    debug.problem = describe(error);
    say(`Jarvis could not join you: ${debug.problem}`);
  } finally {
    enterButton.disabled = false;
  }
}

enterButton.addEventListener('click', () => {
  const xr = navigator.xr;
  if (xr === undefined) return;
  enterButton.disabled = true;
  debug.phase = 'entering';
  debug.problem = null;
  say('Opening your room…');
  // Asked for here, before anything is awaited, while the click's activation still counts.
  void enterRoom(requestRoomSession(xr));
});

async function checkSupport() {
  if (await canEnterRoom(navigator.xr)) {
    debug.phase = 'ready';
    enterButton.disabled = false;
    say('');
  } else {
    debug.phase = 'unsupported';
    say('This browser cannot put Jarvis in your room. Open this page in the browser on a Meta Quest.');
  }
}

void checkSupport();
