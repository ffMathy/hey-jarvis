import { describe, expect, it } from 'bun:test';
import { HEADSET_PARTICIPANT_NAME } from 'hologram';
import { findAgentRoom } from './agent-room';
import { HEADSET_OFFLINE_PROBLEM, headsetSessionDependencies, NO_CONNECTION_DELAY } from './headset-session';
import { removeOrphanedAudioFromPage } from './orphaned-audio';

/**
 * What the headset hands `hologram`'s session. The session's own behaviour is pinned by its specs
 * in `hologram`, which are set up the way this sets it up; what is checked here is that the room
 * really does set it up that way.
 */
describe('the headset’s session', () => {
  const dependencies = headsetSessionDependencies({
    settings: { apiKey: 'sk_a-secret-key', agentId: 'agent_01jz0123456789' },
    startSession: () => Promise.reject(new Error('Nothing is dialled here.')),
    greeting: { playFromStart: async () => false, stop: () => undefined, position: () => -1, duration: 0 },
    events: { onPhase: () => undefined, onProblem: () => undefined, onCaption: () => undefined },
    audioContext: {
      sampleRate: 48_000,
      state: 'running',
      createAnalyser: () => {
        throw new Error('Nothing is listened to here.');
      },
      createMediaStreamSource: () => {
        throw new Error('Nothing is listened to here.');
      },
      resume: async () => undefined,
    },
  });

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
});
