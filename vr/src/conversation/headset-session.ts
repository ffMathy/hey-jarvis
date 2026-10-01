import {
  type AgentTrackRoom,
  createJarvisSession,
  type ElevenLabsSettings,
  followConversationOnServer,
  type GreetingPlayer,
  HEADSET_PARTICIPANT_NAME,
  type JarvisSession,
  type JarvisSessionDependencies,
  type JarvisSessionEvents,
  type JarvisVoiceReaders,
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

/**
 * What the headset tells the agent about itself the moment each conversation connects (the
 * session's `deviceContext`). The agent's prompt waits for it before calling `markAffected` or
 * reading anything into what sir points at, because on the phone and the watch nothing lights up
 * and nothing can be pointed at.
 */
export const HEADSET_DEVICE_CONTEXT =
  "This conversation is on sir's headset, which lights up what you are working on and tells you what he is pointing at.";

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
   * What the agent is told about the device on connecting: {@link HEADSET_DEVICE_CONTEXT} from a
   * room that lights up what he works on and says what sir points at. Without it, nothing.
   */
  deviceContext?: string;
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
}

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
 * (`onAffected` among them), what it tells the agent about the device (`deviceContext`) and the
 * deadline the browser tests hold open (`giveUpConnectingAfterMs`) pass through as the room hands
 * them over.
 */
export function headsetSessionDependencies({
  audioContext,
  voice,
  ...options
}: HeadsetSessionOptions): JarvisSessionDependencies<number> {
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
 * Jarvis's conversation on the headset: `hologram`'s session, with the headset's parts, and the line
 * to the server it keeps while a conversation is live — closed with the session.
 */
export function createHeadsetSession({ serverAddress, ...options }: HeadsetSessionOptions): JarvisSession {
  const session = createJarvisSession(headsetSessionDependencies(options));
  const stopFollowing = followConversationOnServer(session, { address: serverAddress, device: 'vr' });
  const dispose = session.dispose;
  session.dispose = () => {
    stopFollowing();
    dispose();
  };
  return session;
}
