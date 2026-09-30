import {
  createJarvisSession,
  type ElevenLabsSettings,
  type GreetingPlayer,
  HEADSET_PARTICIPANT_NAME,
  type JarvisSession,
  type JarvisSessionDependencies,
  type JarvisSessionEvents,
  type StartSession,
} from 'hologram';
import { findAgentRoom, followAgentVoice, type ListeningAudioContext } from './agent-room';
import { removeOrphanedAudioFromPage } from './orphaned-audio';

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
}

/**
 * Everything `hologram`'s session is made from on a headset.
 *
 * The session itself is the one every device runs (`createJarvisSession` in `hologram`); what is
 * the headset's is only what a long-lived page in Quest Browser needs around it. Its own name in
 * the history. No platform delay. The half-duplex fallback, since his voice comes out a few
 * centimetres from the microphones and nobody has yet heard how well the echo canceller copes. His
 * track listened to on the app's own `AudioContext` (`agent-room.ts`). And the SDK's orphaned
 * `<audio>` elements swept away after a dropped call (`orphaned-audio.ts`), because this page
 * stays open for hours of summonings.
 */
export function headsetSessionDependencies({
  audioContext,
  ...options
}: HeadsetSessionOptions): JarvisSessionDependencies<number> {
  return {
    ...options,
    participantName: HEADSET_PARTICIPANT_NAME,
    connectionDelay: NO_CONNECTION_DELAY,
    halfDuplex: true,
    offlineProblem: HEADSET_OFFLINE_PROBLEM,
    now: () => performance.now(),
    setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimeout: (timer) => window.clearTimeout(timer),
    findRoom: findAgentRoom,
    followAgentVoice: (room, onReaders) => followAgentVoice(room, audioContext, onReaders),
    removeOrphanedAudio: removeOrphanedAudioFromPage,
  };
}

/** Jarvis's conversation on the headset: `hologram`'s session, with the headset's parts. */
export function createHeadsetSession(options: HeadsetSessionOptions): JarvisSession {
  return createJarvisSession(headsetSessionDependencies(options));
}
