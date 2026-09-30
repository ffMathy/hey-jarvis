/**
 * Finding Jarvis's audio track in the LiveKit room a conversation runs in.
 *
 * Every device that analyses his voice from the track itself — the phone natively, a browser
 * through Web Audio, the headset through its own — finds the track the same way, so the finding is
 * here. It is structural throughout: the room, its participants and their tracks are named by no
 * more of them than is read, and this file imports nothing, not even `livekit-client`.
 *
 * That last part is deliberate, and it is why {@link roomOfConversation} takes a guard rather than
 * checking for a `Room` itself. The check is an `instanceof`, and an `instanceof` is only ever true
 * against the very copy of the class the room was built from — the `livekit-client` that each app's
 * ElevenLabs SDK resolves, which is the app's to know and not this package's. A copy resolved from
 * here could differ, and then the check would fail silently and the hologram would fall back to the
 * SDK's own readings. So each app passes a guard written against its own import.
 */

/** What native code needs to find a WebRTC track: its peer connection, and its id on it. */
export interface NativeTrackIds {
  peerConnectionId: number;
  trackId: string;
}

/**
 * Everything that can change which track is Jarvis's.
 *
 * Each is one of LiveKit's room events. Nothing here can check that without importing LiveKit; each
 * app's `Room` can, since it only satisfies {@link AgentTrackRoom} while every name here is one of
 * its events, and passing it to {@link roomOfConversation} asks exactly that.
 */
const TRACK_EVENTS = ['trackSubscribed', 'trackUnsubscribed', 'participantDisconnected', 'disconnected'] as const;

type TrackEvent = (typeof TRACK_EVENTS)[number];

/**
 * One of Jarvis's published audio tracks, as little of it as this package needs to name.
 *
 * `mediaStreamTrack` is deliberately the only field: what it *is* differs by platform, and each
 * caller narrows it for itself. Everything else a caller wants of the track — LiveKit's
 * `attachedElements`, say — it reads off the same object structurally, because `RemoteAudioTrack`
 * carries far more than is worth restating here.
 */
export interface AgentTrack {
  mediaStreamTrack: unknown;
}

/** The parts of a LiveKit room the agent's track is looked for in. `Room` has them all. */
export interface AgentTrackRoom {
  remoteParticipants: ReadonlyMap<
    string,
    {
      identity: string;
      audioTrackPublications: ReadonlyMap<string, { track?: AgentTrack | undefined }>;
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

/**
 * Every audio track Jarvis has published in `room`.
 *
 * Deliberately not narrowed here. On Android a track is a handle onto something only native code
 * can read, and `nativeTrackIds` turns it into the pair of numbers that finds it; in a browser the
 * track *is* the audio, and `mobile/src/jarvis-voice.web.ts` checks it is the browser's own object
 * before pointing Web Audio at it, while `flushQueuedAudio` reads the elements it is playing
 * through. The answers have nothing in common but where they come from, which is this.
 */
export function agentAudioTracks(room: AgentTrackRoom): AgentTrack[] {
  const tracks: AgentTrack[] = [];
  for (const participant of room.remoteParticipants.values()) {
    if (!isAgentIdentity(participant.identity)) {
      continue;
    }
    for (const publication of participant.audioTrackPublications.values()) {
      if (publication.track) {
        tracks.push(publication.track);
      }
    }
  }
  return tracks;
}

/**
 * Tells `onChange` what `read` finds in `room`, now and whenever the tracks change, until the
 * returned function is called — which reports it gone, if there was anything.
 *
 * `isSame` is what decides whether anything changed, because the platforms read the same
 * publication as different things: Android as a pair of native ids, a browser as the track object
 * itself.
 */
export function followAgentTrack<Found>(
  room: AgentTrackRoom,
  read: (room: AgentTrackRoom) => Found | undefined,
  isSame: (one: Found | undefined, other: Found | undefined) => boolean,
  onChange: (found: Found | undefined) => void,
): () => void {
  let current: Found | undefined;
  const update = () => {
    const next = read(room);
    if (isSame(next, current)) {
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
 * The LiveKit room a conversation runs in, if `isRoom` says it is one.
 *
 * The SDK keeps it on the conversation's `connection`, which it declares
 * protected: there is no public way to the room. Each app pins the SDK
 * exactly, and checks with a contract spec of its own that a new version still
 * keeps it there (`mobile/src/agent-audio-track.contract.spec.ts`). Should it
 * move anyway, this finds nothing, and the hologram goes back to the SDK's own
 * readings rather than breaking.
 *
 * `isRoom` is the app's own `instanceof Room`, for the reason at the top of
 * this file.
 */
export function roomOfConversation<FoundRoom extends AgentTrackRoom>(
  conversation: object,
  isRoom: (candidate: unknown) => candidate is FoundRoom,
): FoundRoom | undefined {
  const connection: unknown = Reflect.get(conversation, 'connection');
  if (typeof connection !== 'object' || connection === null || !('getRoom' in connection)) {
    return undefined;
  }
  if (typeof connection.getRoom !== 'function') {
    return undefined;
  }
  const room: unknown = connection.getRoom();
  return isRoom(room) ? room : undefined;
}
