import { describe, expect, it } from 'bun:test';
import type { AgentTrackRoom } from 'hologram';
import { Room } from 'livekit-client';
import {
  findAgentAudioTrack,
  followAgentAudioTrack,
  type NativeTrackIds,
  roomOfConversation,
} from './agent-audio-track';

/**
 * This app's half of finding Jarvis's track: the native ids Android reads it by, and the check
 * against this app's own `livekit-client`. Walking the room is shared, and tested with it in
 * `hologram/src/agent-audio-track.spec.ts`.
 */

/** A React Native WebRTC track as JavaScript sees it: an id, and the connection it arrived on. */
function receivedTrack(peerConnectionId: number, id: string) {
  return { mediaStreamTrack: { id, _peerConnectionId: peerConnectionId, kind: 'audio' } };
}

function participant(identity: string, tracks: { mediaStreamTrack: unknown }[]) {
  return {
    identity,
    audioTrackPublications: new Map(tracks.map((track, index) => [`TR_${index}`, { track }])),
  };
}

/** A room whose participants the test can change, and whose events it can fire. */
function fakeRoom(initial: ReturnType<typeof participant>[] = []) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    remoteParticipants: new Map(initial.map((entry) => [entry.identity, entry])),
    on(event: string, listener: () => void) {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  } satisfies AgentTrackRoom & Record<string, unknown>;
}

describe('findAgentAudioTrack', () => {
  it("picks the agent's track, not another participant's", () => {
    const room = fakeRoom([
      participant('user_42', [receivedTrack(1, 'someone-else')]),
      participant('agent_jarvis', [receivedTrack(1, 'jarvis')]),
    ]);

    expect(findAgentAudioTrack(room)).toEqual({ peerConnectionId: 1, trackId: 'jarvis' });
  });

  it('finds nothing before the agent has a track', () => {
    expect(findAgentAudioTrack(fakeRoom([participant('agent_jarvis', [])]))).toBeUndefined();
    expect(findAgentAudioTrack(fakeRoom())).toBeUndefined();
  });

  it('skips a track native code cannot find, such as a local one', () => {
    const room = fakeRoom([participant('agent_jarvis', [receivedTrack(-1, 'local'), receivedTrack(4, 'jarvis')])]);

    expect(findAgentAudioTrack(room)).toEqual({ peerConnectionId: 4, trackId: 'jarvis' });
  });
});

describe('followAgentAudioTrack', () => {
  it('reports the track as it arrives and as it goes, each change once', () => {
    const room = fakeRoom();
    const reports: (NativeTrackIds | undefined)[] = [];

    followAgentAudioTrack(room, (track) => reports.push(track));
    expect(reports).toEqual([]);

    room.remoteParticipants.set('agent_jarvis', participant('agent_jarvis', [receivedTrack(2, 'jarvis')]));
    room.emit('trackSubscribed');
    room.emit('trackSubscribed');
    expect(reports).toEqual([{ peerConnectionId: 2, trackId: 'jarvis' }]);

    room.remoteParticipants.delete('agent_jarvis');
    room.emit('participantDisconnected');
    expect(reports).toEqual([{ peerConnectionId: 2, trackId: 'jarvis' }, undefined]);
  });

  it('reports a track that was already there straight away', () => {
    const room = fakeRoom([participant('agent_jarvis', [receivedTrack(2, 'jarvis')])]);
    const reports: (NativeTrackIds | undefined)[] = [];

    followAgentAudioTrack(room, (track) => reports.push(track));

    expect(reports).toEqual([{ peerConnectionId: 2, trackId: 'jarvis' }]);
  });

  it('stops listening, and reports the track gone, when stopped', () => {
    const room = fakeRoom([participant('agent_jarvis', [receivedTrack(2, 'jarvis')])]);
    const reports: (NativeTrackIds | undefined)[] = [];

    const stop = followAgentAudioTrack(room, (track) => reports.push(track));
    stop();

    expect(room.listenerCount()).toBe(0);
    expect(reports).toEqual([{ peerConnectionId: 2, trackId: 'jarvis' }, undefined]);
  });

  it('can follow a real LiveKit room', () => {
    const reports: (NativeTrackIds | undefined)[] = [];

    const stop = followAgentAudioTrack(new Room(), (track) => reports.push(track));
    stop();

    expect(reports).toEqual([]);
  });
});

describe('roomOfConversation', () => {
  it("finds the room where the SDK keeps it, on the conversation's connection", () => {
    const room = new Room();

    expect(roomOfConversation({ connection: { getRoom: () => room } })).toBe(room);
  });

  it('finds nothing, rather than throwing, when the room is not there', () => {
    expect(roomOfConversation({})).toBeUndefined();
    expect(roomOfConversation({ connection: {} })).toBeUndefined();
    expect(roomOfConversation({ connection: { getRoom: () => ({ not: 'a room' }) } })).toBeUndefined();
  });

  it("finds nothing when what the SDK hands over only looks like this app's Room", () => {
    // What a second copy of `livekit-client` would hand over: the same shape, a different class.
    const lookalike = { remoteParticipants: new Map(), on() {}, off() {} };

    expect(roomOfConversation({ connection: { getRoom: () => lookalike } })).toBeUndefined();
  });
});
