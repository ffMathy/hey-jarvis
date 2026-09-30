import {
  type AgentTrackRoom,
  agentAudioTracks,
  createPlayedVoiceReaders,
  followAgentTrack,
  isAgentIdentity,
  type JarvisVoiceReaders,
  type PlayedAudioSource,
  readingWindowSize,
  roomOfConversation,
} from 'hologram';
import { Room, Track, TrackEvent } from 'livekit-client';

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

/**
 * As much of an `AudioContext` as listening to Jarvis's track takes. The app's one context has all
 * of it; naming only this much is what lets a test hand in something that is not a browser's.
 */
export interface ListeningAudioContext {
  readonly sampleRate: number;
  readonly state: string;
  createAnalyser(): AnalyserNode;
  createMediaStreamSource(stream: MediaStream): MediaStreamAudioSourceNode;
  resume(): Promise<void>;
}

/** An analyser watching one track, and the way to let go of it. */
interface OpenedAudio {
  source: PlayedAudioSource;
  close: () => void;
}

/**
 * Plays his track's source node from where he stands, as well as reading it; returns how to stop.
 * The spatial voice's (`spatial-voice.ts`), when there is one.
 */
export type PlayAgentSource = (source: MediaStreamAudioSourceNode) => () => void;

/**
 * Points an analyser on the app's context at a track the SDK is already playing.
 *
 * Nothing goes to the destination from here, as on the phone's web build: the SDK plays the track
 * through a hidden `<audio>` element of its own, which is also what keeps Chrome feeding a remote
 * WebRTC track to Web Audio at all. When his voice comes from where he stands, the same source node
 * is handed to `play` as well, which takes it through a panner (`spatial-voice.ts`) — one source,
 * fanned out, so the sphere and the ears follow the very same samples. The context is the app's,
 * not one of its own: a headset page lives for hours, and a context per call would be one more each
 * time the SDK failed to close its own. So closing disconnects the nodes and leaves the context
 * running.
 */
function listenToTrack(
  track: MediaStreamTrack,
  context: ListeningAudioContext,
  play: PlayAgentSource | undefined,
): OpenedAudio | undefined {
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
    const stopPlaying = play?.(media);
    return {
      source: {
        sampleRate: () => context.sampleRate,
        sampleCount: () => analyser.fftSize,
        readLatest: (into) => analyser.getFloatTimeDomainData(into),
      },
      close: () => {
        stopPlaying?.();
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
 * while there is none, or it cannot be listened to — until the returned function is called; and
 * hands the same track's source to `play`, when there is one, to be heard from where he stands.
 */
export function followAgentVoice(
  room: AgentTrackRoom,
  context: ListeningAudioContext,
  onReaders: (readers: JarvisVoiceReaders | undefined) => void,
  play?: PlayAgentSource,
): () => void {
  let opened: OpenedAudio | undefined;
  const stopFollowing = followAgentTrack(
    room,
    findPlayableTrack,
    (one, other) => one === other,
    (track) => {
      opened?.close();
      opened = track ? listenToTrack(track, context, play) : undefined;
      onReaders(opened ? createPlayedVoiceReaders(opened.source) : undefined);
    },
  );
  return () => {
    stopFollowing();
    opened?.close();
    opened = undefined;
  };
}

/** His LiveKit tracks in `room`: the objects that say when they are attached to an element. */
function agentTracksOf(room: AgentTrackRoom): Track[] {
  return agentAudioTracks(room).filter((track): track is Track => track instanceof Track);
}

function sameTracks(one: Track[] | undefined, other: Track[] | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  return one.length === other.length && one.every((track, index) => track === other[index]);
}

/** What watching his room for the spatial voice hands over. */
export interface AgentRoomWatch {
  /**
   * Whether LiveKit's server says he is speaking right now. The server measures what it receives,
   * so this holds whether or not the page is pulling his audio, which is what makes it the judge of
   * a spatial voice gone silent (`voice-watch.ts`).
   */
  serverSaysSpeaking(): boolean;
  stop(): void;
}

/**
 * Tells `onElement` of every element LiveKit attaches one of his tracks to, from now on and every
 * one attached already, until stopped — the earliest word there is of an element that has to be
 * made inaudible while his voice comes from where he stands (`agent-element-volume.ts`).
 */
export function watchAgentRoom(room: AgentTrackRoom, onElement: (element: HTMLMediaElement) => void): AgentRoomWatch {
  const unhooks = new Map<Track, () => void>();
  const stopFollowing = followAgentTrack(room, agentTracksOf, sameTracks, (tracks) => {
    const current = new Set(tracks ?? []);
    for (const [track, unhook] of unhooks) {
      if (current.has(track)) continue;
      unhook();
      unhooks.delete(track);
    }
    for (const track of current) {
      if (unhooks.has(track)) continue;
      const attached = (element: HTMLMediaElement) => onElement(element);
      track.on(TrackEvent.ElementAttached, attached);
      unhooks.set(track, () => track.off(TrackEvent.ElementAttached, attached));
      for (const element of track.attachedElements) onElement(element);
    }
  });
  return {
    serverSaysSpeaking: () => {
      for (const participant of room.remoteParticipants.values()) {
        if (isAgentIdentity(participant.identity) && Reflect.get(participant, 'isSpeaking') === true) return true;
      }
      return false;
    },
    stop: () => {
      stopFollowing();
      for (const unhook of unhooks.values()) unhook();
      unhooks.clear();
    },
  };
}
