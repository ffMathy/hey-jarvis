import { describe, expect, it } from 'bun:test';
import { MARK_AFFECTED_TOOL } from './affected-entities';
import { GIVE_UP_CONNECTING_AFTER_MS } from './conversation-life';
import { HEADSET_PARTICIPANT_NAME } from './conversation-token';
import { DEADLINE_PROBLEM, DROPPED_PROBLEM, MICROPHONE_PROBLEM, UNREACHABLE_PROBLEM } from './failure-text';
import { GREETING_GRACE_SECONDS, WITHOUT_FIRST_MESSAGE } from './greeting-handover';
import { createHarness, HEADSET_OFFLINE_PROBLEM, settle } from './jarvis-session.fakes';

/**
 * A summoning from the wake word to its ending: the greeting and the token at once, the session
 * dialled after him, and every way it can fail landing in `failed` with something readable — the
 * guarantees the SDK's React provider gives, rebuilt with no React. Set up as the headset sets it
 * up; what the phone and the watch add is in `jarvis-session-devices.spec.ts`.
 */

describe('summoning Jarvis', () => {
  it('greets and asks for a token at the same moment, as the headset', () => {
    const { session, tokens, greeting, events } = createHarness();

    session.summon();

    expect(session.phase).toBe('greeting');
    expect(events.phases).toEqual(['greeting']);
    expect(greeting.plays).toBe(1);
    expect(tokens.requests).toHaveLength(1);
    const request = tokens.requests[0];
    expect(request?.url.searchParams.get('participant_name')).toBe(HEADSET_PARTICIPANT_NAME);
    expect(request?.url.searchParams.get('agent_id')).toBe('agent_01jz0123456789');
    expect(request?.headers.get('xi-api-key')).toBe('sk_a-secret-key');
  });

  it('starts one summoning at a time, and another only once the last is over', async () => {
    const harness = createHarness();
    const { session, tokens, greeting } = harness;

    session.summon();
    session.summon();
    expect(tokens.requests).toHaveLength(1);
    expect(greeting.plays).toBe(1);

    greeting.allow();
    tokens.grant();
    await settle();
    await harness.clock.advance(greeting.durationMilliseconds + 100);
    session.summon();
    await harness.sdk.latest.connect();
    session.summon();
    expect(harness.sdk.dials).toHaveLength(1);
    expect(tokens.requests).toHaveLength(1);

    harness.sdk.latest.agentHangsUp();
    expect(session.phase).toBe('ended');
    session.summon();
    expect(session.phase).toBe('greeting');
    expect(tokens.requests).toHaveLength(2);
  });

  it('dials only once the greeting is over, told not to greet a second time', async () => {
    const { session, tokens, greeting, sdk, clock, events } = createHarness();

    session.summon();
    greeting.allow();
    tokens.grant();
    await settle();
    expect(sdk.dials).toHaveLength(0);
    expect(session.phase).toBe('greeting');

    await clock.advance(greeting.durationMilliseconds + 100);
    expect(session.phase).toBe('connecting');
    expect(sdk.dials).toHaveLength(1);
    const { spoken } = sdk.latest;
    expect(spoken?.conversationToken).toBe('a-webrtc-token');
    expect(spoken?.connectionType).toBe('webrtc');
    expect(spoken?.connectionDelay).toEqual({ default: 0, android: 0 });
    expect(spoken?.overrides).toEqual(WITHOUT_FIRST_MESSAGE);

    await sdk.latest.connect();
    expect(session.phase).toBe('live');
    expect(events.phases).toEqual(['greeting', 'connecting', 'live']);
    // Dialled after him, there was never anything to mute for.
    expect(sdk.latest.conversation.muting).toEqual([]);
  });

  it('dials the moment a late token arrives, once the greeting has finished', async () => {
    const { session, tokens, greeting, sdk, clock } = createHarness();

    session.summon();
    greeting.allow();
    await settle();
    await clock.advance(greeting.durationMilliseconds + 500);
    expect(session.phase).toBe('connecting');
    expect(sdk.dials).toHaveLength(0);

    tokens.grant();
    await settle();
    expect(sdk.dials).toHaveLength(1);
  });

  it('can dial behind the greeting instead, muting the session until he has finished', async () => {
    const { session, tokens, greeting, sdk, clock, events } = createHarness({ waitsForGreetingBeforeDialling: false });

    session.summon();
    greeting.allow();
    tokens.grant();
    await settle();
    expect(sdk.dials).toHaveLength(1);
    expect(sdk.latest.spoken?.overrides).toEqual(WITHOUT_FIRST_MESSAGE);

    const conversation = sdk.latest.conversation;
    const statusWhenMuted: string[] = [];
    conversation.setMicMuted = (muted) => {
      conversation.muting.push(muted);
      statusWhenMuted.push(events.diagnostics.at(-1)?.status ?? 'none');
    };
    await sdk.latest.connect();

    // Muted as the session was created — before the SDK said `connected` — and still greeting.
    expect(conversation.muting).toEqual([true]);
    expect(statusWhenMuted).toEqual(['connecting']);
    expect(session.phase).toBe('greeting');

    await clock.advance(greeting.durationMilliseconds);
    expect(conversation.muting).toEqual([true, false]);
    expect(session.phase).toBe('live');
    expect(events.phases).toEqual(['greeting', 'live']);
  });

  it('lets the agent greet for himself when the browser refuses the recording', async () => {
    const { session, tokens, greeting, sdk } = createHarness();

    session.summon();
    greeting.refuse();
    await settle();
    expect(session.phase).toBe('connecting');

    tokens.grant();
    await settle();
    expect(sdk.latest.spoken?.overrides).toBeUndefined();
  });

  it('gives up on a recording the browser never answers for, and stops it if it starts late', async () => {
    const { session, tokens, greeting, sdk, clock } = createHarness();

    session.summon();
    tokens.grant();
    await clock.advance(greeting.durationMilliseconds + GREETING_GRACE_SECONDS * 1000);
    expect(session.phase).toBe('connecting');
    expect(greeting.stops).toBe(1);
    expect(sdk.latest.spoken?.overrides).toBeUndefined();

    greeting.allow();
    await settle();
    expect(greeting.stops).toBe(2);
  });

  it('notices the greeting has ended when the hologram reads his voice, even with its timers held back', async () => {
    const { session, greeting, clock } = createHarness();

    session.summon();
    greeting.allow();
    await settle();
    clock.jump(greeting.durationMilliseconds + 10);
    expect(session.phase).toBe('greeting');

    session.voice.getVolume();
    expect(session.phase).toBe('connecting');
  });
});

describe('when a summoning fails', () => {
  const tokenFailures = [
    { status: 401, problem: 'ElevenLabs rejected the API key. Check it in the settings.' },
    { status: 402, problem: 'The ElevenLabs account has run out of credits.' },
    {
      status: 404,
      problem: 'ElevenLabs has no agent with that ID on this account. Check the agent ID in the settings.',
    },
    { status: 429, problem: 'ElevenLabs is busy with too many conversations on this account. Try again shortly.' },
  ];

  for (const { status, problem } of tokenFailures) {
    it(`says why when the token request answers ${status}, stops the greeting and dials nothing`, async () => {
      const { session, tokens, greeting, sdk, events } = createHarness();

      session.summon();
      greeting.allow();
      tokens.refuse(status);
      await settle();

      expect(events.log).toEqual(['phase:greeting', `problem:${problem}`, 'phase:failed']);
      expect(greeting.stops).toBe(1);
      expect(sdk.dials).toHaveLength(0);
    });
  }

  it('says the headset is offline rather than repeating the browser’s "Failed to fetch"', async () => {
    const { session, tokens, events } = createHarness();

    session.summon();
    tokens.goOffline();
    await settle();

    expect(events.problems).toEqual([HEADSET_OFFLINE_PROBLEM]);
    expect(session.phase).toBe('failed');
  });

  it('gives up at the deadline when nothing answers', async () => {
    const { session, greeting, clock, events } = createHarness();

    session.summon();
    greeting.allow();
    await clock.advance(GIVE_UP_CONNECTING_AFTER_MS - 1);
    expect(session.phase).toBe('connecting');

    await clock.advance(1);
    expect(events.problems).toEqual([DEADLINE_PROBLEM]);
    expect(session.phase).toBe('failed');
  });

  it('gives up when its holder says to, rather than at the shared deadline', async () => {
    const { session, greeting, clock, events } = createHarness({ giveUpConnectingAfterMs: 5_000 });

    session.summon();
    greeting.allow();
    await clock.advance(4_999);
    expect(session.phase).toBe('connecting');

    await clock.advance(1);
    expect(events.problems).toEqual([DEADLINE_PROBLEM]);
    expect(session.phase).toBe('failed');
  });

  it('never gives up when told to wait for ever, and still connects when the token comes', async () => {
    const { session, tokens, greeting, sdk, clock, events } = createHarness({
      giveUpConnectingAfterMs: Number.POSITIVE_INFINITY,
    });

    session.summon();
    greeting.allow();
    // The fake clock runs a timer of `Infinity` at once, as a browser does, so a deadline armed
    // with it would already have failed here.
    await clock.advance(GIVE_UP_CONNECTING_AFTER_MS * 10);
    expect(session.phase).toBe('connecting');
    expect(events.problems).toEqual([]);

    tokens.grant();
    await settle();
    await sdk.latest.connect();
    expect(session.phase).toBe('live');
    expect(events.log).toEqual(['phase:greeting', 'phase:connecting', 'phase:live']);
  });

  it('ends a session that only connects after the deadline gave up on it', async () => {
    const { session, tokens, greeting, sdk, clock, events } = createHarness();

    session.summon();
    greeting.refuse();
    tokens.grant();
    await settle();
    await clock.advance(GIVE_UP_CONNECTING_AFTER_MS);
    expect(session.phase).toBe('failed');

    const late = sdk.latest;
    await late.connect();
    expect(late.conversation.endSessions).toBe(1);
    expect(session.phase).toBe('failed');
    expect(events.log).toEqual(['phase:greeting', 'phase:connecting', `problem:${DEADLINE_PROBLEM}`, 'phase:failed']);
  });

  it('says why a start rejected', async () => {
    const { session, tokens, greeting, sdk, events } = createHarness();

    session.summon();
    greeting.refuse();
    tokens.grant();
    await settle();
    await sdk.latest.reject(new Error('could not establish signal connection'));

    expect(events.problems).toEqual(['could not establish signal connection']);
    expect(session.phase).toBe('failed');
  });

  it('names a refused microphone, and falls back to the phone’s words for a start with nothing to say', async () => {
    const refused = createHarness();
    refused.session.summon();
    refused.greeting.refuse();
    refused.tokens.grant();
    await settle();
    await refused.sdk.latest.reject(new DOMException('Permission denied', 'NotAllowedError'));
    expect(refused.events.problems).toEqual([MICROPHONE_PROBLEM]);

    const silent = createHarness();
    silent.session.summon();
    silent.greeting.refuse();
    silent.tokens.grant();
    await settle();
    await silent.sdk.latest.reject(new Error(''));
    expect(silent.events.problems).toEqual([UNREACHABLE_PROBLEM]);
  });

  it('fails on an error the SDK reports before the conversation is open', async () => {
    const { session, tokens, greeting, sdk, events } = createHarness();

    session.summon();
    greeting.refuse();
    tokens.grant();
    await settle();
    sdk.latest.options.onError('Failed to set up the session');

    expect(events.problems).toEqual(['Failed to set up the session']);
    expect(session.phase).toBe('failed');
  });

  it('only notes an error the SDK reports once the conversation is open', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.sdk.latest.options.onError('Server error: something non-fatal');

    expect(harness.session.phase).toBe('live');
    expect(harness.events.problems).toEqual([]);
    expect(harness.events.diagnostics.at(-1)?.lastError).toBe('Server error: something non-fatal');
  });

  it('says the connection dropped, in words, when the room closes under an open conversation', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.sdk.latest.drop('LiveKit connection state changed to disconnected');

    expect(harness.events.problems).toEqual([DROPPED_PROBLEM]);
    expect(harness.session.phase).toBe('failed');
    expect(harness.orphanSweeps).toBe(1);
    await harness.clock.advance(2_000);
    expect(harness.orphanSweeps).toBe(2);
  });

  it('passes on the SDK’s reason for any other error ending, unless it could carry a credential', async () => {
    const quota = createHarness();
    await quota.goLive();
    quota.sdk.latest.drop('Quota exceeded');
    expect(quota.events.problems).toEqual(['Quota exceeded']);

    const leaky = createHarness();
    await leaky.goLive();
    leaky.sdk.latest.drop('wss://livekit.example/rtc?access_token=eyJhbGciOiJIUzI1NiJ9.payload');
    expect(leaky.events.problems).toEqual(['The conversation with Jarvis ended unexpectedly.']);
  });

  it('keeps callbacks from a failed summoning out of the next one', async () => {
    const { session, tokens, greeting, sdk, clock, events } = createHarness();

    session.summon();
    greeting.refuse();
    tokens.grant();
    await settle();
    const stale = sdk.latest;
    await clock.advance(GIVE_UP_CONNECTING_AFTER_MS);

    session.summon();
    expect(session.phase).toBe('greeting');
    stale.options.onStatusChange({ status: 'connected' });
    stale.options.onDisconnect({ reason: 'error', message: 'Quota exceeded' });
    stale.options.onAgentToolRequest({ tool_call_id: 'stale-call' });
    const staleAnswer = await stale.callClientTool(MARK_AFFECTED_TOOL, { entities: [{ id: 'light.hall' }] });

    expect(session.phase).toBe('greeting');
    expect(session.thinking).toBe(false);
    expect(events.problems).toEqual([DEADLINE_PROBLEM]);
    expect(staleAnswer.isError).toBe(false);
    expect(events.affected).toEqual([]);
  });
});

describe('ending a summoning', () => {
  it('ends when the agent hangs up, with nothing to say about it', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.sdk.latest.agentHangsUp();

    expect(harness.session.phase).toBe('ended');
    expect(harness.events.problems).toEqual([]);
  });

  it('stops him mid-greeting when hung up on, and dials nothing afterwards', async () => {
    const { session, tokens, greeting, sdk, clock } = createHarness();

    session.summon();
    greeting.allow();
    await settle();
    session.hangUp();
    expect(session.phase).toBe('ended');
    expect(greeting.stops).toBe(1);

    tokens.grant();
    await clock.advance(greeting.durationMilliseconds + 100);
    expect(sdk.dials).toHaveLength(0);
  });

  it('ends an open session as the user, and reports nothing that follows', async () => {
    const harness = createHarness();
    await harness.goLive();
    const conversation = harness.sdk.latest.conversation;

    harness.session.hangUp();

    expect(conversation.endSessions).toBe(1);
    expect(harness.session.phase).toBe('ended');
    harness.sdk.latest.options.onDisconnect({
      reason: 'error',
      message: 'LiveKit connection state changed to disconnected',
    });
    expect(harness.events.problems).toEqual([]);
    expect(harness.session.phase).toBe('ended');
  });

  it('ends quietly for the system, suppressing a late error from the dropped room', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.session.endQuietly();
    harness.sdk.latest.drop('LiveKit connection state changed to disconnected');
    harness.sdk.latest.options.onDisconnect({
      reason: 'error',
      message: 'LiveKit connection state changed to disconnected',
    });

    expect(harness.session.phase).toBe('ended');
    expect(harness.events.problems).toEqual([]);
  });

  it('ends a session still dialling the moment its start resolves', async () => {
    const { session, tokens, greeting, sdk } = createHarness();

    session.summon();
    greeting.refuse();
    tokens.grant();
    await settle();
    session.endQuietly();
    await sdk.latest.connect();

    expect(sdk.latest.conversation.endSessions).toBe(1);
    expect(session.phase).toBe('ended');
  });

  it('is done for good once disposed', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.session.dispose();
    harness.session.summon();

    expect(harness.session.phase).toBe('ended');
    expect(harness.sdk.latest.conversation.endSessions).toBe(1);
    expect(harness.tokens.requests).toHaveLength(1);
  });
});
