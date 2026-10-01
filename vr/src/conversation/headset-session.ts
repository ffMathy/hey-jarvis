import {
  type AffectedEntity,
  type AgentTrackRoom,
  createJarvisSession,
  type ElevenLabsSettings,
  followConversationOnServer,
  type GreetingPlayer,
  HEADSET_PARTICIPANT_NAME,
  type JarvisServerMessage,
  type JarvisSession,
  type JarvisSessionDependencies,
  type JarvisSessionEvents,
  type JarvisVoiceReaders,
  type ServerFollowing,
  type StartSession,
} from 'hologram';
import { findAgentRoom, followAgentVoice, type ListeningAudioContext, watchAgentRoom } from './agent-room';
import { removeOrphanedAudioFromPage } from './orphaned-audio';
import type { SpatialVoice } from './spatial-voice';

/**
 * No platform delay before dialling: the SDK's three seconds are for Android phones, and a Quest
 * browser may or may not say Android depending on its mode. See `ConnectionDelay` in `hologram`.
 */
export const NO_CONNECTION_DELAY = { default: 0, android: 0 };

/** A token request that reached no server, in words for somebody wearing the headset. */
export const HEADSET_OFFLINE_PROBLEM =
  'ElevenLabs could not be reached. Check that the headset is connected to the internet.';

/** What the room hands over for each session; the rest is the headset's and is filled in here. */
export interface HeadsetSessionOptions {
  settings: ElevenLabsSettings;
  /** Conversation.startSession from '@elevenlabs/client'. */
  startSession: StartSession;
  greeting: GreetingPlayer;
  events: JarvisSessionEvents;
  /** For Jarvis's track analyser; the app's single AudioContext (not the wake engine's 16 kHz one). */
  audioContext: ListeningAudioContext;
  /**
   * Where his voice comes from (`spatial-voice.ts`), on the same AudioContext. Without it he is
   * played from the headset by the SDK's own element, as he always was.
   */
  voice?: HeadsetVoice;
  /**
   * How long a summoning waits for its conversation to open, when not the session's own deadline:
   * only ever `Infinity`, from the browser tests' `?deadline=never` (`test-seams.ts`).
   */
  giveUpConnectingAfterMs?: number;
  /**
   * The Jarvis server's address, when the phone's web build has kept one on this origin: a line to
   * the server is kept open for every conversation that connects (`jarvis-server-link.ts` in
   * `hologram`). Without it, none.
   */
  serverAddress?: string;
  /**
   * The entities a request touched, every time the server says so over that line (its
   * `affectedEntities` message, validated and never empty): the room records them and lights them
   * up where they stand. Without a server address it is never called.
   */
  onAffected?(entities: readonly AffectedEntity[]): void;
}

/** What {@link headsetSessionDependencies} makes the session from: everything but the server's line. */
export type HeadsetSessionDependencyOptions = Omit<HeadsetSessionOptions, 'serverAddress' | 'onAffected'>;

/** As much of the spatial voice as a conversation reaches for. */
export type HeadsetVoice = Pick<
  SpatialVoice,
  | 'greeting'
  | 'playAgent'
  | 'conversationOpened'
  | 'attached'
  | 'interrupted'
  | 'heard'
  | 'halfDuplexMayJudge'
  | 'halfDuplexChanged'
>;

/**
 * Follows his track for the sphere and, when there is a spatial voice, for the ears too: the room is
 * watched for the elements LiveKit plays him through and for the server's word on whether he is
 * speaking, and his track's source is handed over to be played through the panner.
 */
function followHisVoice(
  room: AgentTrackRoom,
  context: ListeningAudioContext,
  onReaders: (readers: JarvisVoiceReaders | undefined) => void,
  voice: HeadsetVoice | undefined,
): () => void {
  if (voice === undefined) return followAgentVoice(room, context, onReaders);
  const watching = watchAgentRoom(room, (element) => voice.attached(element));
  const stopListening = voice.conversationOpened(() => watching.serverSaysSpeaking());
  const stopFollowing = followAgentVoice(room, context, onReaders, (source) => voice.playAgent(source));
  return () => {
    stopFollowing();
    watching.stop();
    stopListening();
  };
}

/** The room's events, with the spatial voice told what it watches for its echo, and its third tier. */
function eventsFor(events: JarvisSessionEvents, voice: HeadsetVoice | undefined): JarvisSessionEvents {
  if (voice === undefined) return events;
  return {
    ...events,
    onInterruption: () => {
      events.onInterruption?.();
      voice.interrupted();
    },
    onMessage: (message) => {
      events.onMessage?.(message);
      voice.heard(message);
    },
    onDiagnostics: (diagnostics) => {
      events.onDiagnostics?.(diagnostics);
      voice.halfDuplexChanged(diagnostics.halfDuplex);
    },
  };
}

/**
 * Everything `hologram`'s session is made from on a headset.
 *
 * The session itself is the one every device runs (`createJarvisSession` in `hologram`); what is
 * the headset's is only what a long-lived page in Quest Browser needs around it. Its own name in
 * the history. No platform delay. The half-duplex fallback, since his voice comes out a few
 * centimetres from the microphones and nobody has yet heard how well the echo canceller copes. His
 * track listened to on the app's own `AudioContext` (`agent-room.ts`). His voice from where he
 * stands, when the room hands over a spatial voice: the greeting and his track routed through it,
 * what it watches for its echo passed on, and the half-duplex fallback told to wait while it is
 * spatial. And the SDK's orphaned `<audio>` elements swept away after a dropped call
 * (`orphaned-audio.ts`), because this page stays open for hours of summonings. The room's events
 * and the deadline the browser tests hold open (`giveUpConnectingAfterMs`) pass through as the room
 * hands them over. The agent is told nothing about the headset: what sir points at goes to the
 * Jarvis server instead (see {@link createHeadsetSession}).
 */
export function headsetSessionDependencies({
  audioContext,
  voice,
  ...options
}: HeadsetSessionDependencyOptions): JarvisSessionDependencies<number> {
  return {
    ...options,
    greeting: voice === undefined ? options.greeting : voice.greeting(options.greeting),
    events: eventsFor(options.events, voice),
    participantName: HEADSET_PARTICIPANT_NAME,
    connectionDelay: NO_CONNECTION_DELAY,
    halfDuplex: true,
    ...(voice === undefined ? {} : { halfDuplexMayJudge: () => voice.halfDuplexMayJudge() }),
    offlineProblem: HEADSET_OFFLINE_PROBLEM,
    now: () => performance.now(),
    setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimeout: (timer) => window.clearTimeout(timer),
    findRoom: findAgentRoom,
    followAgentVoice: (room, onReaders) => followHisVoice(room, audioContext, onReaders, voice),
    removeOrphanedAudio: removeOrphanedAudioFromPage,
  };
}

/**
 * What the headset does with a message from the server: the entities a request touched go to the
 * room's `onAffected`, and everything else (`ready`) is the line's own business.
 */
export function serverMessageHandler(
  onAffected: HeadsetSessionOptions['onAffected'],
): (message: JarvisServerMessage) => void {
  return (message) => {
    if (message.type === 'affectedEntities') onAffected?.(message.entities);
  };
}

/** The headset's conversation: the session, and a way to tell the server what sir points at. */
export type HeadsetSession = JarvisSession & Pick<ServerFollowing, 'point'>;

/**
 * Jarvis's conversation on the headset: `hologram`'s session, with the headset's parts, and the line
 * to the server it keeps while a conversation is live — closed with the session. That line is where
 * the room hears what he is working on (`onAffected`), and where it says what sir points at
 * (`point`), which the server writes into the requests it routes.
 */
export function createHeadsetSession({ serverAddress, onAffected, ...options }: HeadsetSessionOptions): HeadsetSession {
  const session = createJarvisSession(headsetSessionDependencies(options));
  const following = followConversationOnServer(session, {
    address: serverAddress,
    device: 'vr',
    onMessage: serverMessageHandler(onAffected),
  });
  const dispose = session.dispose;
  return Object.assign(session, {
    point: following.point,
    dispose: () => {
      following.stop();
      dispose();
    },
  });
}
