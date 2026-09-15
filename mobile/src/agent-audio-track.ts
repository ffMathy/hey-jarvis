import { Room, type RoomEventCallbacks } from 'livekit-client';

/** What native code needs to find a WebRTC track: its peer connection, and its id on it. */
export interface NativeTrackIds {
  peerConnectionId: number;
  trackId: string;
}

/** Everything that can change which track is Jarvis's. */
const TRACK_EVENTS = [
  'trackSubscribed',
  'trackUnsubscribed',
  'participantDisconnected',
  'disconnected',
] as const satisfies readonly (keyof RoomEventCallbacks)[];

type TrackEvent = (typeof TRACK_EVENTS)[number];

/** The parts of a LiveKit room the agent's track is looked for in. `Room` has them all. */
export interface AgentTrackRoom {
  remoteParticipants: ReadonlyMap<
    string,
    {
      identity: string;
      audioTrackPublications: ReadonlyMap<string, { track?: { mediaStreamTrack: unknown } | undefined }>;
    }
  >;
  on(event: TrackEvent, listener: () => void): unknown;
  off(event: TrackEvent, listener: () => void): unknown;
}

/**
 * The native ids of a track, if it is a React Native WebRTC track that native
 * code can find by them: one received on a peer connection, which a
 * microphone's own track is not.
 */
export function nativeTrackIds(mediaStreamTrack: unknown): NativeTrackIds | undefined {
  if (typeof mediaStreamTrack !== 'object' || mediaStreamTrack === null) {
    return undefined;
  }
  if (!('id' in mediaStreamTrack) || typeof mediaStreamTrack.id !== 'string') {
    return undefined;
  }
  if (!('_peerConnectionId' in mediaStreamTrack) || typeof mediaStreamTrack._peerConnectionId !== 'number') {
    return undefined;
  }
  if (mediaStreamTrack._peerConnectionId < 0) {
    return undefined;
  }
  return { peerConnectionId: mediaStreamTrack._peerConnectionId, trackId: mediaStreamTrack.id };
}

/**
 * Whether a participant is the agent. ElevenLabs gives the agent an identity
 * containing "agent", and its own SDK tells them apart the same way.
 */
export function isAgentIdentity(identity: string): boolean {
  return identity.includes('agent');
}

/** Jarvis's audio track in `room` right now, if he has one. */
export function findAgentAudioTrack(room: AgentTrackRoom): NativeTrackIds | undefined {
  for (const participant of room.remoteParticipants.values()) {
    if (!isAgentIdentity(participant.identity)) {
      continue;
    }
    for (const publication of participant.audioTrackPublications.values()) {
      const ids = publication.track ? nativeTrackIds(publication.track.mediaStreamTrack) : undefined;
      if (ids) {
        return ids;
      }
    }
  }
  return undefined;
}

/**
 * Tells `onChange` which track is Jarvis's, now and whenever that changes, until
 * the returned function is called — which reports the track gone, if there was
 * one.
 */
export function followAgentAudioTrack(
  room: AgentTrackRoom,
  onChange: (track: NativeTrackIds | undefined) => void,
): () => void {
  let current: NativeTrackIds | undefined;
  const update = () => {
    const next = findAgentAudioTrack(room);
    if (next?.peerConnectionId === current?.peerConnectionId && next?.trackId === current?.trackId) {
      return;
    }
    current = next;
    onChange(next);
  };

  for (const event of TRACK_EVENTS) {
    room.on(event, update);
  }
  update();

  return () => {
    for (const event of TRACK_EVENTS) {
      room.off(event, update);
    }
    if (current) {
      current = undefined;
      onChange(undefined);
    }
  };
}

/**
 * The LiveKit room a conversation runs in.
 *
 * The SDK keeps it on the conversation's `connection`, which it declares
 * protected: there is no public way to the room. `@elevenlabs/react-native` is
 * pinned exactly, and `agent-audio-track.contract.spec.ts` fails if a new
 * version stops keeping it there. Should that happen anyway, this finds
 * nothing, and the hologram goes back to the SDK's own readings rather than
 * breaking.
 */
export function roomOfConversation(conversation: object): Room | undefined {
  const connection: unknown = Reflect.get(conversation, 'connection');
  if (typeof connection !== 'object' || connection === null || !('getRoom' in connection)) {
    return undefined;
  }
  if (typeof connection.getRoom !== 'function') {
    return undefined;
  }
  const room: unknown = connection.getRoom();
  return room instanceof Room ? room : undefined;
}
