import { describe, expect, it } from 'bun:test';
import { INTERRUPTED_TOO_SOON_MS } from './half-duplex';
import { createHarness, settle } from './jarvis-session.fakes';
import { KEEP_THINKING_AFTER_LAST_ANSWER_MS } from './tool-activity';

/**
 * What an open conversation hands the hologram and the room: his voice and yours, whether he is
 * thinking, his line in writing while you type, and the microphone rules that hold it all together
 * — the greeting, the keyboard and the half-duplex fallback. And what the phone's camera button
 * asks of it: notes the agent reads without a turn being taken, word that sir is still there, and
 * the live conversation's id.
 */

/** Readers for his track that say a fixed level, as `createPlayedVoiceReaders` would. */
function steadyVoice(volume: number) {
  const spectrum = new Uint8Array(1024).fill(Math.round(volume * 255));
  return { getVolume: () => volume, getSpectrum: () => spectrum };
}

describe('the voice the sphere follows', () => {
  it('is silence before a summoning, the greeting while he says it, and silence while dialling', async () => {
    const { session, greeting, clock } = createHarness();
    expect(session.voice.listening).toBe(false);

    session.summon();
    greeting.allow();
    await settle();
    await clock.advance(500);
    const greetingVoice = session.voice;
    expect(greetingVoice.listening).toBe(true);
    expect(greetingVoice.speaking).toBe(true);
    expect(greetingVoice.getVolume()).toBeGreaterThan(0);

    await clock.advance(greeting.durationMilliseconds);
    expect(session.phase).toBe('connecting');
    expect(session.voice.listening).toBe(false);
    expect(greetingVoice.getVolume()).toBe(0);
  });

  it('is his track once connected, and the SDK’s own readings until the track can be read', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { session, sdk } = harness;

    const fromTheSdk = session.voice;
    expect(fromTheSdk.listening).toBe(true);
    expect(fromTheSdk.getVolume()).toBe(sdk.latest.conversation.outputVolume);
    expect(fromTheSdk.speaking).toBe(false);

    harness.playAgentVoice(steadyVoice(0.42));
    const fromTheTrack = session.voice;
    expect(fromTheTrack).not.toBe(fromTheSdk);
    expect(fromTheTrack.getVolume()).toBe(0.42);

    sdk.latest.options.onModeChange({ mode: 'speaking' });
    expect(session.voice.speaking).toBe(true);

    sdk.latest.agentHangsUp();
    expect(session.voice.listening).toBe(false);
    expect(harness.followsStopped).toBe(1);
  });
});

describe('the user’s voice, for the listening lattice', () => {
  it('is the latest vad score and the microphone’s level while he is being listened to', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { session, sdk } = harness;

    sdk.latest.options.onVadScore({ vadScore: 0.8 });
    expect(session.user.getPresence()).toBe(0.8);
    expect(session.user.getVolume()).toBe(sdk.latest.conversation.inputVolume);
  });

  it('is deaf while Jarvis speaks, since his voice through the speaker scores as the user’s', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { session, sdk } = harness;

    sdk.latest.options.onModeChange({ mode: 'speaking' });
    sdk.latest.options.onVadScore({ vadScore: 0.9 });
    expect(session.user.getPresence()).toBe(0);

    sdk.latest.options.onModeChange({ mode: 'listening' });
    expect(session.user.getPresence()).toBe(0);
    sdk.latest.options.onVadScore({ vadScore: 0.6 });
    expect(session.user.getPresence()).toBe(0.6);
  });

  it('is deaf while he greets, even with the session already open behind him', async () => {
    const { session, tokens, greeting, sdk } = createHarness({ waitsForGreetingBeforeDialling: false });

    session.summon();
    greeting.allow();
    tokens.grant();
    await settle();
    await sdk.latest.connect();
    sdk.latest.options.onVadScore({ vadScore: 0.9 });

    expect(session.user.getPresence()).toBe(0);
    expect(session.user.getVolume()).toBe(0);
  });

  it('reads nobody while the keyboard has the microphone muted', async () => {
    const harness = createHarness();
    await harness.goLive();
    harness.sdk.latest.options.onVadScore({ vadScore: 0.7 });

    harness.session.setTyping(true);

    expect(harness.session.user.getPresence()).toBe(0);
    expect(harness.session.user.getVolume()).toBe(0);
  });
});

describe('thinking', () => {
  it('follows his tool calls, and holds past the last answer for the settling window', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { session, sdk, clock } = harness;

    sdk.latest.options.onAgentToolRequest({ tool_call_id: 'weather' });
    expect(session.thinking).toBe(true);

    sdk.latest.options.onAgentToolResponse({ tool_call_id: 'weather' });
    await clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS - 1);
    expect(session.thinking).toBe(true);
    await clock.advance(1);
    expect(session.thinking).toBe(false);

    sdk.latest.options.onMCPToolCall({ tool_call_id: 'route', state: 'loading' });
    expect(session.thinking).toBe(true);
  });

  it('stops the moment the conversation ends, with a call still in flight', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.sdk.latest.options.onMCPToolCall({ tool_call_id: 'route', state: 'loading' });
    harness.sdk.latest.agentHangsUp();

    expect(harness.session.thinking).toBe(false);
  });
});

describe('interruptions', () => {
  it('drop what the browser still has queued of the sentence he was cut off in', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.sdk.latest.options.onInterruption();

    expect(harness.element.assignments).toEqual([null, harness.element.stream]);
    expect(harness.element.plays).toBe(1);
    expect(harness.events.diagnostics.at(-1)?.interruptions).toBe(1);
  });

  it('switch to half duplex when he is cut off as soon as he starts, and mute him only while he speaks', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { sdk, clock, session } = harness;
    const { conversation, options } = sdk.latest;

    options.onModeChange({ mode: 'speaking' });
    await clock.advance(INTERRUPTED_TOO_SOON_MS - 50);
    options.onInterruption();
    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(true);
    // The SDK reports the interruption first and only then switches the mode.
    expect(conversation.muting).toEqual([true]);
    options.onModeChange({ mode: 'listening' });
    expect(conversation.muting).toEqual([true, false]);

    options.onModeChange({ mode: 'speaking' });
    expect(conversation.muting).toEqual([true, false, true]);
    options.onModeChange({ mode: 'listening' });
    expect(conversation.muting).toEqual([true, false, true, false]);

    session.hangUp();
    session.summon();
    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(false);
  });

  it('switch to half duplex after two interruptions nobody said anything in', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { options } = harness.sdk.latest;

    options.onModeChange({ mode: 'speaking' });
    await harness.clock.advance(2_000);
    options.onInterruption();
    options.onModeChange({ mode: 'listening' });
    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(false);

    options.onModeChange({ mode: 'speaking' });
    await harness.clock.advance(2_000);
    options.onInterruption();
    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(true);
  });

  it('stay full duplex while every interruption has the user’s words after it', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { options } = harness.sdk.latest;

    for (let turn = 0; turn < 3; turn++) {
      options.onModeChange({ mode: 'speaking' });
      await harness.clock.advance(2_000);
      options.onInterruption();
      options.onModeChange({ mode: 'listening' });
      options.onMessage({ role: 'user', message: 'Wait, not that one.' });
    }

    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(false);
    expect(harness.sdk.latest.conversation.muting).toEqual([]);
  });

  it('count nothing towards half duplex while the holder says the fallback may not judge them', async () => {
    let mayJudge = false;
    const harness = createHarness({ halfDuplexMayJudge: () => mayJudge });
    await harness.goLive();
    const { options } = harness.sdk.latest;

    // Cut off at once, twice, with nothing said: both shapes of the symptom, and neither counted.
    options.onModeChange({ mode: 'speaking' });
    options.onInterruption();
    options.onModeChange({ mode: 'listening' });
    options.onModeChange({ mode: 'speaking' });
    options.onInterruption();
    options.onModeChange({ mode: 'listening' });
    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(false);
    expect(harness.events.diagnostics.at(-1)?.interruptions).toBe(2);
    // What was queued is dropped all the same: that is not the fallback's business.
    expect(harness.element.plays).toBe(2);

    mayJudge = true;
    options.onModeChange({ mode: 'speaking' });
    options.onInterruption();
    expect(harness.events.diagnostics.at(-1)?.halfDuplex).toBe(true);
  });
});

describe('what the holder is told of the conversation, for a device watching for its own echo', () => {
  function createWatchedHarness() {
    const told: string[] = [];
    const watched = createHarness({
      events: {
        onInterruption: () => told.push('interruption'),
        onMessage: (message) => told.push(`${message.role}: ${message.message}`),
      },
    });
    return { told, watched };
  }

  it('hears of every interruption, after the session has dealt with it', async () => {
    const seenWhenTold: Array<{ flushed: number; halfDuplex: boolean | undefined }> = [];
    let latestHalfDuplex: boolean | undefined;
    const watched = createHarness({
      halfDuplexMayJudge: () => true,
      events: {
        onDiagnostics: (diagnostics) => {
          latestHalfDuplex = diagnostics.halfDuplex;
        },
        onInterruption: () => seenWhenTold.push({ flushed: watched.element.plays, halfDuplex: latestHalfDuplex }),
      },
    });
    await watched.goLive();
    const { options } = watched.sdk.latest;

    options.onModeChange({ mode: 'speaking' });
    options.onInterruption();

    // Dealt with first: the queued audio dropped, and the fallback judged and reported.
    expect(seenWhenTold).toEqual([{ flushed: 1, halfDuplex: true }]);
  });

  it('hears every line either side said, whatever the captions show', async () => {
    const { told, watched } = createWatchedHarness();
    await watched.goLive();
    const { options } = watched.sdk.latest;

    options.onMessage({ role: 'agent', message: 'Good evening, sir.' });
    options.onMessage({ role: 'user', message: 'Good evening.' });

    expect(told).toEqual(['agent: Good evening, sir.', 'user: Good evening.']);
  });

  it('hears nothing from a summoning that is over', async () => {
    const { told, watched } = createWatchedHarness();
    await watched.goLive();
    const { options } = watched.sdk.latest;

    watched.session.hangUp();
    options.onInterruption();
    options.onMessage({ role: 'user', message: 'Too late.' });

    expect(told).toEqual([]);
  });
});

describe('what the phone’s camera button needs of the conversation', () => {
  it('tells the agent things and says the user is still there only while connected', async () => {
    const harness = createHarness();
    harness.session.sendContextualUpdate('Too early.');
    harness.session.sendUserActivity();
    await harness.goLive();
    const { conversation } = harness.sdk.latest;

    harness.session.sendContextualUpdate('This device has a camera button.');
    harness.session.sendUserActivity();
    harness.sdk.latest.agentHangsUp();
    harness.session.sendContextualUpdate('Too late.');
    harness.session.sendUserActivity();

    expect(conversation.contextualUpdates).toEqual(['This device has a camera button.']);
    expect(conversation.userActivity).toBe(1);
  });

  it('names the conversation under way only while it is connected', async () => {
    const { session, greeting, tokens, clock, sdk } = createHarness();
    expect(session.liveConversationId()).toBeUndefined();

    session.summon();
    greeting.allow();
    tokens.grant();
    await settle();
    await clock.advance(greeting.durationMilliseconds + 100);
    // Dialled, and not yet connected: there is no conversation to name.
    expect(sdk.dials).toHaveLength(1);
    expect(session.liveConversationId()).toBeUndefined();

    await sdk.latest.connect();
    expect(session.liveConversationId()).toBe('conv_fake1');

    sdk.latest.agentHangsUp();
    expect(session.liveConversationId()).toBeUndefined();
  });

  it('stops naming a conversation the moment it is hung up on, while it is still ending', async () => {
    const harness = createHarness();
    await harness.goLive();
    harness.sdk.latest.conversation.holdEnding();

    harness.session.hangUp();

    expect(harness.session.liveConversationId()).toBeUndefined();
  });

  it('names the next summoning’s conversation, never the one before it', async () => {
    const harness = createHarness();
    await harness.goLive();
    expect(harness.session.liveConversationId()).toBe('conv_fake1');
    harness.session.hangUp();

    harness.session.summon();
    // Greeting, with nothing dialled yet: the last summoning's conversation is not this one's.
    expect(harness.session.liveConversationId()).toBeUndefined();
    harness.greeting.allow();
    harness.tokens.grant();
    await settle();
    await harness.clock.advance(harness.greeting.durationMilliseconds + 100);
    await harness.sdk.latest.connect();

    expect(harness.sdk.latest.conversation.id).toBe('conv_fake2');
    expect(harness.session.liveConversationId()).toBe('conv_fake2');
  });

  it('names a conversation held in writing as well as a spoken one', async () => {
    const { session, tokens, sdk } = createHarness();

    session.summon({ textOnly: true });
    tokens.sign();
    await settle();
    await sdk.latest.connect();

    expect(sdk.latest.written).toBeDefined();
    expect(session.liveConversationId()).toBe('conv_fake1');
  });

  it('gives no id where the SDK has none from ElevenLabs, only a room’s name or one of its own', async () => {
    for (const notAConversationId of ['room_1727700000000', 'jarvis-room']) {
      const { session, greeting, tokens, clock, sdk } = createHarness();
      session.summon();
      greeting.allow();
      tokens.grant();
      await settle();
      await clock.advance(greeting.durationMilliseconds + 100);
      sdk.latest.conversation.id = notAConversationId;

      await sdk.latest.connect();

      expect(session.phase).toBe('live');
      expect(session.liveConversationId()).toBeUndefined();
    }
  });
});

describe('writing to him', () => {
  it('shows nothing of a spoken exchange', async () => {
    const harness = createHarness();
    await harness.goLive();

    harness.sdk.latest.options.onMessage({ role: 'user', message: 'What is the weather?' });
    harness.sdk.latest.options.onMessage({ role: 'agent', message: 'Sunny, sir.' });

    expect(harness.events.captions).toEqual([]);
  });

  it('mutes the microphone while the keyboard is up, and gives it back when it goes', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { conversation } = harness.sdk.latest;

    harness.session.setTyping(true);
    expect(conversation.muting).toEqual([true]);
    harness.session.setTyping(false);
    expect(conversation.muting).toEqual([true, false]);
  });

  it('keeps the microphone muted for the greeting when the keyboard goes before he has finished', async () => {
    const { session, tokens, greeting, sdk } = createHarness({ waitsForGreetingBeforeDialling: false });

    session.summon();
    greeting.allow();
    tokens.grant();
    await settle();
    await sdk.latest.connect();
    session.setTyping(true);
    session.setTyping(false);

    expect(sdk.latest.conversation.muting).toEqual([true]);
  });

  it('sends a typed line into the live session and shows his answer to it', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { options, conversation } = harness.sdk.latest;

    harness.session.setTyping(true);
    harness.session.sendText('  Turn on the lights  ');
    harness.session.setTyping(false);
    expect(conversation.sent).toEqual(['Turn on the lights']);

    // Echoed back as a transcript, the typed line is not him being spoken to.
    options.onMessage({ role: 'user', message: 'Turn on the lights.' });
    options.onMessage({ role: 'agent', message: 'Done, sir.' });
    expect(harness.events.captions).toEqual(['Done, sir.']);

    harness.session.sendText('And the heating');
    expect(harness.events.captions).toEqual(['Done, sir.', undefined]);
  });

  it('goes back to showing nothing once the user speaks again', async () => {
    const harness = createHarness();
    await harness.goLive();
    const { options } = harness.sdk.latest;

    harness.session.sendText('Turn on the lights');
    options.onMessage({ role: 'agent', message: 'Done, sir.' });
    options.onMessage({ role: 'user', message: 'Thanks, and what time is it?' });
    options.onMessage({ role: 'agent', message: 'Half past four.' });

    expect(harness.events.captions).toEqual(['Done, sir.', undefined]);
  });

  it('takes typed lines only while the conversation is live', () => {
    const { session, sdk } = createHarness();

    session.sendText('Hello?');
    session.summon();
    session.sendText('Hello?');

    expect(sdk.dials).toHaveLength(0);
  });

  it('clears his line when the conversation ends', async () => {
    const harness = createHarness();
    await harness.goLive();
    harness.session.sendText('Turn on the lights');
    harness.sdk.latest.options.onMessage({ role: 'agent', message: 'Done, sir.' });

    harness.sdk.latest.agentHangsUp();

    expect(harness.events.captions).toEqual(['Done, sir.', undefined]);
  });
});

describe('knowing when he has gone quiet', () => {
  it('counts from the moment he stops speaking, and never while he speaks or greets', async () => {
    const { session, tokens, greeting, sdk, clock } = createHarness();
    expect(session.quietFor(2)).toBe(true);

    session.summon();
    greeting.allow();
    tokens.grant();
    await settle();
    await clock.advance(500);
    expect(session.quietFor(0)).toBe(false);

    await clock.advance(greeting.durationMilliseconds);
    await sdk.latest.connect();
    sdk.latest.options.onModeChange({ mode: 'speaking' });
    await clock.advance(5_000);
    expect(session.quietFor(0)).toBe(false);

    sdk.latest.options.onModeChange({ mode: 'listening' });
    sdk.latest.agentHangsUp();
    await clock.advance(1_999);
    expect(session.quietFor(2)).toBe(false);
    await clock.advance(1);
    expect(session.quietFor(2)).toBe(true);
  });
});
