import { connectToServer, type ElevenLabsSettings } from 'hologram';
import type { RoomOptions } from './app/room-runtime';
import { createGreetingPlayer } from './conversation/greeting-player';
import { greetingRecordingUrl } from './conversation/greeting-recording';
import type { SpatialVoice } from './conversation/spatial-voice';
import { initialDebugState, publishDebugState } from './debug-hook';
import type { Painter } from './hologram3d/canvaskit';
import { createBrowserMicrophoneKeeper } from './page/microphone';
import { type RoomOutcome, startPage } from './page/page';
import type { PreparationTask } from './page/preparation';
import { type KeyValueStorage, loadServerAddress } from './page/settings';
import { loadVoiceFromWhereHeStands } from './page/voice-setting';
import { readTestSeams } from './test-seams';
import type { Diagnostics } from './ui3d/debug-hud';
import {
  createWakeEngine,
  type MicrophonePermission,
  type MicrophoneProfile,
  microphonePermission,
  openWakeMicrophone,
} from './wake';
import { WAKE_FILES } from './wake/wake-assets';
import { parseOriginOffset } from './xr/origin-offset';
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
 * it, and the Enter tap has to reach the engine and the player before it awaits anything. (The
 * player is imported from its own files: `conversation/`'s surface brings the session and LiveKit
 * with it.) The room — three, the hologram, the placement worker's client — and the ElevenLabs SDK
 * are loaded apart, but started at once rather than on the tap, so they have usually arrived by the
 * time someone has found the button; the SDK and LiveKit are about 600 kB on their own, which the
 * page never needs.
 *
 * URL flags: `?debug` shows the diagnostics HUD in the room, `?flat` draws him as the phone's flat
 * picture instead of in 3D, `?microphone=raw` listens for the wake word without echo cancellation,
 * noise suppression or gain control, to try on a headset whether it hears better, and
 * `?voice=spatial` plays his voice from where he stands even when the microphone says the headset
 * has no echo canceller of its own that could keep it out (see `conversation/voice-route.ts`),
 * `?film` is for recordings: sample mode goes without its frame-rate readout, which in the demo
 * video (`.scripts/render-demo.ts`, shot on a faked clock) would only report that clock, and
 * `?origin=x,z,yawDegrees` moves the room's space from where the headset put it, which only the
 * browser tests want (`xr/origin-offset.ts`). They alone want two more, because the emulator draws
 * too slowly to race the budgets they hold (`test-seams.ts`): `?deadline=never`, the session never
 * giving up on a conversation that has not opened, and `?errors=held`, an error panel staying up
 * until it is dismissed.
 */

const debug = publishDebugState(initialDebugState());
const flags = new URLSearchParams(window.location.search);
const seams = readTestSeams(flags);
const assetBase = new URL('./', document.baseURI);

const roomLoading = Promise.all([
  import('./app/room-runtime'),
  import('./app/room-placement'),
  import('./hologram3d'),
  import('./room'),
]);
const conversationLoading = Promise.all([import('@elevenlabs/client'), import('./conversation')]);
// Awaited on entering the room; until then a failure only has to not be reported twice.
roomLoading.catch(() => undefined);
conversationLoading.catch(() => undefined);

const microphoneProfile: MicrophoneProfile = flags.get('microphone') === 'raw' ? 'raw' : 'processed';
const wake = createWakeEngine({ assetBase, profile: microphoneProfile });
const microphone = createBrowserMicrophoneKeeper(microphoneProfile);
// Made here rather than inside the player, because his spatial voice takes this very element into
// the AudioContext to place the greeting where he stands (`conversation/spatial-voice.ts`).
const greetingElement = new Audio();
const greeting = createGreetingPlayer(greetingRecordingUrl(), () => greetingElement);

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
 * `localStorage`, reached for on every call rather than once: reading the property itself throws
 * when the browser has storage switched off, and the settings code turns a throw into "nothing
 * stored" only where it happens inside a call.
 */
const browserStorage: KeyValueStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

/**
 * The page's line to sir's Jarvis server, opened as the page loads and held for as long as it is
 * open: through the 2D page, every room and every conversation in it, and between them
 * (`connectToServer` in `hologram`). Each conversation's session listens to it while it lasts — what
 * a request touched lights up in the room — and tells it what sir points at. With no address kept on
 * this origin by the phone's web build, it is no line at all.
 */
const serverLink = connectToServer({ address: loadServerAddress(browserStorage), device: 'vr' });

/**
 * His voice from where he stands, made once for the page: it can take the greeting's element into
 * the AudioContext only once, and a demotion it has seen — his voice coming back through the
 * microphone — should hold for every room after it.
 */
let spatialVoice: SpatialVoice | undefined;

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
    voice: spatialVoice?.diagnostics(),
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
    createPlacement: () =>
      createRoomPlacement<XRReferenceSpace>({
        model: createRoomModelWorker(),
        track: (referenceSpace) => createRoomTracker(referenceSpace),
        now: () => performance.now(),
        setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
        clearTimeout: (handle) => window.clearTimeout(handle),
      }),
    showHud: flags.has('debug'),
    showReadout: !flags.has('film'),
    // Every room remembers where sir put things: the registry and the anchors outlive the session.
    entityStorage: browserStorage,
    origin: parseOriginOffset(flags.get('origin')),
    holdErrors: seams.holdErrors,
    debug,
    onInside,
  } satisfies Omit<RoomOptions, 'mode'>;
}

/**
 * A room with no conversation in it: sample mode, the moods driving him, or placing things, straight
 * into the drawer. Neither needs a key or a microphone.
 */
async function openRoomWithoutAgent(
  mode: 'sample' | 'placement',
  sessionRequest: Promise<XRSession>,
  onInside: () => void,
): Promise<RoomOutcome> {
  const session = await sessionRequest;
  try {
    const modules = await roomLoading;
    const [{ runRoom }] = modules;
    return await runRoom(session, { ...sharedRoomOptions(modules, onInside), mode });
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
  voiceFromWhereHeStands: boolean,
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
    const [modules, [{ Conversation }, conversation]] = await Promise.all([roomLoading, conversationLoading]);
    const [{ runRoom }] = modules;
    // The wake word's own microphone says which echo canceller the call's capture will have, since
    // both ask for the same processing from the same device.
    const choice = {
      setting: voiceFromWhereHeStands,
      forced: flags.get('voice') === 'spatial',
      echoCanceller: conversation.probeEchoCanceller(stream.getAudioTracks()[0]),
      webAudio: conversation.hasSpatialAudio(audioContext),
    };
    const voice = spatialVoice ?? conversation.createPageSpatialVoice(audioContext, greetingElement, choice);
    spatialVoice = voice;
    voice.choose(choice);
    debug.voice = voice.report;
    return await runRoom(session, {
      ...sharedRoomOptions(modules, onInside),
      mode: 'conversation',
      wake,
      voice,
      createConversation: (events) =>
        conversation.createHeadsetSession({
          settings,
          startSession: Conversation.startSession,
          greeting,
          audioContext,
          events,
          voice,
          giveUpConnectingAfterMs: seams.giveUpConnectingAfterMs,
          server: serverLink,
          onAffected: (entities) => events.onAffected?.(entities),
        }),
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
    if (mode !== 'conversation') return openRoomWithoutAgent(mode, requestRoomSession(xr), onInside);
    if (settings === undefined) return Promise.reject(new Error('Add your ElevenLabs key first.'));
    // All of this before anything is awaited, while the click's activation still counts: the
    // audio context his voice is analysed on, the greeting's player (an element that has played
    // inside a gesture may play again outside one), the wake engine's own context — and last the
    // session, which needs the activation too.
    const audioContext = resumeListeningAudio();
    void greeting.prime();
    const listening = startListening();
    const voiceFromWhereHeStands = loadVoiceFromWhereHeStands(browserStorage);
    return openConversationRoom(
      requestRoomSession(xr),
      settings,
      audioContext,
      listening,
      voiceFromWhereHeStands,
      onInside,
    );
  },
  debug,
});
