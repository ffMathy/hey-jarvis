import { describe, expect, it } from 'bun:test';
import { afterStatus, NOT_YET_OPEN } from './conversation-life';
import { PHONE_PARTICIPANT_NAME } from './conversation-token';
import { DROPPED_PROBLEM } from './failure-text';
import { WITHOUT_FIRST_MESSAGE } from './greeting-handover';
import { REDIAL_GIVE_UP_AFTER_MS } from './jarvis-session';
import { createFakeCallAudio, createHarness, settle } from './jarvis-session.fakes';

/**
 * A phone on an unstable connection: what the session does when the line to an open conversation
 * drops (`connection-drop.ts`) — it redials, keeping him on screen, rather than letting him go.
 */

const LIVEKIT_GAVE_UP = 'LiveKit connection state changed to disconnected';

function onAPhone() {
  const callAudio = createFakeCallAudio();
  const harness = createHarness({
    participantName: PHONE_PARTICIPANT_NAME,
    connectionDelay: undefined,
    halfDuplex: false,
    offlineProblem: undefined,
    captions: 'while-typing',
    callAudio: callAudio.callAudio,
    removeOrphanedAudio: undefined,
  });
  // Everything a screen would have seen of the conversation's status, as the phone folds it.
  const statuses: string[] = [];
  harness.session.subscribe(() => {
    if (statuses.at(-1) !== harness.session.snapshot.status) {
      statuses.push(harness.session.snapshot.status);
    }
  });
  return Object.assign(harness, {
    callAudio,
    statuses,
    /** Summoned inside the call's audio, greeted, and connected once he has finished. */
    async goLive() {
      harness.session.summon();
      await settle();
      harness.greeting.allow();
      harness.tokens.grant();
      await settle();
      await harness.clock.advance(harness.greeting.durationMilliseconds + 100);
      await harness.sdk.latest.connect();
    },
  });
}

type Phone = ReturnType<typeof onAPhone>;

/** Whether a phone's screen, folding every status it saw, would have sent him away. */
function sentAway(phone: Phone) {
  return phone.statuses.reduce(afterStatus, NOT_YET_OPEN).ended;
}

describe('a dropped line', () => {
  it('is redialled with him still on screen, skipping the greeting, and the agent told what was said', async () => {
    const phone = onAPhone();
    await phone.goLive();
    const first = phone.sdk.latest;
    first.options.onMessage({ role: 'user', message: 'Turn on the kitchen lights.' });
    first.options.onMessage({ role: 'ai', message: 'Of course, sir.' });

    first.drop(LIVEKIT_GAVE_UP, 'connection_state_changed');
    expect(phone.session.phase).toBe('connecting');
    expect(phone.session.snapshot.status).toBe('connecting');
    expect(phone.tokens.requests).toHaveLength(2);

    phone.tokens.grant();
    await settle();
    expect(phone.sdk.dials).toHaveLength(2);
    const second = phone.sdk.latest;
    expect(second.spoken?.overrides).toEqual(WITHOUT_FIRST_MESSAGE);
    expect(phone.greeting.plays).toBe(1);

    await second.connect();
    expect(phone.session.phase).toBe('live');
    expect(phone.session.liveConversationId()).toBe('conv_fake2');
    expect(second.conversation.contextualUpdates).toHaveLength(1);
    const recap = second.conversation.contextualUpdates[0];
    expect(recap?.contextId).toBe('redialled');
    expect(recap?.text).toContain('Do not greet him again');
    expect(recap?.text).toContain('Sir: Turn on the kitchen lights.\nYou: Of course, sir.');

    expect(phone.events.problems).toEqual([]);
    expect(sentAway(phone)).toBe(false);
    expect(phone.statuses.slice(phone.statuses.indexOf('connected'))).not.toContain('disconnected');
    // The call's audio is the summoning's, and stays switched in across the redial.
    expect(phone.callAudio.log).toEqual(['start']);
  });

  it('is redialled when a change of network makes the agent seem to leave', async () => {
    const phone = onAPhone();
    await phone.goLive();

    phone.sdk.latest.agentSeemsToLeave();
    expect(phone.session.phase).toBe('connecting');
    phone.tokens.grant();
    await settle();
    await phone.sdk.latest.connect();

    expect(phone.session.phase).toBe('live');
    expect(sentAway(phone)).toBe(false);
  });

  it('keeps trying, backing off, while the phone is offline, and is live again once it is back', async () => {
    const phone = onAPhone();
    await phone.goLive();
    phone.sdk.latest.drop(LIVEKIT_GAVE_UP, 'connection_state_changed');

    phone.tokens.goOffline();
    await settle();
    expect(phone.tokens.requests).toHaveLength(2);
    await phone.clock.advance(1_000);
    expect(phone.tokens.requests).toHaveLength(3);

    phone.tokens.goOffline();
    await settle();
    await phone.clock.advance(1_999);
    expect(phone.tokens.requests).toHaveLength(3);
    await phone.clock.advance(1);
    expect(phone.tokens.requests).toHaveLength(4);

    phone.tokens.grant();
    await settle();
    await phone.sdk.latest.connect();
    expect(phone.session.phase).toBe('live');
    expect(phone.events.problems).toEqual([]);
  });

  it('dials again when a redial fails to start, and drops nothing the failed one reports afterwards', async () => {
    const phone = onAPhone();
    await phone.goLive();
    phone.sdk.latest.drop(LIVEKIT_GAVE_UP, 'connection_state_changed');
    phone.tokens.grant();
    await settle();

    const failed = phone.sdk.latest;
    await failed.reject(new Error('could not establish pc connection'));
    expect(phone.session.phase).toBe('connecting');
    expect(phone.statuses.slice(phone.statuses.indexOf('connected'))).not.toContain('disconnected');

    await phone.clock.advance(1_000);
    phone.tokens.grant();
    await settle();
    expect(phone.sdk.dials).toHaveLength(3);
    await phone.sdk.latest.connect();

    failed.options.onDisconnect({ reason: 'error', message: 'late', context: { type: 'close' } });
    expect(phone.session.phase).toBe('live');
    expect(phone.events.problems).toEqual([]);
  });

  it('gives up after a while, saying in words that the connection dropped, and lets go of the call', async () => {
    const phone = onAPhone();
    await phone.goLive();
    phone.sdk.latest.drop(LIVEKIT_GAVE_UP, 'connection_state_changed');

    await phone.clock.advance(REDIAL_GIVE_UP_AFTER_MS - 1);
    expect(phone.session.phase).toBe('connecting');
    await phone.clock.advance(1);

    expect(phone.session.phase).toBe('failed');
    expect(phone.events.problems).toEqual([DROPPED_PROBLEM]);
    expect(phone.events.sources).toEqual(['session']);
    expect(phone.callAudio.log).toEqual(['start', 'stop']);
  });

  it('stops redialling when hung up on', async () => {
    const phone = onAPhone();
    await phone.goLive();
    phone.sdk.latest.drop(LIVEKIT_GAVE_UP, 'connection_state_changed');

    phone.session.hangUp();
    phone.tokens.grant();
    await phone.clock.advance(REDIAL_GIVE_UP_AFTER_MS);

    expect(phone.session.phase).toBe('ended');
    expect(phone.sdk.dials).toHaveLength(1);
    expect(phone.events.problems).toEqual([]);
  });

  it('redials a conversation held in writing over a fresh signed URL, without its first message', async () => {
    const browser = createHarness({ participantName: PHONE_PARTICIPANT_NAME, removeOrphanedAudio: undefined });
    browser.session.summon({ textOnly: true });
    browser.tokens.sign();
    await settle();
    await browser.sdk.latest.connect();

    browser.sdk.latest.options.onDisconnect({
      reason: 'error',
      message: 'The connection was closed by the server.',
      context: { type: 'close', code: 1006 },
    });
    browser.tokens.sign();
    await settle();

    expect(browser.sdk.latest.written?.overrides).toEqual(WITHOUT_FIRST_MESSAGE);
    await browser.sdk.latest.connect();
    expect(browser.session.phase).toBe('live');
  });
});

describe('a call that is over', () => {
  it('is not redialled when the agent hangs up', async () => {
    const phone = onAPhone();
    await phone.goLive();

    phone.sdk.latest.agentHangsUp();

    expect(phone.session.phase).toBe('ended');
    expect(phone.tokens.requests).toHaveLength(1);
  });

  it('is not redialled when the server ends it', async () => {
    const phone = onAPhone();
    await phone.goLive();

    phone.sdk.latest.drop('Quota exceeded', 'close');

    expect(phone.session.phase).toBe('failed');
    expect(phone.events.problems).toEqual(['Quota exceeded']);
    expect(phone.tokens.requests).toHaveLength(1);
  });

  it('is not redialled again when the agent leaves a redialled conversation nobody has spoken in', async () => {
    const phone = onAPhone();
    await phone.goLive();
    phone.sdk.latest.agentSeemsToLeave();
    phone.tokens.grant();
    await settle();
    await phone.sdk.latest.connect();

    phone.sdk.latest.agentSeemsToLeave();

    expect(phone.session.phase).toBe('ended');
    expect(phone.tokens.requests).toHaveLength(2);
  });

  it('is redialled again once sir has spoken in the redialled conversation', async () => {
    const phone = onAPhone();
    await phone.goLive();
    phone.sdk.latest.agentSeemsToLeave();
    phone.tokens.grant();
    await settle();
    await phone.sdk.latest.connect();
    phone.sdk.latest.options.onMessage({ role: 'user', message: 'Are you still there?' });

    phone.sdk.latest.agentSeemsToLeave();

    expect(phone.session.phase).toBe('connecting');
    expect(phone.tokens.requests).toHaveLength(3);
  });
});
