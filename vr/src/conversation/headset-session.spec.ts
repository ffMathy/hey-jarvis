import { describe, expect, it } from 'bun:test';
import { type AffectedEntity, type AgentTrackRoom, type GreetingPlayer, HEADSET_PARTICIPANT_NAME } from 'hologram';
import { findAgentRoom, type ListeningAudioContext } from './agent-room';
import {
  HEADSET_OFFLINE_PROBLEM,
  type HeadsetSessionDependencyOptions,
  type HeadsetVoice,
  headsetSessionDependencies,
  NO_CONNECTION_DELAY,
  serverMessageHandler,
} from './headset-session';
import { removeOrphanedAudioFromPage } from './orphaned-audio';

/**
 * What the headset hands `hologram`'s session. The session's own behaviour is pinned by its specs
 * in `hologram`, which are set up the way this sets it up; what is checked here is that the room
 * really does set it up that way.
 */
const silentContext: ListeningAudioContext = {
  sampleRate: 48_000,
  state: 'running',
  createAnalyser: () => {
    throw new Error('Nothing is listened to here.');
  },
  createMediaStreamSource: () => {
    throw new Error('Nothing is listened to here.');
  },
  resume: async () => undefined,
};

const greetingPlayer: GreetingPlayer = {
  playFromStart: async () => false,
  stop: () => undefined,
  position: () => -1,
  duration: 0,
};

function optionsWith(overrides: Partial<HeadsetSessionDependencyOptions> = {}): HeadsetSessionDependencyOptions {
  return {
    settings: { apiKey: 'sk_a-secret-key', agentId: 'agent_01jz0123456789' },
    startSession: () => Promise.reject(new Error('Nothing is dialled here.')),
    greeting: greetingPlayer,
    events: { onPhase: () => undefined, onProblem: () => undefined, onCaption: () => undefined },
    audioContext: silentContext,
    ...overrides,
  };
}

describe('the headset’s session', () => {
  const dependencies = headsetSessionDependencies(optionsWith());

  it('names itself as the headset in the conversation history', () => {
    expect(dependencies.participantName).toBe(HEADSET_PARTICIPANT_NAME);
  });

  it('dials with no platform delay, whatever Quest Browser says it is', () => {
    expect(dependencies.connectionDelay).toEqual(NO_CONNECTION_DELAY);
    expect(NO_CONNECTION_DELAY).toEqual({ default: 0, android: 0 });
  });

  it('keeps the half-duplex fallback for a microphone a few centimetres from his voice', () => {
    expect(dependencies.halfDuplex).toBe(true);
  });

  it('says a request that reached no server in words about the headset', () => {
    expect(dependencies.offlineProblem).toBe(HEADSET_OFFLINE_PROBLEM);
  });

  it('finds his room with this app’s own `Room`, and clears what a dropped call leaves on the page', () => {
    expect(dependencies.findRoom).toBe(findAgentRoom);
    expect(dependencies.removeOrphanedAudio).toBe(removeOrphanedAudioFromPage);
  });

  it('waits for a conversation on the session’s own deadline, unless the room holds it open', () => {
    // Left to the session, which gives up after GIVE_UP_CONNECTING_AFTER_MS on every device.
    expect(dependencies.giveUpConnectingAfterMs).toBeUndefined();

    const held = headsetSessionDependencies(optionsWith({ giveUpConnectingAfterMs: Number.POSITIVE_INFINITY }));

    expect(held.giveUpConnectingAfterMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('what the room hears of what he is working on', () => {
  const touched: AffectedEntity[] = [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }, { id: 'inbox:work' }];

  it('is every affectedEntities message the server sends, passed on as it came', () => {
    const reports: Array<readonly AffectedEntity[]> = [];
    const handle = serverMessageHandler((entities) => reports.push(entities));

    handle({ type: 'ready' });
    handle({ type: 'affectedEntities', entities: touched });
    handle({ type: 'affectedEntities', entities: [{ id: 'calendar/primary' }] });

    expect(reports).toEqual([touched, [{ id: 'calendar/primary' }]]);
  });

  it('is nothing at all for a room that does not ask', () => {
    const handle = serverMessageHandler(undefined);

    expect(() => handle({ type: 'affectedEntities', entities: touched })).not.toThrow();
  });
});

describe('the headset’s session with his voice from where he stands', () => {
  /** A spatial voice that records what the session asks of it. */
  function recordingVoice() {
    const told: string[] = [];
    let mayJudge = false;
    let serverSaysSpeaking: (() => boolean) | undefined;
    const routed: GreetingPlayer = { ...greetingPlayer, duration: 3.1 };
    const voice: HeadsetVoice = {
      greeting: (player) => {
        told.push(player === greetingPlayer ? 'greeting routed' : 'another greeting');
        return routed;
      },
      playAgent: () => () => undefined,
      conversationOpened: (saysSpeaking) => {
        serverSaysSpeaking = saysSpeaking;
        told.push('conversation opened');
        return () => told.push('conversation closed');
      },
      attached: () => told.push('element attached'),
      interrupted: () => told.push('interrupted'),
      heard: (message) => told.push(`${message.role}: ${message.message}`),
      halfDuplexMayJudge: () => mayJudge,
      halfDuplexChanged: (on) => told.push(`half duplex ${on ? 'on' : 'off'}`),
    };
    return {
      voice,
      told,
      routed,
      allowJudging: () => {
        mayJudge = true;
      },
      get serverSaysSpeaking() {
        return serverSaysSpeaking?.() ?? false;
      },
    };
  }

  /** A room with the agent in it, whose server-side speaking flag the test sets. */
  function agentRoom() {
    const agent = { identity: 'agent_7123', isSpeaking: false, audioTrackPublications: new Map() };
    const room: AgentTrackRoom = {
      remoteParticipants: new Map([['agent', agent]]),
      on: () => undefined,
      off: () => undefined,
    };
    return { room, agent };
  }

  it('plays the greeting and passes the room’s events on untouched without one', () => {
    const options = optionsWith();
    const dependencies = headsetSessionDependencies(options);
    expect(dependencies.greeting).toBe(greetingPlayer);
    expect(dependencies.events).toBe(options.events);
    expect(dependencies.halfDuplexMayJudge).toBeUndefined();
  });

  it('routes the greeting through it, and lets it hold the half-duplex fallback back', () => {
    const recording = recordingVoice();
    const dependencies = headsetSessionDependencies(optionsWith({ voice: recording.voice }));

    expect(dependencies.greeting).toBe(recording.routed);
    expect(recording.told).toEqual(['greeting routed']);
    expect(dependencies.halfDuplex).toBe(true);
    expect(dependencies.halfDuplexMayJudge?.()).toBe(false);
    recording.allowJudging();
    expect(dependencies.halfDuplexMayJudge?.()).toBe(true);
  });

  it('tells it of every interruption and every line, after telling the room', () => {
    const recording = recordingVoice();
    const roomTold: string[] = [];
    const dependencies = headsetSessionDependencies(
      optionsWith({
        voice: recording.voice,
        events: {
          onPhase: () => undefined,
          onInterruption: () => roomTold.push('interrupted'),
        },
      }),
    );

    dependencies.events.onInterruption?.();
    dependencies.events.onMessage?.({ role: 'user', message: 'Is the suit ready?' });
    dependencies.events.onDiagnostics?.({ status: 'connected', mode: 'speaking', interruptions: 2, halfDuplex: true });

    expect(roomTold).toEqual(['interrupted']);
    expect(recording.told).toEqual(['greeting routed', 'interrupted', 'user: Is the suit ready?', 'half duplex on']);
  });

  it('opens a conversation on it for every room found, with the server’s word on whether he speaks', () => {
    const recording = recordingVoice();
    const dependencies = headsetSessionDependencies(optionsWith({ voice: recording.voice }));
    const { room, agent } = agentRoom();

    const stop = dependencies.followAgentVoice?.(room, () => undefined);
    expect(recording.told).toContain('conversation opened');
    expect(recording.serverSaysSpeaking).toBe(false);
    agent.isSpeaking = true;
    expect(recording.serverSaysSpeaking).toBe(true);

    stop?.();
    expect(recording.told.at(-1)).toBe('conversation closed');
  });
});
