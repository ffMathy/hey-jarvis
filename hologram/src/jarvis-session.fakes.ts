import type { AgentTrackRoom } from './agent-audio-track';
import { HEADSET_PARTICIPANT_NAME } from './conversation-token';
import { createJarvisSession } from './jarvis-session';
import type {
  CallAudio,
  GreetingPlayer,
  JarvisSessionDependencies,
  ProblemSource,
  SessionConversation,
  SessionDiagnostics,
  SessionOptions,
  SessionPhase,
  StartSession,
  TextSessionOptions,
  VoiceSessionOptions,
} from './session-contract';
import type { JarvisVoiceReaders } from './voice-contract';

/**
 * Stand-ins for everything a {@link createJarvisSession} is made from, for its specs: a clock whose
 * timers run only when told to, a token endpoint that answers when told to, a greeting whose
 * recording plays on that clock, the call's audio a phone switches into, and an SDK whose sessions
 * connect, fail, drop and take their time to end when told to — each firing its callbacks in the
 * order the real `@elevenlabs/client` 1.24.0 does (read from `VoiceConversation.startSession` and
 * `BaseConversation.endSessionWithDetails`).
 *
 * Not a spec itself, so `bun test` loads it only through the specs that use it.
 */

/** Lets every promise already settled run its reactions, and any response body finish reading. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** A clock and a timer queue that only move when a test moves them. */
export function createFakeClock() {
  let time = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  const nextDue = (until: number) => {
    let due: [number, { at: number; callback: () => void }] | undefined;
    for (const entry of timers) {
      if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) {
        due = entry;
      }
    }
    return due;
  };

  return {
    now: () => time,
    setTimeout: (callback: () => void, milliseconds: number) => {
      const handle = nextHandle++;
      timers.set(handle, { at: time + milliseconds, callback });
      return handle;
    },
    clearTimeout: (handle: number) => {
      timers.delete(handle);
    },
    /** Moves time on, running every timer that falls due on the way, in order. */
    async advance(milliseconds: number) {
      const until = time + milliseconds;
      for (let due = nextDue(until); due; due = nextDue(until)) {
        const [handle, timer] = due;
        timers.delete(handle);
        time = Math.max(time, timer.at);
        timer.callback();
        await settle();
      }
      time = until;
      await settle();
    },
    /** Moves time on without running a single timer: a browser throttling a page's timers. */
    jump(milliseconds: number) {
      time += milliseconds;
    },
  };
}

export type FakeClock = ReturnType<typeof createFakeClock>;

/** The token endpoint, answering each request only when the test says how. */
export function createFakeTokenEndpoint() {
  const requests: Array<{ url: URL; headers: Headers; answer: Deferred<Response> }> = [];
  const fetchToken = async (input: string | URL | Request, init?: RequestInit) => {
    const answer = deferred<Response>();
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers), answer });
    return answer.promise;
  };
  const latest = () => {
    const request = requests.at(-1);
    if (!request) {
      throw new Error('No token has been asked for.');
    }
    return request;
  };

  return {
    // `preconnect` because Bun's `fetch` has one, and the session takes Bun's type under test.
    fetch: Object.assign(fetchToken, { preconnect: () => undefined }),
    requests,
    grant(token = 'a-webrtc-token') {
      latest().answer.resolve(
        new Response(JSON.stringify({ token, conversation_id: 'conv_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    /** Answers a request for a signed URL, which is what a conversation held in writing asks for. */
    sign(signedUrl = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=x&conversation_signature=y') {
      latest().answer.resolve(
        new Response(JSON.stringify({ signed_url: signedUrl }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    refuse(status: number, body: unknown = {}) {
      latest().answer.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      );
    },
    /** What a browser does when no server answered at all. */
    goOffline() {
      latest().answer.reject(new TypeError('Failed to fetch'));
    },
  };
}

/**
 * The recording, played on the fake clock: two seconds long, heard from when the browser allows it.
 * With `waitsForRoute`, it first waits for a headset's call link as a phone's player does, until
 * the test says the route is ready.
 */
export function createFakeGreeting(clock: FakeClock, { waitsForRoute = false }: { waitsForRoute?: boolean } = {}) {
  const DURATION = 2;
  const answers: Array<Deferred<boolean>> = [];
  const routeWaits: Array<Deferred<void>> = [];
  const log: string[] = [];
  let startedAt: number | undefined;
  let stops = 0;

  const player: GreetingPlayer = {
    ...(waitsForRoute
      ? {
          untilAudible: () => {
            const wait = deferred<void>();
            routeWaits.push(wait);
            log.push('wait-for-route');
            return wait.promise;
          },
        }
      : {}),
    playFromStart: () => {
      log.push('play');
      const answer = deferred<boolean>();
      answers.push(answer);
      return answer.promise;
    },
    stop: () => {
      stops++;
      startedAt = undefined;
    },
    position: () => {
      if (startedAt === undefined) {
        return -1;
      }
      const seconds = (clock.now() - startedAt) / 1000;
      return seconds < DURATION ? seconds : -1;
    },
    duration: DURATION,
  };

  const latest = () => {
    const answer = answers.at(-1);
    if (!answer) {
      throw new Error('The greeting has not been asked to play.');
    }
    return answer;
  };

  return {
    player,
    /** What was asked of the player, in order. */
    log,
    durationMilliseconds: DURATION * 1000,
    get plays() {
      return answers.length;
    },
    /** The headset's call link is up: a player waiting for it goes on to play. */
    routeReady() {
      const wait = routeWaits.at(-1);
      if (!wait) {
        throw new Error('Nothing is waiting for the route.');
      }
      wait.resolve();
    },
    get stops() {
      return stops;
    },
    get playing() {
      return player.position() >= 0;
    },
    /** The browser lets it play: heard from now. */
    allow() {
      startedAt = clock.now();
      latest().resolve(true);
    },
    /** The browser refuses it, as autoplay without a gesture can be. */
    refuse() {
      latest().resolve(false);
    },
  };
}

/**
 * The call's audio on a phone or a watch, recording when it is switched into and let go of. A
 * start finishes only when the test says so, unless `startsAtOnce`.
 */
export function createFakeCallAudio({ startsAtOnce = true }: { startsAtOnce?: boolean } = {}) {
  const log: string[] = [];
  const starts: Array<Deferred<void>> = [];
  const callAudio: CallAudio = {
    start: () => {
      log.push('start');
      const started = deferred<void>();
      starts.push(started);
      if (startsAtOnce) {
        started.resolve();
      }
      return started.promise;
    },
    stop: async () => {
      log.push('stop');
    },
  };
  return {
    callAudio,
    log,
    /** The switch into call audio has finished. */
    finishStarting() {
      const started = starts.at(-1);
      if (!started) {
        throw new Error('Call audio has not been asked for.');
      }
      started.resolve();
    },
  };
}

/** A conversation the SDK hands over, recording what the session does with it. */
export interface FakeConversation extends SessionConversation {
  muting: boolean[];
  sent: string[];
  endSessions: number;
  inputVolume: number;
  outputVolume: number;
  /**
   * Makes the next ending take as long as the test says, as the real SDK's does while it takes its
   * audio down: `disconnecting` at once, and `disconnected` only on `finishEnding`.
   */
  holdEnding(): void;
  finishEnding(): void;
}

/** One `startSession` call, driven by the test in the order the real SDK fires its callbacks. */
export interface FakeDial {
  options: SessionOptions;
  /** The options, if this dial was for a spoken conversation over WebRTC. */
  spoken: VoiceSessionOptions | undefined;
  /** The options, if this dial was for a conversation held in writing over a socket. */
  written: TextSessionOptions | undefined;
  conversation: FakeConversation;
  /** `onConversationCreated`, `connected`, then the start resolves. */
  connect(): Promise<void>;
  /** A start that fails before any conversation exists: `disconnected`, then the rejection. */
  reject(error: unknown): Promise<void>;
  /** The room closes under an open conversation. */
  drop(message: string): void;
  /** The agent calls `end_call`. */
  agentHangsUp(): void;
}

function createFakeDial(options: SessionOptions): { dial: FakeDial; promise: Promise<SessionConversation> } {
  const started = deferred<SessionConversation>();
  let status = 'connecting';
  let slowEnding = false;
  let ending: Deferred<void> | undefined;

  const finishWith = (details: { reason: string; message?: string }) => {
    status = 'disconnected';
    options.onStatusChange({ status });
    options.onDisconnect(details);
  };

  const endWith = (details: { reason: string; message?: string }) => {
    if (status !== 'connected' && status !== 'connecting') {
      return ending?.promise ?? Promise.resolve();
    }
    status = 'disconnecting';
    options.onStatusChange({ status });
    if (!slowEnding) {
      finishWith(details);
      return Promise.resolve();
    }
    const held = deferred<void>();
    ending = held;
    held.promise.then(() => finishWith(details));
    return held.promise;
  };

  const conversation: FakeConversation = {
    muting: [],
    sent: [],
    endSessions: 0,
    inputVolume: 0.3,
    outputVolume: 0.2,
    endSession: () => {
      conversation.endSessions++;
      return endWith({ reason: 'user' });
    },
    holdEnding: () => {
      slowEnding = true;
    },
    finishEnding: () => {
      if (!ending) {
        throw new Error('Nothing is ending.');
      }
      ending.resolve();
    },
    setMicMuted: (muted) => {
      conversation.muting.push(muted);
    },
    sendUserMessage: (text) => {
      conversation.sent.push(text);
    },
    getInputVolume: () => conversation.inputVolume,
    getOutputVolume: () => conversation.outputVolume,
    getOutputByteFrequencyData: () => new Uint8Array(1024).fill(40),
  };

  // The SDK reports `connecting` before its first await, inside the call itself.
  options.onStatusChange({ status: 'connecting' });

  const dial: FakeDial = {
    options,
    spoken: 'conversationToken' in options ? options : undefined,
    written: 'signedUrl' in options ? options : undefined,
    conversation,
    connect: async () => {
      options.onConversationCreated(conversation);
      status = 'connected';
      options.onStatusChange({ status });
      started.resolve(conversation);
      await settle();
    },
    reject: async (error) => {
      status = 'disconnected';
      options.onStatusChange({ status });
      started.reject(error);
      await settle();
    },
    drop: (message) => {
      endWith({ reason: 'error', message });
    },
    agentHangsUp: () => {
      endWith({ reason: 'agent' });
    },
  };
  return { dial, promise: started.promise };
}

/** `Conversation.startSession`, recording each call as a {@link FakeDial}. */
export function createFakeSdk() {
  const dials: FakeDial[] = [];
  const startSession: StartSession = (options) => {
    const { dial, promise } = createFakeDial(options);
    dials.push(dial);
    return promise;
  };
  return {
    startSession,
    dials,
    get latest() {
      const dial = dials.at(-1);
      if (!dial) {
        throw new Error('Nothing has been dialled.');
      }
      return dial;
    },
  };
}

/** A LiveKit room with the agent in it, playing through one `<audio>`-like element. */
export function createFakeRoom() {
  const stream = { id: 'agent-stream' };
  let playing: unknown = stream;
  const assignments: unknown[] = [];
  const element = {
    get srcObject() {
      return playing;
    },
    set srcObject(value: unknown) {
      assignments.push(value);
      playing = value;
    },
    assignments,
    stream,
    plays: 0,
    play: async () => {
      element.plays++;
    },
  };
  const room: AgentTrackRoom = {
    remoteParticipants: new Map([
      [
        'agent',
        {
          identity: 'agent_7123',
          audioTrackPublications: new Map([
            ['voice', { track: { mediaStreamTrack: {}, attachedElements: [element] } }],
          ]),
        },
      ],
    ]),
    on: () => undefined,
    off: () => undefined,
  };
  return { room, element };
}

/** Everything the session reports, in order, as short strings a test can compare. */
export function createEventLog() {
  const log: string[] = [];
  const phases: SessionPhase[] = [];
  const problems: string[] = [];
  const sources: ProblemSource[] = [];
  const captions: Array<string | undefined> = [];
  const diagnostics: SessionDiagnostics[] = [];
  return {
    log,
    phases,
    problems,
    sources,
    captions,
    diagnostics,
    events: {
      onPhase: (phase: SessionPhase) => {
        phases.push(phase);
        log.push(`phase:${phase}`);
      },
      onProblem: (message: string, source: ProblemSource) => {
        problems.push(message);
        sources.push(source);
        log.push(`problem:${message}`);
      },
      onCaption: (text: string | undefined) => {
        captions.push(text);
        log.push(`caption:${text ?? ''}`);
      },
      onDiagnostics: (reported: SessionDiagnostics) => {
        diagnostics.push(reported);
      },
    },
  };
}

/**
 * What the headset sends and says that is its own, for the specs written against it: its name in
 * the history, no platform delay before dialling, the half-duplex fallback, and its words for a
 * request that reached no server.
 */
export const HEADSET_OFFLINE_PROBLEM =
  'ElevenLabs could not be reached. Check that the headset is connected to the internet.';

/**
 * A session made entirely of the fakes above, and the handles to drive each of them — set up as the
 * headset sets its own up, because that is the device these specs were first written for. A spec
 * about another device overrides what differs; `waitsForRoute` gives the greeting a phone's wait
 * for a headset's call link.
 */
export function createHarness(
  overrides: Partial<JarvisSessionDependencies<number>> = {},
  { waitsForRoute = false }: { waitsForRoute?: boolean } = {},
) {
  const clock = createFakeClock();
  const tokens = createFakeTokenEndpoint();
  const greeting = createFakeGreeting(clock, { waitsForRoute });
  const sdk = createFakeSdk();
  const events = createEventLog();
  const { room, element } = createFakeRoom();
  let orphanSweeps = 0;
  let pushReaders: ((readers: JarvisVoiceReaders | undefined) => void) | undefined;
  let followsStopped = 0;

  const session = createJarvisSession({
    settings: { apiKey: 'sk_a-secret-key', agentId: 'agent_01jz0123456789' },
    participantName: HEADSET_PARTICIPANT_NAME,
    startSession: sdk.startSession,
    greeting: greeting.player,
    events: events.events,
    connectionDelay: { default: 0, android: 0 },
    halfDuplex: true,
    offlineProblem: HEADSET_OFFLINE_PROBLEM,
    fetch: tokens.fetch,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    findRoom: () => room,
    followAgentVoice: (_room, onReaders) => {
      pushReaders = onReaders;
      return () => {
        followsStopped++;
      };
    },
    removeOrphanedAudio: () => {
      orphanSweeps++;
    },
    ...overrides,
  });

  return {
    session,
    clock,
    tokens,
    greeting,
    sdk,
    events,
    element,
    get orphanSweeps() {
      return orphanSweeps;
    },
    get followsStopped() {
      return followsStopped;
    },
    /** Hands the session readers for his track, as following it would once it is subscribed. */
    playAgentVoice(readers: JarvisVoiceReaders | undefined) {
      if (!pushReaders) {
        throw new Error('His track is not being followed yet.');
      }
      pushReaders(readers);
    },
    /** Summon, greet, grant the token, finish the greeting and connect: a live conversation. */
    async goLive() {
      session.summon();
      greeting.allow();
      tokens.grant();
      await settle();
      await clock.advance(greeting.durationMilliseconds + 100);
      await sdk.latest.connect();
    },
  };
}
