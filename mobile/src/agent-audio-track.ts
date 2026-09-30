import {
  type AgentTrackRoom,
  agentAudioTracks,
  followAgentTrack,
  type NativeTrackIds,
  nativeTrackIds,
  roomOfConversation as roomOfConversationWhere,
} from 'hologram';
import { Room } from 'livekit-client';

export type { NativeTrackIds } from 'hologram';

/**
 * The half of finding Jarvis's track that is this app's own.
 *
 * Walking the room for the agent's publications is shared with every other device that listens to
 * him, and lives in `hologram/src/agent-audio-track.ts`. What stays here is what only this app can
 * answer: whether the room the SDK hands over is a real `Room` of the `livekit-client` this app
 * bundles, and, for Android, which native track a publication is.
 */

/** Jarvis's audio track in `room` right now, if he has one. */
export function findAgentAudioTrack(room: AgentTrackRoom): NativeTrackIds | undefined {
  for (const track of agentAudioTracks(room)) {
    const ids = nativeTrackIds(track.mediaStreamTrack);
    if (ids) {
      return ids;
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
  return followAgentTrack(
    room,
    findAgentAudioTrack,
    (one, other) => one?.peerConnectionId === other?.peerConnectionId && one?.trackId === other?.trackId,
    onChange,
  );
}

/**
 * Whether something is a room of the `livekit-client` this app imports.
 *
 * Which is the copy the SDK builds its rooms from, or this could never be true:
 * `agent-audio-track.contract.spec.ts` fails if the two ever stop being the same.
 */
function isLiveKitRoom(candidate: unknown): candidate is Room {
  return candidate instanceof Room;
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
  return roomOfConversationWhere(conversation, isLiveKitRoom);
}
