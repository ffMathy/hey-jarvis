import { describe, expect, it } from 'bun:test';
import {
  type AgentTrackRoom,
  agentAudioTracks,
  followAgentTrack,
  isAgentIdentity,
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

/** Follows the id of the agent's first track: a stand-in for whatever a platform reads off it. */
function followFirstTrackId(room: AgentTrackRoom, onChange: (id: string | undefined) => void) {
  return followAgentTrack(
    room,
    (current) => nativeTrackIds(agentAudioTracks(current)[0]?.mediaStreamTrack)?.trackId,
    (one, other) => one === other,
    onChange,
  );
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

describe('isAgentIdentity', () => {
  it("tells the agent apart by 'agent' in its identity, as the SDK does", () => {
    expect(isAgentIdentity('agent_jarvis')).toBe(true);
    expect(isAgentIdentity('user_42')).toBe(false);
  });
});

describe('agentAudioTracks', () => {
  // The track objects themselves, narrowed by nobody: a browser wants the `MediaStreamTrack` off
  // them, `flushQueuedAudio` wants the elements they are playing through, and Android wants their
  // native ids. See the note on the function.
  it("hands over the agent's tracks as they are, and nobody else's", () => {
    const jarvis = receivedTrack(1, 'jarvis');
    const alsoJarvis = receivedTrack(1, 'jarvis-again');
    const room = fakeRoom([
      participant('user_42', [receivedTrack(1, 'someone-else')]),
      participant('agent_jarvis', [jarvis, alsoJarvis]),
    ]);

    expect(agentAudioTracks(room)).toEqual([jarvis, alsoJarvis]);
  });

  it('hands over nothing before the agent has a track', () => {
    expect(agentAudioTracks(fakeRoom([participant('agent_jarvis', [])]))).toEqual([]);
    expect(agentAudioTracks(fakeRoom())).toEqual([]);
  });
});

describe('followAgentTrack', () => {
  it('reports what it reads as it arrives and as it goes, each change once', () => {
    const room = fakeRoom();
    const reports: (string | undefined)[] = [];

    followFirstTrackId(room, (id) => reports.push(id));
    expect(reports).toEqual([]);

    room.remoteParticipants.set('agent_jarvis', participant('agent_jarvis', [receivedTrack(2, 'jarvis')]));
    room.emit('trackSubscribed');
    room.emit('trackSubscribed');
    expect(reports).toEqual(['jarvis']);

    room.remoteParticipants.delete('agent_jarvis');
    room.emit('participantDisconnected');
    expect(reports).toEqual(['jarvis', undefined]);
  });

  it('reports a track that was already there straight away', () => {
    const room = fakeRoom([participant('agent_jarvis', [receivedTrack(2, 'jarvis')])]);
    const reports: (string | undefined)[] = [];

    followFirstTrackId(room, (id) => reports.push(id));

    expect(reports).toEqual(['jarvis']);
  });

  it('stops listening, and reports the track gone, when stopped', () => {
    const room = fakeRoom([participant('agent_jarvis', [receivedTrack(2, 'jarvis')])]);
    const reports: (string | undefined)[] = [];

    const stop = followFirstTrackId(room, (id) => reports.push(id));
    stop();

    expect(room.listenerCount()).toBe(0);
    expect(reports).toEqual(['jarvis', undefined]);
  });

  it('decides what counts as a change by the comparison it is given', () => {
    // A browser compares track objects, Android native ids: the same publication either way.
    const room = fakeRoom([participant('agent_jarvis', [receivedTrack(2, 'jarvis')])]);
    const reports: unknown[] = [];

    const stop = followAgentTrack(
      room,
      (current) => agentAudioTracks(current)[0],
      () => true,
      (track) => reports.push(track),
    );
    room.emit('trackSubscribed');
    stop();

    expect(reports).toEqual([]);
  });
});

describe('roomOfConversation', () => {
  /** The class an app's own guard would check against: its copy of LiveKit's `Room`. */
  class AppsRoom {
    remoteParticipants: AgentTrackRoom['remoteParticipants'] = new Map();
    on() {
      return this;
    }
    off() {
      return this;
    }
  }
  const isAppsRoom = (candidate: unknown): candidate is AppsRoom => candidate instanceof AppsRoom;

  it("finds the room where the SDK keeps it, on the conversation's connection", () => {
    const room = new AppsRoom();

    expect(roomOfConversation({ connection: { getRoom: () => room } }, isAppsRoom)).toBe(room);
  });

  it("finds nothing when the app's guard says the room is not one of its own", () => {
    // A room from another copy of LiveKit looks the same and fails `instanceof`: the reason the
    // guard is the app's to write.
    const lookalike = { remoteParticipants: new Map(), on() {}, off() {} };

    expect(roomOfConversation({ connection: { getRoom: () => lookalike } }, isAppsRoom)).toBeUndefined();
  });

  it('finds nothing, rather than throwing, when the room is not there', () => {
    expect(roomOfConversation({}, isAppsRoom)).toBeUndefined();
    expect(roomOfConversation({ connection: {} }, isAppsRoom)).toBeUndefined();
    expect(roomOfConversation({ connection: { getRoom: 'not a function' } }, isAppsRoom)).toBeUndefined();
    expect(roomOfConversation({ connection: { getRoom: () => ({ not: 'a room' }) } }, isAppsRoom)).toBeUndefined();
  });
});
