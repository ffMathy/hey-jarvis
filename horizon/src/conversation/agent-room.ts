import {
  type AgentTrackRoom,
  agentAudioTracks,
  createPlayedVoiceReaders,
  followAgentTrack,
  type JarvisVoiceReaders,
  type PlayedAudioSource,
  readingWindowSize,
  roomOfConversation,
} from 'hologram';
import { Room } from 'livekit-client';
import type { ListeningAudioContext } from './session-contract';

/**
 * Jarvis's voice as the headset plays it, read from his track in the conversation's LiveKit room.
 *
 * The same route the phone's web build takes (`mobile/src/jarvis-voice.web.ts`), and for the same
 * reason: the SDK's own output volume is a mean of a decibel spectrum that never reads silence as
 * silence, so the sphere would stay agitated through every pause (see `played-voice.ts`). Finding
 * the room and following the track are hologram's shared halves; what is this app's is the check
 * that the room is a `Room` of the `livekit-client` it bundles, and the analyser it reads through.
 */

/**
 * Whether something is a room of the `livekit-client` this app imports.
 *
 * Which is the copy the SDK builds its rooms from, or this could never be true — an `instanceof`
 * only ever matches the very class the object was made from. `agent-room.contract.spec.ts` fails
 * if the two copies ever part, and Vite's `resolve.dedupe` keeps the bundle to one.
 */
export function isLiveKitRoom(candidate: unknown): candidate is Room {
  return candidate instanceof Room;
}

/** The LiveKit room an open conversation runs in, or nothing if the SDK no longer keeps it there. */
export function findAgentRoom(conversation: object): AgentTrackRoom | undefined {
  return roomOfConversation(conversation, isLiveKitRoom);
}

/** Jarvis's track in `room` as the browser's own object, which is what Web Audio takes. */
function findPlayableTrack(room: AgentTrackRoom): MediaStreamTrack | undefined {
  if (typeof MediaStreamTrack === 'undefined') {
    return undefined;
  }
  for (const { mediaStreamTrack } of agentAudioTracks(room)) {
    if (mediaStreamTrack instanceof MediaStreamTrack) {
      return mediaStreamTrack;
    }
  }
  return undefined;
}

/** An analyser watching one track, and the way to let go of it. */
interface OpenedAudio {
  source: PlayedAudioSource;
  close: () => void;
}

/**
 * Points an analyser on the app's context at a track the SDK is already playing.
 *
 * Nothing goes to the destination, as on the phone's web build: the SDK plays the track through a
 * hidden `<audio>` element of its own, which is also what keeps Chrome feeding a remote WebRTC
 * track to Web Audio at all, and what keeps his voice inside the browser's echo cancellation. The
 * context is the app's, not one of its own: a headset page lives for hours, and a context per call
 * would be one more each time the SDK failed to close its own. So closing disconnects the nodes
 * and leaves the context running.
 */
function listenToTrack(track: MediaStreamTrack, context: ListeningAudioContext): OpenedAudio | undefined {
  try {
    const analyser = context.createAnalyser();
    analyser.fftSize = readingWindowSize(context.sampleRate);
    const media = context.createMediaStreamSource(new MediaStream([track]));
    media.connect(analyser);
    if (context.state === 'suspended') {
      // Entering the room was a tap, so this is allowed by the time anyone speaks to him; if it is
      // not, the readings are silence rather than wrong.
      context.resume().catch(() => undefined);
    }
    return {
      source: {
        sampleRate: () => context.sampleRate,
        sampleCount: () => analyser.fftSize,
        readLatest: (into) => analyser.getFloatTimeDomainData(into),
      },
      close: () => {
        media.disconnect();
        analyser.disconnect();
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Hands `onReaders` readers for Jarvis's voice in `room` whenever his track changes — `undefined`
 * while there is none, or it cannot be listened to — until the returned function is called.
 */
export function followAgentVoice(
  room: AgentTrackRoom,
  context: ListeningAudioContext,
  onReaders: (readers: JarvisVoiceReaders | undefined) => void,
): () => void {
  let opened: OpenedAudio | undefined;
  const stopFollowing = followAgentTrack(
    room,
    findPlayableTrack,
    (one, other) => one === other,
    (track) => {
      opened?.close();
      opened = track ? listenToTrack(track, context) : undefined;
      onReaders(opened ? createPlayedVoiceReaders(opened.source) : undefined);
    },
  );
  return () => {
    stopFollowing();
    opened?.close();
    opened = undefined;
  };
}
