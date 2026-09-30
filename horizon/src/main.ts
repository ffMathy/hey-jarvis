import type { ElevenLabsSettings } from 'hologram';
import type { RoomOptions } from './app/room-runtime';
import { createGreetingPlayer } from './conversation/greeting-player';
import { greetingRecordingUrl } from './conversation/greeting-recording';
import { initialDebugState, publishDebugState } from './debug-hook';
import type { Painter } from './hologram3d/canvaskit';
import { createBrowserMicrophoneKeeper } from './page/microphone';
import { type RoomOutcome, startPage } from './page/page';
import type { PreparationTask } from './page/preparation';
import type { KeyValueStorage } from './page/settings';
import type { Diagnostics } from './ui3d/debug-hud';
import {
  createWakeEngine,
  type MicrophonePermission,
  type MicrophoneProfile,
  microphonePermission,
  openWakeMicrophone,
} from './wake';
import { WAKE_FILES } from './wake/wake-assets';
import { canEnterRoom, requestRoomSession } from './xr/room-session';

/**
 * The headset app: the 2D page, and the room it opens.
 *
 * This file is where the parts are chosen. The page (`page/`) walks the user to the room; the room
 * (`app/room-runtime.ts`) runs the state machine over the XR stage; and what fills the room comes
 * in through the ports in `app/ports.ts`: the wake engine (`wake/`), the ElevenLabs session
 * (`conversation/`), the 3D hologram (`hologram3d/`) and the room model (`room/`).
 *
 * What is loaded when matters on a headset, whose browser fetches over Wi-Fi and compiles on a
 * phone's chip. The page itself, the wake engine and the greeting's player are here, because the
 * page needs them from its first frame: the wake-word models load and warm up while the user reads
 * it, and the Enter tap has to reach the engine and the player before it awaits anything. The room
 * — three, the hologram, the placement worker's client — and the ElevenLabs SDK are loaded apart,
 * but started at once rather than on the tap, so they have usually arrived by the time someone has
 * found the button; the SDK and LiveKit are about 600 kB on their own, which the page never needs.
 *
 * URL flags: `?debug` shows the diagnostics HUD in the room, `?flat` draws him as the phone's flat
 * picture instead of in 3D, and `?microphone=raw` listens for the wake word without echo
 * cancellation, noise suppression or gain control, to try on a headset whether it hears better.
 */

const debug = publishDebugState(initialDebugState());
const flags = new URLSearchParams(window.location.search);
const assetBase = new URL('./', document.baseURI);

const roomLoading = Promise.all([
  import('./app/room-runtime'),
  import('./app/room-placement'),
  import('./hologram3d'),
  import('./room'),
]);
const conversationLoading = Promise.all([import('@elevenlabs/client'), import('./conversation/jarvis-session')]);
// Awaited on entering the room; until then a failure only has to not be reported twice.
roomLoading.catch(() => undefined);
conversationLoading.catch(() => undefined);

const microphoneProfile: MicrophoneProfile = flags.get('microphone') === 'raw' ? 'raw' : 'processed';
const wake = createWakeEngine({ assetBase, profile: microphoneProfile });
const microphone = createBrowserMicrophoneKeeper(microphoneProfile);
const greeting = createGreetingPlayer(greetingRecordingUrl());

/**
 * CanvasKit's download is about 8 MB, a third of the wake word's; the two weight the page's one
 * progress bar by what each has to fetch.
 */
const CANVASKIT_BYTES = 8_100_000;
const WAKE_BYTES = Object.values(WAKE_FILES).reduce((sum, file) => sum + file.bytes, 0);

let painterLoading: Promise<Painter> | undefined;

/**
 * CanvasKit and the Skia API over it, loaded once for the page and every room after it — or
 * loaded again after a failure, which is what the page's "Try getting ready again" is for.
 */
function loadPainterOnce(): Promise<Painter> {
  if (painterLoading === undefined) {
    const loading = import('./hologram3d/canvaskit').then(({ loadPainter }) =>
      loadPainter(new URL('vendor/', assetBase)),
    );
    painterLoading = loading;
    loading.catch(() => {
      if (painterLoading === loading) painterLoading = undefined;
    });
  }
  return painterLoading;
}

const preparations: PreparationTask[] = [
  { name: 'the wake-word models', weight: WAKE_BYTES, run: (onProgress) => wake.prepare(onProgress) },
  {
    name: 'his drawing',
    weight: CANVASKIT_BYTES,
    run: async (onProgress) => {
      await loadPainterOnce();
      onProgress(1);
    },
  },
];

let listeningAudio: AudioContext | undefined;

/**
 * The app's one AudioContext, which his voice is analysed on once he is connected (the wake engine
 * has its own at 16 kHz). Created, or resumed, inside the Enter tap: only while a gesture is
 * running may a context start.
 */
function resumeListeningAudio(): AudioContext {
  listeningAudio ??= new AudioContext();
  listeningAudio.resume().catch(() => undefined);
  return listeningAudio;
}

/**
 * Starts the wake engine on the microphone, inside the Enter tap.
 *
 * On the stream the page's microphone step opened when there is one, synchronously, so the
 * engine's 16 kHz context is created inside the gesture. When the permission was already granted
 * there was no such step, and a stream is opened now; the engine then starts once it arrives,
 * which Chromium — Quest Browser — allows, since the page has had a tap, and which the engine's
 * watchdog would otherwise report as needing a select.
 */
function startListening(): Promise<MediaStream> {
  const kept = microphone.take();
  // A start that fails is reported by the engine's health, on the room's status line.
  if (kept !== undefined) {
    wake.start(kept).catch(() => undefined);
    return Promise.resolve(kept);
  }
  return openWakeMicrophone(microphoneProfile).then((stream) => {
    wake.start(stream).catch(() => undefined);
    return stream;
  });
}

let lastPermission: MicrophonePermission | undefined;

/** What the room cannot see itself, for the `?debug` HUD. */
function roomDiagnostics(): Partial<Diagnostics> {
  // Read without prompting, for the next refresh: the HUD is rewritten twice a second.
  void microphonePermission().then((permission) => {
    lastPermission = permission;
  });
  const audio = wake.diagnostics;
  return {
    audioContext: listeningAudio?.state,
    microphonePermission: lastPermission,
    microphoneTrack: audio.trackMuted ? 'muted' : audio.trackState,
    wakeAudio: {
      contextState: audio.contextState,
      sampleRate: audio.sampleRate,
      droppedChunks: audio.droppedChunks,
      recoveries: audio.recoveries,
      profile: audio.profile,
    },
  };
}

type RoomModules = Awaited<typeof roomLoading>;

/** What every room is made with, whichever mode it is in. */
function sharedRoomOptions(modules: RoomModules, onInside: () => void) {
  const [, { createRoomPlacement }, { createJarvisHologram3D }, { createRoomModelWorker, createRoomTracker }] = modules;
  return {
    createHologram: async (renderer) => {
      const hologram = await createJarvisHologram3D(renderer, { assetBase, painter: loadPainterOnce() });
      if (flags.has('flat')) hologram.mode = 'flat';
      return hologram;
    },
    // A new model for every room: the snapshots are in the session's own reference space, which
    // is gone with the session.
    placement: createRoomPlacement<XRReferenceSpace>({
      model: createRoomModelWorker(),
      track: (referenceSpace) => createRoomTracker(referenceSpace),
      now: () => performance.now(),
      setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
      clearTimeout: (handle) => window.clearTimeout(handle),
    }),
    showHud: flags.has('debug'),
    debug,
    onInside,
  } satisfies Omit<RoomOptions, 'mode'>;
}

/** Sample mode's room: no key, no microphone, the moods driving him. */
async function openSampleRoom(sessionRequest: Promise<XRSession>, onInside: () => void): Promise<RoomOutcome> {
  const session = await sessionRequest;
  try {
    const modules = await roomLoading;
    const [{ runRoom }] = modules;
    return await runRoom(session, { ...sharedRoomOptions(modules, onInside), mode: 'sample' });
  } catch (error) {
    // A session nothing is drawing in is an empty room the user would have to find their own way
    // out of, so one that opened before the failure is closed with it.
    session.end().catch(() => undefined);
    throw error;
  }
}

/** The real room: the wake word listening, and an ElevenLabs session on every summon. */
async function openConversationRoom(
  sessionRequest: Promise<XRSession>,
  settings: ElevenLabsSettings,
  audioContext: AudioContext,
  listening: Promise<MediaStream>,
  onInside: () => void,
): Promise<RoomOutcome> {
  let stream: MediaStream | undefined;
  // The engine first: its watchdog would see the tracks end and open the microphone again.
  const stopMicrophone = () => {
    wake.stop();
    for (const track of stream?.getTracks() ?? []) track.stop();
  };
  let session: XRSession | undefined;
  try {
    session = await sessionRequest;
    stream = await listening;
    const [modules, [{ Conversation }, { createJarvisSession }]] = await Promise.all([
      roomLoading,
      conversationLoading,
    ]);
    const [{ runRoom }] = modules;
    return await runRoom(session, {
      ...sharedRoomOptions(modules, onInside),
      mode: 'conversation',
      wake,
      createConversation: (events) =>
        createJarvisSession({ settings, startSession: Conversation.startSession, greeting, audioContext, events }),
      stopMicrophone,
      diagnostics: flags.has('debug') ? roomDiagnostics : undefined,
    });
  } catch (error) {
    // A microphone still opening when the session was refused is stopped once it has opened.
    stream ??= await listening.catch(() => undefined);
    stopMicrophone();
    session?.end().catch(() => undefined);
    throw error;
  }
}

/**
 * `localStorage`, reached for on every call rather than once: reading the property itself throws
 * when the browser has storage switched off, and the settings code turns a throw into "nothing
 * stored" only where it happens inside a call.
 */
const browserStorage: KeyValueStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

startPage(document, {
  storage: browserStorage,
  // Handed on as the plain global and only ever called as a plain function, which is how the
  // browser's fetch expects to be called.
  fetch,
  microphone,
  preparations,
  canEnterRoom: () => canEnterRoom(navigator.xr),
  enterRoom: (mode, settings, onInside) => {
    const xr = navigator.xr;
    if (xr === undefined) return Promise.reject(new Error('This browser has no WebXR.'));
    if (mode === 'sample') return openSampleRoom(requestRoomSession(xr), onInside);
    if (settings === undefined) return Promise.reject(new Error('Add your ElevenLabs key first.'));
    // All of this before anything is awaited, while the click's activation still counts: the
    // audio context his voice is analysed on, the greeting's player (an element that has played
    // inside a gesture may play again outside one), the wake engine's own context — and last the
    // session, which needs the activation too.
    const audioContext = resumeListeningAudio();
    void greeting.prime();
    const listening = startListening();
    return openConversationRoom(requestRoomSession(xr), settings, audioContext, listening, onInside);
  },
  debug,
});
