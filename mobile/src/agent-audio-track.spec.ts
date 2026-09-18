import { describe, expect, it } from 'bun:test';
import { Room } from 'livekit-client';
import {
  type AgentTrackRoom,
  agentAudioTracks,
  findAgentAudioTrack,
  followAgentAudioTrack,
  followAgentTrack,
  type NativeTrackIds,
  nativeTrackIds,
  roomOfConversation,
} from './agent-audio-track';

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

describe('nativeTrackIds', () => {
  it('finds the connection and id of a received track', () => {
    expect(nativeTrackIds(receivedTrack(3, 'agent-voice').mediaStreamTrack)).toEqual({
      peerConnectionId: 3,
      trackId: 'agent-voice',
    });
  });

  it('refuses a local track, which belongs to no connection', () => {
    expect(nativeTrackIds(receivedTrack(-1, 'microphone').mediaStreamTrack)).toBeUndefined();
  });

  it('refuses anything that is not a React Native WebRTC track', () => {
    expect(nativeTrackIds(undefined)).toBeUndefined();
    expect(nativeTrackIds({ id: 'browser-track' })).toBeUndefined();
    expect(nativeTrackIds({ id: 7, _peerConnectionId: 1 })).toBeUndefined();
  });
});

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
});

describe('agentAudioTracks', () => {
  // What a browser reads instead of a pair of native ids: the track object itself, which
  // `jarvis-voice.web.ts` points Web Audio at. Left unnarrowed here on purpose — see the note
  // there and on the function.
  it("hands over the agent's tracks as they are, and nobody else's", () => {
    const jarvis = receivedTrack(1, 'jarvis');
    const alsoJarvis = receivedTrack(1, 'jarvis-again');
    const room = fakeRoom([
      participant('user_42', [receivedTrack(1, 'someone-else')]),
      participant('agent_jarvis', [jarvis, alsoJarvis]),
    ]);

    expect(agentAudioTracks(room)).toEqual([jarvis.mediaStreamTrack, alsoJarvis.mediaStreamTrack]);
  });

  it('hands over nothing before the agent has a track', () => {
    expect(agentAudioTracks(fakeRoom([participant('agent_jarvis', [])]))).toEqual([]);
    expect(agentAudioTracks(fakeRoom())).toEqual([]);
  });
});

describe('followAgentTrack', () => {
  /** The trackless thing a browser reads: whatever `read` says, followed by identity. */
  const followIdentities = (room: AgentTrackRoom, onChange: (found: string | undefined) => void) =>
    followAgentTrack(
      room,
      (current) => findAgentAudioTrack(current)?.trackId,
      (one, other) => one === other,
      onChange,
    );

  it('follows whatever it is told to read, not only the native ids', () => {
    const room = fakeRoom();
    const reports: (string | undefined)[] = [];

    const stop = followIdentities(room, (track) => reports.push(track));
    room.remoteParticipants.set('agent_jarvis', participant('agent_jarvis', [receivedTrack(2, 'jarvis')]));
    room.emit('trackSubscribed');
    room.emit('trackSubscribed');
    stop();

    expect(reports).toEqual(['jarvis', undefined]);
    expect(room.listenerCount()).toBe(0);
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
});
