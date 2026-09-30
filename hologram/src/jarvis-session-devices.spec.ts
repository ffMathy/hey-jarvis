import { describe, expect, it } from 'bun:test';
import { MARK_AFFECTED_TOOL, MARKED_RESULT } from './affected-entities';
import { GIVE_UP_CONNECTING_AFTER_MS } from './conversation-life';
import { PHONE_PARTICIPANT_NAME, WATCH_PARTICIPANT_NAME } from './conversation-token';
import { DEADLINE_PROBLEM, DROPPED_PROBLEM, OFFLINE_PROBLEM } from './failure-text';
import { createFakeCallAudio, createHarness, settle } from './jarvis-session.fakes';
import type { JarvisSessionDependencies, SessionDiagnostics } from './session-contract';

/**
 * The same session, set up as the phone and the watch set it up: the greeting played inside the
 * call's audio, the session dialled after him, his lines written down only in text mode, no
 * half-duplex fallback and the SDK's own connection delay — and, in a browser, the greeting
 * dialled behind and the conversation held in writing when there is no microphone. What the
 * headset's own specs cover is not repeated here; this is what the other two devices add, and the
 * three things the SDK's React provider used to get wrong on them.
 */

/** A phone or a watch: call audio, and a greeting that waits for a headset's call link. */
function onAPhone(overrides: Partial<JarvisSessionDependencies<number>> = {}, { startsAtOnce = true } = {}) {
  const callAudio = createFakeCallAudio({ startsAtOnce });
  const harness = createHarness(
    {
      participantName: PHONE_PARTICIPANT_NAME,
      connectionDelay: undefined,
      halfDuplex: false,
      offlineProblem: undefined,
      captions: 'while-typing',
      callAudio: callAudio.callAudio,
      removeOrphanedAudio: undefined,
      ...overrides,
    },
    { waitsForRoute: true },
  );
  return Object.assign(harness, { callAudio });
}

type Phone = ReturnType<typeof onAPhone>;

/** The phone's web build: no call audio, and the session dialled behind the greeting. */
function inABrowser(overrides: Partial<JarvisSessionDependencies<number>> = {}) {
  return createHarness({
    participantName: PHONE_PARTICIPANT_NAME,
    connectionDelay: undefined,
    halfDuplex: false,
    offlineProblem: undefined,
    captions: 'while-typing',
    waitsForGreetingBeforeDialling: false,
    removeOrphanedAudio: undefined,
    ...overrides,
  });
}

/** Summoned on a phone, and greeting: the call audio up, the headset's link up, the recording playing. */
async function greetOn(phone: Phone) {
  phone.session.summon();
  await settle();
  phone.greeting.routeReady();
  await settle();
  phone.greeting.allow();
  await settle();
}

/** Greeted, dialled once he has finished, and connected. */
async function goLiveOn(phone: Phone) {
  await greetOn(phone);
  phone.tokens.grant();
  await settle();
  await phone.clock.advance(phone.greeting.durationMilliseconds + 100);
  await phone.sdk.latest.connect();
}

describe('greeting inside the call’s audio, on a phone and a watch', () => {
  it('switches into call audio first, and plays only once a headset’s link is up', async () => {
    const phone = onAPhone();

    phone.session.summon();
    expect(phone.callAudio.log).toEqual(['start']);
    expect(phone.greeting.log).toEqual([]);
    // The token is asked for beside him, as on every device that needs no network brought up.
    expect(phone.tokens.requests).toHaveLength(1);
    expect(phone.tokens.requests[0]?.url.searchParams.get('participant_name')).toBe(PHONE_PARTICIPANT_NAME);

    await settle();
    expect(phone.greeting.log).toEqual(['wait-for-route']);

    phone.greeting.routeReady();
    await settle();
    expect(phone.greeting.log).toEqual(['wait-for-route', 'play']);
  });

  it('follows silence while the call audio comes up, and the recording once it is asked for', async () => {
    const phone = onAPhone({}, { startsAtOnce: false });

    phone.session.summon();
    expect(phone.session.snapshot.greeting).toBe(false);
    expect(phone.session.snapshot.voice.listening).toBe(false);

    phone.callAudio.finishStarting();
    await settle();
    expect(phone.session.snapshot.greeting).toBe(true);
    expect(phone.session.snapshot.voice.listening).toBe(true);
    expect(phone.session.snapshot.voice.speaking).toBe(true);
  });

  it('does not give up on him while a headset’s link comes up: the wait was not him being late', async () => {
    const phone = onAPhone();

    phone.session.summon();
    await settle();
    await phone.clock.advance(3_000);
    phone.greeting.routeReady();
    await settle();
    phone.greeting.allow();
    await phone.clock.advance(1_000);

    expect(phone.session.phase).toBe('greeting');
    expect(phone.greeting.stops).toBe(0);
  });

  it('gives up on a headset’s link that never comes up, and does not play late', async () => {
    const phone = onAPhone();

    phone.session.summon();
    await settle();
    await phone.clock.advance(3_600);
    expect(phone.session.phase).toBe('connecting');

    phone.greeting.routeReady();
    await settle();
    expect(phone.greeting.plays).toBe(0);
  });

  it('dials only once he has finished, and without asking the agent to greet again', async () => {
    const phone = onAPhone();

    await greetOn(phone);
    phone.tokens.grant();
    await settle();
    expect(phone.sdk.dials).toHaveLength(0);

    await phone.clock.advance(phone.greeting.durationMilliseconds + 100);
    expect(phone.sdk.dials).toHaveLength(1);
    expect(phone.sdk.latest.spoken?.overrides).toEqual({ agent: { firstMessage: '' } });
    // The SDK's own delay: the phone never set one, and three seconds of it is for its audio mode.
    expect(phone.sdk.latest.spoken && 'connectionDelay' in phone.sdk.latest.spoken).toBe(false);
  });

  it('never greets when hung up on while the call audio comes up, and lets it go', async () => {
    const phone = onAPhone({}, { startsAtOnce: false });

    phone.session.summon();
    phone.session.hangUp();
    expect(phone.session.phase).toBe('ended');
    expect(phone.callAudio.log).toEqual(['start', 'stop']);

    phone.callAudio.finishStarting();
    await settle();
    expect(phone.greeting.log).toEqual([]);
  });

  it('lets the call audio go when the greeting is refused, before anything is dialled, and only once', async () => {
    const phone = onAPhone();

    phone.session.summon();
    await settle();
    phone.greeting.routeReady();
    await settle();
    phone.greeting.refuse();
    await settle();
    expect(phone.callAudio.log).toEqual(['start', 'stop']);

    phone.tokens.grant();
    await settle();
    expect(phone.sdk.latest.spoken?.overrides).toBeUndefined();
    await phone.sdk.latest.connect();
    phone.sdk.latest.agentHangsUp();
    await settle();
    expect(phone.callAudio.log).toEqual(['start', 'stop']);
  });

  it('lets the call audio go at once when the token is refused mid-greeting', async () => {
    const phone = onAPhone();

    await greetOn(phone);
    phone.tokens.refuse(401);
    await settle();

    expect(phone.callAudio.log).toEqual(['start', 'stop']);
    expect(phone.greeting.stops).toBe(1);
    expect(phone.events.sources).toEqual(['reaching']);
  });

  it('lets the call audio go only once the conversation has finished ending', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    const { conversation } = phone.sdk.latest;
    conversation.holdEnding();

    phone.session.hangUp();
    await settle();
    expect(phone.session.phase).toBe('ended');
    expect(phone.callAudio.log).toEqual(['start']);

    conversation.finishEnding();
    await settle();
    expect(phone.callAudio.log).toEqual(['start', 'stop']);
  });

  it('lets it go when the agent hangs up', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);

    phone.sdk.latest.agentHangsUp();
    await settle();

    expect(phone.callAudio.log).toEqual(['start', 'stop']);
  });

  it('hung up while dialling, lets it go once the start has come to something', async () => {
    const connecting = onAPhone();
    await greetOn(connecting);
    connecting.tokens.grant();
    await connecting.clock.advance(connecting.greeting.durationMilliseconds + 100);
    connecting.session.hangUp();
    expect(connecting.callAudio.log).toEqual(['start']);
    await connecting.sdk.latest.connect();
    expect(connecting.sdk.latest.conversation.endSessions).toBe(1);
    expect(connecting.callAudio.log).toEqual(['start', 'stop']);

    const refused = onAPhone();
    await greetOn(refused);
    refused.tokens.grant();
    await refused.clock.advance(refused.greeting.durationMilliseconds + 100);
    refused.session.hangUp();
    await refused.sdk.latest.reject(new Error('could not establish signal connection'));
    expect(refused.callAudio.log).toEqual(['start', 'stop']);
    expect(refused.events.problems).toEqual([]);
  });
});

describe('what the SDK’s React provider used to get wrong on the phone and the watch', () => {
  it('keeps him there, following his voice, through an error once the conversation is open', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);

    phone.sdk.latest.options.onError('Server error: something non-fatal');

    expect(phone.session.phase).toBe('live');
    expect(phone.session.snapshot.status).toBe('connected');
    expect(phone.session.snapshot.voice.listening).toBe(true);
    expect(phone.events.problems).toEqual([]);
  });

  it('ends a conversation that connects after the deadline gave up on it, and lets its call audio go', async () => {
    const phone = onAPhone();
    await greetOn(phone);
    phone.tokens.grant();
    await phone.clock.advance(phone.greeting.durationMilliseconds + 100);
    expect(phone.sdk.dials).toHaveLength(1);

    await phone.clock.advance(GIVE_UP_CONNECTING_AFTER_MS);
    expect(phone.session.phase).toBe('failed');
    expect(phone.events.problems).toEqual([DEADLINE_PROBLEM]);
    expect(phone.events.sources).toEqual(['deadline']);

    await phone.sdk.latest.connect();
    expect(phone.sdk.latest.conversation.endSessions).toBe(1);
    expect(phone.session.snapshot.status).toBe('disconnected');
    expect(phone.callAudio.log).toEqual(['start', 'stop']);
  });

  it('says a dropped room, and a missing network, in words rather than in LiveKit’s or the platform’s', async () => {
    const dropped = onAPhone();
    await goLiveOn(dropped);
    dropped.sdk.latest.drop('LiveKit connection state changed to disconnected');
    expect(dropped.events.problems).toEqual([DROPPED_PROBLEM]);
    expect(dropped.events.sources).toEqual(['session']);

    const offline = onAPhone();
    offline.session.summon();
    offline.tokens.goOffline();
    await settle();
    expect(offline.events.problems).toEqual([OFFLINE_PROBLEM]);
    expect(offline.events.sources).toEqual(['reaching']);
  });

  it('says where each failure came from, so a phone can say the session’s louder', async () => {
    const rejected = onAPhone();
    await greetOn(rejected);
    rejected.tokens.grant();
    await rejected.clock.advance(rejected.greeting.durationMilliseconds + 100);
    await rejected.sdk.latest.reject(new Error('Quota exceeded'));
    expect(rejected.events.problems).toEqual(['Quota exceeded']);
    expect(rejected.events.sources).toEqual(['session']);

    const erred = onAPhone();
    await greetOn(erred);
    erred.tokens.grant();
    await erred.clock.advance(erred.greeting.durationMilliseconds + 100);
    erred.sdk.latest.options.onError('Failed to set up the session');
    expect(erred.events.sources).toEqual(['session']);

    const closed = onAPhone();
    await goLiveOn(closed);
    closed.sdk.latest.drop('Quota exceeded');
    expect(closed.events.problems).toEqual(['Quota exceeded']);
    expect(closed.events.sources).toEqual(['session']);
  });
});

describe('a phone’s text mode', () => {
  it('mutes the microphone while held in writing, and writes his lines without miming them', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    const { options, conversation } = phone.sdk.latest;

    phone.session.setTyping(true);
    expect(conversation.muting).toEqual([true]);
    expect(phone.session.snapshot.typing).toBe(true);

    options.onMessage({ role: 'agent', message: 'Done, sir.' });
    expect(phone.session.snapshot.writtenReply).toEqual({ shown: 'Done, sir.', readingUntil: 0 });

    phone.session.setTyping(false);
    expect(conversation.muting).toEqual([true, false]);
    expect(phone.session.snapshot.writtenReply.shown).toBeUndefined();
  });

  it('writes nothing down while the conversation is spoken', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);

    phone.sdk.latest.options.onMessage({ role: 'agent', message: 'Sunny, sir.' });

    expect(phone.session.snapshot.writtenReply.shown).toBeUndefined();
  });

  it('switched into writing while he greets, takes effect once the conversation is up', async () => {
    const phone = onAPhone();
    await greetOn(phone);
    phone.session.setTyping(true);
    phone.tokens.grant();
    await settle();
    await phone.clock.advance(phone.greeting.durationMilliseconds + 100);

    await phone.sdk.latest.connect();

    expect(phone.sdk.latest.conversation.muting).toEqual([true]);
  });

  it('clears his answer when a line is sent, and sends it into the voice session', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    phone.session.setTyping(true);
    phone.sdk.latest.options.onMessage({ role: 'agent', message: 'Done, sir.' });

    phone.session.sendText('And the heating');

    expect(phone.sdk.latest.conversation.sent).toEqual(['And the heating']);
    expect(phone.session.snapshot.writtenReply.shown).toBeUndefined();
  });

  it('leaves his last line for the screen while he goes, and starts the next summoning in voice', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    phone.session.setTyping(true);
    phone.sdk.latest.options.onMessage({ role: 'agent', message: 'Goodbye, sir.' });

    phone.sdk.latest.agentHangsUp();
    expect(phone.session.snapshot.writtenReply.shown).toBe('Goodbye, sir.');

    phone.session.summon();
    expect(phone.session.snapshot.typing).toBe(false);
    expect(phone.session.snapshot.writtenReply.shown).toBeUndefined();
  });
});

describe('in a browser', () => {
  it('lets go of what it held for the greeting once the greeting has started, been refused or been left', async () => {
    const started = inABrowser();
    let releasedWhenStarted = 0;
    started.session.summon({ onGreetingAnswered: () => releasedWhenStarted++ });
    expect(releasedWhenStarted).toBe(0);
    started.greeting.allow();
    await settle();
    expect(releasedWhenStarted).toBe(1);

    const refused = inABrowser();
    let releasedWhenRefused = 0;
    refused.session.summon({ onGreetingAnswered: () => releasedWhenRefused++ });
    refused.greeting.refuse();
    await settle();
    expect(releasedWhenRefused).toBe(1);

    const left = inABrowser();
    let releasedWhenLeft = 0;
    left.session.summon({ onGreetingAnswered: () => releasedWhenLeft++ });
    left.session.hangUp();
    left.greeting.allow();
    await settle();
    expect(releasedWhenLeft).toBe(1);
  });

  it('dials behind the greeting, and takes a typed line once the conversation is up', async () => {
    const browser = inABrowser();
    browser.session.summon();
    browser.greeting.allow();
    browser.tokens.grant();
    await settle();
    await browser.sdk.latest.connect();
    expect(browser.session.phase).toBe('greeting');

    browser.session.sendText('Hello?');

    expect(browser.sdk.latest.conversation.sent).toEqual(['Hello?']);
  });

  it('holds a conversation in writing over a signed URL, with no greeting and no token', async () => {
    const browser = inABrowser();
    let released = 0;

    browser.session.summon({ textOnly: true, onGreetingAnswered: () => released++ });
    expect(released).toBe(1);
    expect(browser.session.phase).toBe('connecting');
    expect(browser.greeting.plays).toBe(0);
    expect(browser.tokens.requests).toHaveLength(1);
    expect(browser.tokens.requests[0]?.url.pathname).toBe('/v1/convai/conversation/get-signed-url');

    browser.tokens.sign();
    await settle();
    const { written } = browser.sdk.latest;
    expect(written?.connectionType).toBe('websocket');
    expect(written?.textOnly).toBe(true);
    expect(written?.signedUrl).toStartWith('wss://');
    // He greets in writing there: the agent keeps its own first message.
    expect(written && 'overrides' in written).toBe(false);

    await browser.sdk.latest.connect();
    expect(browser.session.phase).toBe('live');
  });

  it('writes down every line he writes there, mimed, and clears it the moment a line is sent', async () => {
    const browser = inABrowser();
    browser.session.summon({ textOnly: true });
    browser.tokens.sign();
    await settle();
    await browser.sdk.latest.connect();

    browser.sdk.latest.options.onMessage({ role: 'agent', message: 'Good evening.' });
    const reply = browser.session.snapshot.writtenReply;
    expect(reply.shown).toBe('Good evening.');
    expect(reply.readingUntil).toBeGreaterThan(browser.clock.now());

    browser.session.sendText('Are the lights on?');
    expect(browser.sdk.latest.conversation.sent).toEqual(['Are the lights on?']);
    expect(browser.session.snapshot.writtenReply.shown).toBeUndefined();
  });

  it('says why a signed URL could not be had', async () => {
    const browser = inABrowser();
    browser.session.summon({ textOnly: true });
    browser.tokens.refuse(401, { detail: { status: 'invalid_api_key' } });
    await settle();

    expect(browser.events.problems).toEqual(['ElevenLabs rejected the API key. Check it in the settings.']);
    expect(browser.events.sources).toEqual(['reaching']);
    expect(browser.session.phase).toBe('failed');
  });
});

describe('on a watch, which has to get off its phone’s Bluetooth first', () => {
  function onAWatch(deadlineProblem?: () => string) {
    const networks: Array<() => void> = [];
    /** How many times the network has been let go of. */
    const left = { times: 0 };
    const watch = onAPhone({
      participantName: WATCH_PARTICIPANT_NAME,
      untilOnline: () =>
        new Promise<void>((online) => {
          networks.push(online);
        }),
      leaveNetwork: () => {
        left.times++;
      },
      ...(deadlineProblem ? { deadlineProblem } : {}),
    });
    return Object.assign(watch, {
      networks,
      left,
      online() {
        const online = networks.at(-1);
        if (!online) {
          throw new Error('No network has been asked for.');
        }
        online();
      },
    });
  }

  it('brings the network up once he has started greeting, and asks for the token only once it is up', async () => {
    const watch = onAWatch();

    watch.session.summon();
    await settle();
    watch.greeting.routeReady();
    await settle();
    expect(watch.networks).toHaveLength(0);

    watch.greeting.allow();
    await settle();
    expect(watch.networks).toHaveLength(1);
    expect(watch.tokens.requests).toHaveLength(0);

    watch.online();
    await settle();
    expect(watch.tokens.requests).toHaveLength(1);
    expect(watch.tokens.requests[0]?.url.searchParams.get('participant_name')).toBe(WATCH_PARTICIPANT_NAME);
  });

  it('starts its deadline only once the network is up, and says what the watch says, then', async () => {
    let problem = 'Jarvis could not be reached. Put the watch on Wi-Fi.';
    const watch = onAWatch(() => problem);
    await greetOn(watch);
    await watch.clock.advance(5_000);
    watch.online();
    await settle();

    problem = 'Jarvis did not answer. ElevenLabs may be unreachable.';
    await watch.clock.advance(GIVE_UP_CONNECTING_AFTER_MS - 1);
    expect(watch.session.phase).not.toBe('failed');
    await watch.clock.advance(1);

    expect(watch.session.phase).toBe('failed');
    expect(watch.events.problems).toEqual(['Jarvis did not answer. ElevenLabs may be unreachable.']);
  });

  it('brings the network up after a refused greeting too', async () => {
    const watch = onAWatch();

    watch.session.summon();
    await settle();
    watch.greeting.routeReady();
    await settle();
    watch.greeting.refuse();
    await settle();

    expect(watch.networks).toHaveLength(1);
  });

  it('lets the network go once the conversation is over, and only once', async () => {
    const watch = onAWatch();
    await greetOn(watch);
    watch.online();
    await settle();
    watch.tokens.grant();
    await settle();
    await watch.clock.advance(watch.greeting.durationMilliseconds + 100);
    await watch.sdk.latest.connect();
    expect(watch.left.times).toBe(0);

    watch.sdk.latest.agentHangsUp();
    watch.session.hangUp();

    expect(watch.left.times).toBe(1);
  });

  it('lets the network go when the token is refused', async () => {
    const watch = onAWatch();
    await greetOn(watch);
    watch.online();
    await settle();

    watch.tokens.refuse(429);
    await settle();

    expect(watch.left.times).toBe(1);
    expect(watch.session.phase).toBe('failed');
  });

  it('lets go of a network that only came up after the wrist had dropped', async () => {
    const watch = onAWatch();
    await greetOn(watch);
    watch.session.endQuietly();
    expect(watch.left.times).toBe(0);

    watch.online();
    await settle();

    expect(watch.left.times).toBe(1);
    expect(watch.tokens.requests).toHaveLength(0);
  });

  it('never asks for a network when the wrist drops before he has greeted', async () => {
    const watch = onAWatch();

    watch.session.summon();
    await settle();
    watch.session.endQuietly();
    watch.greeting.routeReady();
    await settle();

    expect(watch.networks).toHaveLength(0);
    expect(watch.tokens.requests).toHaveLength(0);
  });
});

describe('what a screen draws from', () => {
  it('tells its listeners about every change, and keeps the same snapshot while nothing moves', async () => {
    const phone = onAPhone();
    let told = 0;
    phone.session.subscribe(() => told++);
    const before = phone.session.snapshot;

    phone.session.setTyping(false);
    expect(told).toBe(0);
    expect(phone.session.snapshot).toBe(before);

    phone.session.summon();
    expect(told).toBeGreaterThan(0);
    expect(phone.session.snapshot).not.toBe(before);
    expect(phone.session.snapshot.phase).toBe('greeting');
  });

  it('hands over his voice with its flags as they are now, and readers that last as long as their source', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    const { options, conversation } = phone.sdk.latest;
    const listening = phone.session.snapshot.voice;
    expect(listening.listening).toBe(true);
    expect(listening.speaking).toBe(false);
    expect(listening.getVolume()).toBe(conversation.outputVolume);

    options.onModeChange({ mode: 'speaking' });
    const speaking = phone.session.snapshot.voice;
    expect(speaking.speaking).toBe(true);
    expect(speaking.getVolume).toBe(listening.getVolume);
    expect(speaking.getSpectrum).toBe(listening.getSpectrum);

    phone.playAgentVoice({ getVolume: () => 0.42, getSpectrum: () => new Uint8Array(4) });
    const fromTheTrack = phone.session.snapshot.voice;
    expect(fromTheTrack.getVolume).not.toBe(listening.getVolume);
    expect(fromTheTrack.getVolume()).toBe(0.42);
  });

  it('says whether the summoning has dialled, and reads nothing dialled once it is over', async () => {
    const phone = onAPhone();
    await greetOn(phone);
    phone.tokens.grant();
    await settle();
    expect(phone.session.snapshot.dialled).toBe(false);

    await phone.clock.advance(phone.greeting.durationMilliseconds + 100);
    expect(phone.session.snapshot.dialled).toBe(true);

    await phone.sdk.latest.connect();
    phone.session.hangUp();
    expect(phone.session.snapshot.dialled).toBe(false);
  });

  it('reads the status as disconnected once a summoning is over, whatever its SDK said last', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    phone.sdk.latest.conversation.holdEnding();
    expect(phone.session.snapshot.status).toBe('connected');

    phone.session.hangUp();

    expect(phone.session.snapshot.status).toBe('disconnected');
    expect(phone.session.snapshot.mode).toBe('listening');
  });

  it('says whether he is thinking', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);

    phone.sdk.latest.options.onAgentToolRequest({ tool_call_id: 'weather' });

    expect(phone.session.snapshot.thinking).toBe(true);
  });

  it('stops telling a listener that has let go', () => {
    const phone = onAPhone();
    let told = 0;
    const stop = phone.session.subscribe(() => told++);
    stop();

    phone.session.summon();

    expect(told).toBe(0);
  });
});

describe('the half-duplex fallback, which only the headset asks for', () => {
  it('never takes the microphone on a device that has not asked for it', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);
    const { options, conversation } = phone.sdk.latest;

    options.onModeChange({ mode: 'speaking' });
    await phone.clock.advance(100);
    options.onInterruption();
    options.onInterruption();

    expect(conversation.muting).toEqual([]);
    expect(phone.events.diagnostics.at(-1)?.halfDuplex).toBe(false);
  });
});

describe('what he is working on, which only the headset shows', () => {
  /** The events `useJarvisSession` hands the session on a phone and a watch, and a diagnostics log. */
  function phoneEvents() {
    const problems: string[] = [];
    const diagnostics: SessionDiagnostics[] = [];
    return {
      problems,
      diagnostics,
      events: {
        onProblem: (message: string) => problems.push(message),
        onDiagnostics: (reported: SessionDiagnostics) => diagnostics.push(reported),
      },
    };
  }

  it('is answered on a phone without an error, and without anything on its screen moving', async () => {
    const told = phoneEvents();
    const phone = onAPhone({ events: told.events });
    await goLiveOn(phone);
    let changes = 0;
    phone.session.subscribe(() => changes++);
    const before = phone.session.snapshot;

    const answer = await phone.sdk.latest.callClientTool(MARK_AFFECTED_TOOL, {
      entities: [{ id: 'light.hall', name: 'Hall' }],
    });

    expect(answer).toEqual({ result: MARKED_RESULT, isError: false });
    expect(changes).toBe(0);
    expect(phone.session.snapshot).toBe(before);
    expect(phone.session.phase).toBe('live');
    expect(told.problems).toEqual([]);
    expect(told.diagnostics.at(-1)?.lastError).toBeUndefined();
  });

  it('is answered in a browser, spoken or held in writing', async () => {
    const spoken = inABrowser({ events: phoneEvents().events });
    spoken.session.summon();
    spoken.greeting.allow();
    spoken.tokens.grant();
    await settle();
    await spoken.sdk.latest.connect();
    const spokenAnswer = await spoken.sdk.latest.callClientTool(MARK_AFFECTED_TOOL, {
      entities: [{ id: 'inbox:work' }],
    });

    const told = phoneEvents();
    const written = inABrowser({ events: told.events });
    written.session.summon({ textOnly: true });
    written.tokens.sign();
    await settle();
    await written.sdk.latest.connect();
    const writtenAnswer = await written.sdk.latest.callClientTool(MARK_AFFECTED_TOOL, {
      entities: [{ id: 'calendar/primary' }],
    });

    expect(spokenAnswer).toEqual({ result: MARKED_RESULT, isError: false });
    expect(written.sdk.latest.written?.textOnly).toBe(true);
    expect(writtenAnswer).toEqual({ result: MARKED_RESULT, isError: false });
    expect(told.diagnostics.at(-1)?.lastError).toBeUndefined();
  });

  it('tells a phone’s agent nothing about the device, which has nothing of its own to say', async () => {
    const phone = onAPhone();
    await goLiveOn(phone);

    expect(phone.sdk.latest.conversation.contextualUpdates).toEqual([]);
  });
});
