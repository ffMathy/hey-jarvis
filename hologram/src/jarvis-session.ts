import { type AgentTrackRoom, agentAudioTracks } from './agent-audio-track';
import { GIVE_UP_CONNECTING_AFTER_MS, isLive } from './conversation-life';
import { requestConversationToken, requestSignedConversationUrl } from './conversation-token';
import { DEADLINE_PROBLEM, describeDisconnect, describeStartFailure, describeTokenFailure } from './failure-text';
import { isGreetingOver, WITHOUT_FIRST_MESSAGE } from './greeting-handover';
import { createGreetingReaders } from './greeting-voice';
import { createHalfDuplexDetector } from './half-duplex';
import { flushQueuedAudio } from './queued-audio';
import type {
  JarvisSession,
  JarvisSessionDependencies,
  ProblemSource,
  SessionCallbacks,
  SessionConversation,
  SessionDiagnostics,
  SessionEnding,
  SessionOptions,
  SessionPhase,
  SessionSnapshot,
  SummonOptions,
} from './session-contract';
import { createToolActivity } from './tool-activity';
import { createVadScoreKeeper } from './vad-score';
import type { JarvisVoice, JarvisVoiceReaders, UserVoice } from './voice-contract';
import {
  createTextModeCaption,
  createTextOnlyCaption,
  createWrittenCaption,
  type SessionCaption,
} from './written-caption';
import { type ConversationMessage, SAYING_NOTHING, type WrittenReply } from './written-reply';

/**
 * How often a greeting in progress is checked for having finished — the phone's own interval.
 * The voice readers check it too, every time the hologram reads them, so a timer the browser
 * throttles (a page behind an immersive session may count as hidden) never holds the microphone.
 */
const GREETING_CHECK_MS = 50;

/**
 * How long after a dropped connection the page is swept a second time for the SDK's orphaned
 * `<audio>` elements. LiveKit ends the remote tracks as it tears the room down, which may finish
 * after the SDK has already reported the disconnect.
 */
const ORPHAN_SWEEP_AGAIN_MS = 2_000;

const SILENT_SPECTRUM = new Uint8Array(0);

/** Nothing to listen to: what the sphere follows between conversations and while one is dialled. */
const SILENT_VOICE: JarvisVoice = {
  listening: false,
  speaking: false,
  getVolume: () => 0,
  getSpectrum: () => SILENT_SPECTRUM,
};

/**
 * Where the recording is in one summoning. `preparing` while the call's audio is switched into, on
 * a device that has some; `asking` until the player has answered `play()`; `playing` while it is
 * heard; and `over` once it has finished, been refused or been given up on — or when there was
 * never going to be one, in a conversation held in writing.
 */
type GreetingState = 'preparing' | 'asking' | 'playing' | 'over';

/**
 * Who has the call's audio (see `CallAudio`): nobody, the greeting, or the conversation dialled
 * after it. The difference between the last two is only what a refused greeting may let go of.
 */
type CallAudioHolder = 'nobody' | 'greeting' | 'conversation';

/** What a summoning dials with, once it has been asked for: a token, or a signed URL. */
type Credential = { kind: 'token'; token: string } | { kind: 'signed-url'; signedUrl: string };

/**
 * One summoning, from the wake word to its ending.
 *
 * Every SDK callback is bound to the attempt that dialled it and dropped unless that attempt is
 * still the current one and still open — the React provider's session id, in the shape of an
 * object. That is what keeps a session that connects late, after the deadline has given up on it,
 * or one hung up on while it was still dialling, from reaching into the next summoning.
 */
interface Attempt<Timer> {
  /** Ended or failed. Nothing it reports afterwards counts. */
  closed: boolean;
  /** Held in writing on both sides: see `SummonOptions.textOnly`. */
  textOnly: boolean;
  greeting: GreetingState;
  /** Whether the recording actually played, which is what switches the agent's first message off. */
  greeted: boolean;
  /** When the recording was asked for, on `now()`'s clock. */
  askedAt: number;
  /** Told once the greeting has started or will not, and then forgotten. */
  onGreetingAnswered?: () => void;
  /** Whether the token has been asked for yet: at once, or once `untilOnline` has answered. */
  reaching: boolean;
  /** Where the network `untilOnline` brings up is: not asked for, coming up, or up and held. */
  network: 'unasked' | 'coming-up' | 'held';
  credential?: Credential;
  dialled: boolean;
  /** Whether `startSession` has been called and has not yet resolved or rejected. */
  starting: boolean;
  conversation?: SessionConversation;
  room?: AgentTrackRoom;
  stopFollowing?: () => void;
  callAudio: CallAudioHolder;
  /** The SDK's status and mode, only ever as its callbacks report them. */
  status: string;
  mode: string;
  /** Whether this app has muted the session's microphone, which the SDK publishes unmuted. */
  microphoneMuted: boolean;
  deadline?: Timer;
  greetingCheck?: Timer;
}

/**
 * Jarvis's conversation, summoning by summoning, on the ElevenLabs SDK's own client — the one every
 * device runs: the headset directly, the phone and the watch through `useJarvisSession` in
 * `hologram/conversation`.
 *
 * The SDK's React provider brings guarantees the raw client does not have, and this recreates them
 * without a framework. **One start at a time**: a summon is ignored unless the last one is over,
 * since two WebRTC sessions at once tear each other down. **An ending is always reached**: every way
 * a summoning can go wrong — the token request, a start that rejects, an error before the
 * conversation opens, the deadline, a connection that drops once open — lands in `failed` with a
 * readable problem, and every ending stops the greeting and ends the session, including one that
 * only connects after it was given up on. **Status and mode come from the SDK's callbacks only**,
 * never from its errors: the provider marks any error as the conversation's end, which sent Jarvis
 * away mid-sentence over a non-fatal server message while his voice played on.
 *
 * On summon, the greeting starts and the token is requested at the same moment, so the handshake
 * overlaps him speaking. The session is dialled once the greeting is over, as a phone does it:
 * opening the session's microphone mid-greeting switches an Android audio stack into call mode,
 * which is what clipped the recording on the phone, and dialling behind it also let the agent hear
 * the greeting before the session could be muted. `waitsForGreetingBeforeDialling: false` dials
 * behind it instead, muted from `onConversationCreated` until he has finished. On a device with
 * call audio the greeting is played inside it (`callAudio`), and a device that has to find a
 * network first asks for it once he has started (`untilOnline`).
 */
export function createJarvisSession<Timer>(dependencies: JarvisSessionDependencies<Timer>): JarvisSession {
  const { participantName, startSession, greeting, events, callAudio, untilOnline, leaveNetwork } = dependencies;
  const now = dependencies.now ?? (() => performance.now());
  const schedule = dependencies.setTimeout;
  const cancel = dependencies.clearTimeout;
  const waitsForGreetingBeforeDialling = dependencies.waitsForGreetingBeforeDialling ?? true;
  const halfDuplexAllowed = dependencies.halfDuplex ?? false;
  const offlineProblem = dependencies.offlineProblem;
  const deadlineProblem = dependencies.deadlineProblem ?? (() => DEADLINE_PROBLEM);
  const findRoom = dependencies.findRoom ?? (() => undefined);
  const followVoice = dependencies.followAgentVoice;
  const removeOrphanedAudio = dependencies.removeOrphanedAudio;

  let phase: SessionPhase = 'idle';
  let attempt: Attempt<Timer> | undefined;
  let disposed = false;
  let typing = false;
  let interruptions = 0;
  let lastError: string | undefined;
  /** When he was last heard — speaking, or greeting — for `quietFor`. Never, to begin with. */
  let lastHeardAt = Number.NEGATIVE_INFINITY;
  let reportedDiagnostics: string | undefined;
  const listeners = new Set<() => void>();

  const halfDuplex = createHalfDuplexDetector(now);
  const vadScore = createVadScoreKeeper();
  const toolActivity = createToolActivity({
    onChange: () => changed(),
    setTimeout: schedule,
    clearTimeout: cancel,
  });

  const captionChanged = (reply: WrittenReply) => {
    events.onCaption?.(reply.shown);
    changed();
  };
  const voiceCaption =
    dependencies.captions === 'while-typing'
      ? createTextModeCaption(captionChanged)
      : createWrittenCaption(captionChanged);
  const textOnlyCaption = createTextOnlyCaption(captionChanged, now);
  let caption: SessionCaption = voiceCaption;

  const openAttempt = () => (attempt && !attempt.closed ? attempt : undefined);
  const isCurrent = (candidate: Attempt<Timer>) => candidate === attempt && !candidate.closed;

  // ── What a screen draws from ───────────────────────────────────────────────────────────────────

  let snapshot: SessionSnapshot = {
    phase,
    status: 'disconnected',
    mode: 'listening',
    voice: SILENT_VOICE,
    greeting: false,
    thinking: false,
    writtenReply: SAYING_NOTHING,
    typing: false,
    dialled: false,
  };

  /**
   * Takes a fresh snapshot, and tells the listeners if anything in it has moved. Called after
   * everything that could change one — often more than once for one event, which costs a shallow
   * comparison — so that nothing a screen draws is ever left behind.
   */
  function changed() {
    const current = openAttempt();
    const voice = voiceNow();
    const drawnVoice = snapshot.voice;
    const next: SessionSnapshot = {
      phase,
      status: current?.status ?? 'disconnected',
      mode: current?.mode ?? 'listening',
      // A plain object with the flags read now, since a screen reads them as it renders, and the
      // same object as long as nothing about it has moved.
      voice:
        drawnVoice.listening === voice.listening &&
        drawnVoice.speaking === voice.speaking &&
        drawnVoice.getVolume === voice.getVolume &&
        drawnVoice.getSpectrum === voice.getSpectrum
          ? drawnVoice
          : {
              listening: voice.listening,
              speaking: voice.speaking,
              getVolume: voice.getVolume,
              getSpectrum: voice.getSpectrum,
            },
      greeting: current?.greeting === 'asking' || current?.greeting === 'playing',
      thinking: toolActivity.thinking(),
      writtenReply: caption.reply,
      typing,
      dialled: current?.dialled ?? false,
    };
    const moved =
      next.phase !== snapshot.phase ||
      next.status !== snapshot.status ||
      next.mode !== snapshot.mode ||
      next.voice !== snapshot.voice ||
      next.greeting !== snapshot.greeting ||
      next.thinking !== snapshot.thinking ||
      next.writtenReply !== snapshot.writtenReply ||
      next.typing !== snapshot.typing ||
      next.dialled !== snapshot.dialled;
    if (!moved) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  const setPhase = (next: SessionPhase) => {
    if (next === phase) {
      return;
    }
    phase = next;
    events.onPhase?.(next);
    changed();
  };

  const report = () => {
    changed();
    if (!events.onDiagnostics) {
      return;
    }
    const diagnostics: SessionDiagnostics = {
      status: attempt?.status ?? 'disconnected',
      mode: attempt?.mode ?? 'listening',
      interruptions,
      halfDuplex: halfDuplexAllowed && halfDuplex.on,
      ...(lastError === undefined ? {} : { lastError }),
    };
    const key = JSON.stringify(diagnostics);
    if (key !== reportedDiagnostics) {
      reportedDiagnostics = key;
      events.onDiagnostics(diagnostics);
    }
  };

  /**
   * Binds an SDK callback to the attempt that dialled it (see {@link Attempt}), and keeps it from
   * throwing into the SDK: a throw from `onConversationCreated` makes the SDK end the conversation
   * as though the user had, which would send him away with nothing to say why.
   */
  const bound =
    <CallbackArguments extends unknown[]>(owner: Attempt<Timer>, handler: (...parameters: CallbackArguments) => void) =>
    (...parameters: CallbackArguments) => {
      if (!isCurrent(owner)) {
        return;
      }
      try {
        handler(...parameters);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        report();
      }
    };

  // ── Whose voice, and whose microphone ──────────────────────────────────────────────────────────

  const connected = () => openAttempt()?.status === 'connected';

  /** The SDK's own readers, for when the track cannot be listened to. They never read true silence. */
  const sdkReaders: JarvisVoiceReaders = {
    getVolume: () => {
      try {
        return openAttempt()?.conversation?.getOutputVolume() ?? 0;
      } catch {
        return 0;
      }
    },
    getSpectrum: () => {
      try {
        return openAttempt()?.conversation?.getOutputByteFrequencyData() ?? SILENT_SPECTRUM;
      } catch {
        return SILENT_SPECTRUM;
      }
    },
  };

  /** His voice once connected. Remade whenever the readers behind it change, so a reader can tell. */
  const createLiveVoice = (readers: JarvisVoiceReaders): JarvisVoice => ({
    get listening() {
      return connected();
    },
    get speaking() {
      return connected() && openAttempt()?.mode === 'speaking';
    },
    getVolume: () => readers.getVolume(),
    getSpectrum: () => readers.getSpectrum(),
  });

  let liveVoice = createLiveVoice(sdkReaders);

  /** Where the recording is while it is heard, else −1: the envelope follows what can be heard. */
  const audibleGreetingPosition = () => {
    const current = openAttempt();
    if (!current) {
      return -1;
    }
    checkGreeting(current);
    return current.greeting === 'playing' ? greeting.position() : -1;
  };

  const greetingVoice: JarvisVoice = {
    listening: true,
    speaking: true,
    ...createGreetingReaders(audibleGreetingPosition),
  };

  /**
   * What the sphere follows now, as of the last change: the greeting's envelope once it has been
   * asked for, his voice while connected, and silence otherwise — including while a device is still
   * switching into its call audio, when there is nothing yet to be heard.
   */
  function voiceNow(): JarvisVoice {
    const current = openAttempt();
    if (!current || current.greeting === 'preparing') {
      return SILENT_VOICE;
    }
    if (current.greeting !== 'over') {
      return greetingVoice;
    }
    return current.status === 'connected' ? liveVoice : SILENT_VOICE;
  }

  /**
   * Keeps the score deaf while he speaks or greets — his voice through the speaker scores as the
   * user's — and forgets it whenever nobody is being listened to, as `useUserVoice` does.
   */
  const updateHearing = (current: Attempt<Timer>) => {
    vadScore.jarvisSpeaking(current.greeting !== 'over' || current.mode === 'speaking');
    if (current.status !== 'connected' || current.microphoneMuted) {
      vadScore.forget();
    }
  };

  /**
   * Whether the session's microphone should be muted now. Three things can hold it, and it opens
   * only when none of them does: the greeting (so the agent does not hear him say it), the keyboard
   * (the phone's text mode), and the half-duplex fallback while he is speaking.
   */
  const microphoneHeld = (current: Attempt<Timer>) =>
    (current.greeted && current.greeting !== 'over') ||
    typing ||
    (halfDuplexAllowed && halfDuplex.on && current.mode === 'speaking');

  const applyMicrophone = (current: Attempt<Timer>) => {
    const muted = microphoneHeld(current);
    if (current.conversation && !current.closed && muted !== current.microphoneMuted) {
      current.microphoneMuted = muted;
      try {
        current.conversation.setMicMuted(muted);
      } catch {
        // A text conversation has no microphone to mute; there is nothing else it could mean.
      }
    }
    updateHearing(current);
  };

  const hearingUser = () => {
    const current = openAttempt();
    return current?.status === 'connected' && !current.microphoneMuted ? current.conversation : undefined;
  };

  const user: UserVoice = {
    getPresence: () => (hearingUser() ? vadScore.latest() : 0),
    getVolume: () => {
      try {
        return hearingUser()?.getInputVolume() ?? 0;
      } catch {
        return 0;
      }
    },
  };

  // ── The call's audio ───────────────────────────────────────────────────────────────────────────

  /** Lets go of the call's audio, once, whoever had it. */
  const releaseCallAudio = (current: Attempt<Timer>) => {
    if (current.callAudio === 'nobody') {
      return;
    }
    current.callAudio = 'nobody';
    callAudio?.stop().catch(() => {
      // Nothing to put back: it never started.
    });
  };

  /**
   * Lets go of it once the conversation that had it has finished ending, which the SDK only says
   * after it has taken its own audio session down — putting the device's audio mode back before
   * then would leave it for the SDK to switch into again as it goes.
   */
  const releaseAfter = (current: Attempt<Timer>, ending: Promise<void>) => {
    ending.catch(() => undefined).then(() => releaseCallAudio(current));
  };

  // ── Endings ────────────────────────────────────────────────────────────────────────────────────

  const stopTimers = (current: Attempt<Timer>) => {
    if (current.deadline !== undefined) {
      cancel(current.deadline);
      current.deadline = undefined;
    }
    if (current.greetingCheck !== undefined) {
      cancel(current.greetingCheck);
      current.greetingCheck = undefined;
    }
  };

  /** Tells whoever asked that the greeting has started or will not — once. */
  function answerGreeting(current: Attempt<Timer>) {
    const answered = current.onGreetingAnswered;
    current.onGreetingAnswered = undefined;
    try {
      answered?.();
    } catch {
      // Whatever it was letting go of, the conversation does not depend on it.
    }
  }

  /**
   * Closes an attempt for good: the greeting stopped, the session ended — now, or the moment its
   * start resolves — the call's audio let go after it, and everything drawn from it let go. Says
   * whether it was still open.
   */
  const close = (current: Attempt<Timer>) => {
    if (current.closed) {
      return false;
    }
    current.closed = true;
    if (current.greeting === 'playing' || current.mode === 'speaking') {
      lastHeardAt = now();
    }
    if (current.greeting !== 'over') {
      current.greeting = 'over';
      greeting.stop();
    }
    answerGreeting(current);
    stopTimers(current);
    current.stopFollowing?.();
    current.stopFollowing = undefined;
    liveVoice = createLiveVoice(sdkReaders);
    toolActivity.forget();
    vadScore.forget();
    caption.ended();
    if (current.network === 'held') {
      // One still coming up is let go of once it is up, in `startReaching`.
      current.network = 'unasked';
      leaveNetwork?.();
    }
    if (current.conversation) {
      releaseAfter(current, current.conversation.endSession());
    } else if (!current.starting) {
      releaseCallAudio(current);
    }
    report();
    return true;
  };

  const end = (current: Attempt<Timer>) => {
    if (close(current)) {
      setPhase('ended');
    }
  };

  const fail = (current: Attempt<Timer>, problem: string, source: ProblemSource) => {
    if (close(current)) {
      events.onProblem?.(problem, source);
      setPhase('failed');
    }
  };

  const sweepOrphanedAudio = () => {
    if (!removeOrphanedAudio) {
      return;
    }
    const sweep = () => {
      try {
        removeOrphanedAudio();
      } catch {
        // Tidying up; a page that cannot be tidied is no worse than before.
      }
    };
    sweep();
    schedule(sweep, ORPHAN_SWEEP_AGAIN_MS);
  };

  // ── The SDK's callbacks ────────────────────────────────────────────────────────────────────────

  const adopt = (current: Attempt<Timer>, conversation: SessionConversation) => {
    current.conversation = conversation;
    current.microphoneMuted = false;
    if (current.callAudio === 'greeting') {
      // The conversation has the call's audio now, and its ending lets go of it.
      current.callAudio = 'conversation';
    }
    applyMicrophone(current);
    const room = findRoom(conversation);
    if (!room) {
      return;
    }
    current.room = room;
    current.stopFollowing = followVoice?.(room, (readers) => {
      if (isCurrent(current)) {
        liveVoice = createLiveVoice(readers ?? sdkReaders);
        changed();
      }
    });
  };

  const statusChanged = (current: Attempt<Timer>, status: string) => {
    current.status = status;
    if (status === 'connected') {
      if (current.deadline !== undefined) {
        cancel(current.deadline);
        current.deadline = undefined;
      }
      if (current.greeting === 'over') {
        setPhase('live');
      }
    }
    if (!isLive(status)) {
      // A call still running when the conversation drops never gets its answer.
      toolActivity.forget();
    }
    updateHearing(current);
    report();
  };

  const modeChanged = (current: Attempt<Timer>, mode: string) => {
    const before = current.mode;
    current.mode = mode;
    if (mode === 'speaking' && before !== 'speaking') {
      halfDuplex.agentStartedSpeaking();
    }
    if (before === 'speaking' && mode !== 'speaking') {
      lastHeardAt = now();
    }
    applyMicrophone(current);
    report();
  };

  /**
   * Drops what the browser still has queued of the sentence he was cut off in — over WebRTC the
   * SDK's own `interrupt()` does nothing (see `queued-audio.ts`) — and watches for his own voice
   * doing the interrupting (see `half-duplex.ts`).
   */
  const interrupted = (current: Attempt<Timer>) => {
    interruptions++;
    if (current.room) {
      flushQueuedAudio(agentAudioTracks(current.room));
    }
    halfDuplex.interrupted(current.mode === 'speaking');
    applyMicrophone(current);
    report();
  };

  const messageArrived = (message: ConversationMessage) => {
    if (message.role === 'user') {
      halfDuplex.userSpoke();
    }
    caption.heard(message);
  };

  /**
   * The SDK's errors. Before the conversation is open, one is a failure to open it. Once open,
   * it is not an ending — that is `onDisconnect`'s to say — so it goes to diagnostics and no further.
   */
  const errorReported = (current: Attempt<Timer>, message: string) => {
    if (current.status !== 'connected') {
      fail(current, describeStartFailure(message, offlineProblem), 'session');
      return;
    }
    lastError = message;
    report();
  };

  const disconnected = (current: Attempt<Timer>, ending: SessionEnding) => {
    if (ending.reason !== 'error') {
      end(current);
      return;
    }
    fail(current, describeDisconnect(ending.message), 'session');
    sweepOrphanedAudio();
  };

  const callbacks = (current: Attempt<Timer>): SessionCallbacks => ({
    onConversationCreated: bound(current, (conversation: SessionConversation) => adopt(current, conversation)),
    onStatusChange: bound(current, ({ status }: { status: string }) => statusChanged(current, status)),
    onModeChange: bound(current, ({ mode }: { mode: string }) => modeChanged(current, mode)),
    onVadScore: bound(current, ({ vadScore: score }: { vadScore: number }) => vadScore.heard(score)),
    onAgentToolRequest: bound(current, toolActivity.toolHandlers.onAgentToolRequest),
    onAgentToolResponse: bound(current, toolActivity.toolHandlers.onAgentToolResponse),
    onMCPToolCall: bound(current, toolActivity.toolHandlers.onMCPToolCall),
    onInterruption: bound(current, () => interrupted(current)),
    onMessage: bound(current, messageArrived),
    onError: bound(current, (message: string) => errorReported(current, message)),
    onDisconnect: bound(current, (ending: SessionEnding) => disconnected(current, ending)),
  });

  const sessionOptions = (current: Attempt<Timer>, credential: Credential): SessionOptions => {
    const delay = dependencies.connectionDelay ? { connectionDelay: dependencies.connectionDelay } : {};
    if (credential.kind === 'signed-url') {
      return {
        signedUrl: credential.signedUrl,
        connectionType: 'websocket',
        textOnly: true,
        ...delay,
        ...callbacks(current),
      };
    }
    return {
      conversationToken: credential.token,
      connectionType: 'webrtc',
      ...delay,
      ...(current.greeted ? { overrides: WITHOUT_FIRST_MESSAGE } : {}),
      ...callbacks(current),
    };
  };

  // ── Dialling ───────────────────────────────────────────────────────────────────────────────────

  const started = (current: Attempt<Timer>, conversation: SessionConversation) => {
    current.starting = false;
    if (!isCurrent(current)) {
      // Given up on or hung up while it was dialling: nobody is waiting for it now.
      releaseAfter(current, conversation.endSession());
      return;
    }
    if (!current.conversation) {
      adopt(current, conversation);
    }
  };

  const dial = (current: Attempt<Timer>, credential: Credential) => {
    current.dialled = true;
    let starting: Promise<SessionConversation>;
    try {
      starting = startSession(sessionOptions(current, credential));
    } catch (error) {
      fail(current, describeStartFailure(error, offlineProblem), 'session');
      return;
    }
    current.starting = true;
    changed();
    starting.then(
      (conversation) => started(current, conversation),
      (error: unknown) => {
        current.starting = false;
        if (isCurrent(current)) {
          fail(current, describeStartFailure(error, offlineProblem), 'session');
          return;
        }
        // Closed while it was dialling, and nothing came of it: the call's audio can go now.
        releaseCallAudio(current);
      },
    );
  };

  /** Dials once there is a credential and the greeting allows it — whichever of the two comes last. */
  const dialWhenReady = (current: Attempt<Timer>) => {
    if (!isCurrent(current) || current.dialled || current.credential === undefined) {
      return;
    }
    if (current.greeting === 'preparing' || current.greeting === 'asking') {
      return;
    }
    if (current.greeting === 'playing' && waitsForGreetingBeforeDialling) {
      return;
    }
    dial(current, current.credential);
  };

  const giveUp = (current: Attempt<Timer>) => {
    current.deadline = undefined;
    if (isCurrent(current) && current.status !== 'connected') {
      fail(current, deadlineProblem(), 'deadline');
    }
  };

  const requestCredential = (current: Attempt<Timer>): Promise<Credential> => {
    const { settings } = dependencies;
    if (current.textOnly) {
      return requestSignedConversationUrl(settings, dependencies.fetch).then((signedUrl) => ({
        kind: 'signed-url',
        signedUrl,
      }));
    }
    return requestConversationToken({ settings, participantName }, dependencies.fetch).then(({ token }) => ({
      kind: 'token',
      token,
    }));
  };

  /** Arms the deadline and asks for what to dial with. */
  const reachOut = (current: Attempt<Timer>) => {
    current.deadline = schedule(() => giveUp(current), GIVE_UP_CONNECTING_AFTER_MS);
    requestCredential(current).then(
      (credential) => {
        if (isCurrent(current)) {
          current.credential = credential;
          dialWhenReady(current);
        }
      },
      (error: unknown) => {
        if (isCurrent(current)) {
          fail(current, describeTokenFailure(error, offlineProblem), 'reaching');
        }
      },
    );
  };

  /**
   * Starts reaching ElevenLabs, once: at once, or — on a device that has to find a network a
   * conversation can be held over — once that has answered, which is only asked for once the
   * greeting has started or will not, so the network is brought up while he speaks.
   */
  const startReaching = (current: Attempt<Timer>) => {
    if (current.reaching || !isCurrent(current)) {
      return;
    }
    current.reaching = true;
    if (!untilOnline) {
      reachOut(current);
      return;
    }
    current.network = 'coming-up';
    let online: Promise<void>;
    try {
      online = untilOnline();
    } catch {
      online = Promise.resolve();
    }
    online
      .catch(() => undefined)
      .then(() => {
        if (!isCurrent(current)) {
          // Over while the network was still coming up: nobody is left to hold it for.
          current.network = 'unasked';
          leaveNetwork?.();
          return;
        }
        current.network = 'held';
        reachOut(current);
      });
  };

  // ── The greeting ───────────────────────────────────────────────────────────────────────────────

  function finishGreeting(current: Attempt<Timer>) {
    if (current.greeting === 'playing') {
      lastHeardAt = now();
    }
    current.greeting = 'over';
    if (current.greetingCheck !== undefined) {
      cancel(current.greetingCheck);
      current.greetingCheck = undefined;
    }
    answerGreeting(current);
    applyMicrophone(current);
    if (!isCurrent(current)) {
      return;
    }
    setPhase(current.status === 'connected' ? 'live' : 'connecting');
    changed();
    startReaching(current);
    dialWhenReady(current);
  }

  /**
   * Whether the greeting is over, by the shared rule (`isGreetingOver`): the recording reached its
   * end, or the wall clock ran past its length and a grace. A player that has not answered `play()`
   * by then is given up on and stopped, so a late start cannot talk over the agent.
   */
  function checkGreeting(current: Attempt<Timer>) {
    if (current.closed || current.greeting === 'over' || current.greeting === 'preparing') {
      return;
    }
    const secondsSinceAsked = (now() - current.askedAt) / 1000;
    const durationSeconds = greeting.duration;
    if (current.greeting === 'asking') {
      if (isGreetingOver({ secondsSinceAsked, durationSeconds, positionSeconds: undefined })) {
        greeting.stop();
        finishGreeting(current);
      }
      return;
    }
    const position = greeting.position();
    if (position < 0 || isGreetingOver({ secondsSinceAsked, durationSeconds, positionSeconds: position })) {
      finishGreeting(current);
    }
  }

  const scheduleGreetingCheck = (current: Attempt<Timer>) => {
    current.greetingCheck = schedule(() => {
      current.greetingCheck = undefined;
      checkGreeting(current);
      if (isCurrent(current) && current.greeting !== 'over') {
        scheduleGreetingCheck(current);
      }
    }, GREETING_CHECK_MS);
  };

  /** Whether an attempt other than `settled` is using the player now. */
  const greetingInUseBeyond = (settled: Attempt<Timer>) => {
    const current = openAttempt();
    return current !== undefined && current !== settled && current.greeting !== 'over';
  };

  const greetingAnswered = (current: Attempt<Timer>, playing: boolean) => {
    if (!isCurrent(current) || current.greeting !== 'asking') {
      // Hung up on, failed or given up on while the player was deciding: whatever it decided,
      // nobody is waiting to hear it — unless a newer summoning has the player by now.
      if (playing && !greetingInUseBeyond(current)) {
        greeting.stop();
      }
      return;
    }
    if (!playing) {
      // Refused: the agent keeps its own first message, so he is never left not greeting at all.
      // Nor is there a greeting left to hold the call's audio for; the conversation starts its own.
      if (current.callAudio === 'greeting') {
        releaseCallAudio(current);
      }
      finishGreeting(current);
      return;
    }
    current.greeting = 'playing';
    current.greeted = true;
    answerGreeting(current);
    applyMicrophone(current);
    changed();
    startReaching(current);
    dialWhenReady(current);
  };

  const playGreeting = (current: Attempt<Timer>) => {
    let answer: Promise<boolean>;
    try {
      answer = greeting.playFromStart();
    } catch {
      answer = Promise.resolve(false);
    }
    answer.then(
      (playing) => greetingAnswered(current, playing),
      () => greetingAnswered(current, false),
    );
  };

  /**
   * Asks for the recording. A player with a route to wait for (`untilAudible`) is waited for
   * first, and the clock that gives up on the greeting starts again once it answers: the wait was
   * not him being late.
   */
  const askForGreeting = (current: Attempt<Timer>) => {
    current.greeting = 'asking';
    current.askedAt = now();
    scheduleGreetingCheck(current);
    changed();
    if (!greeting.untilAudible) {
      playGreeting(current);
      return;
    }
    let audible: Promise<void>;
    try {
      audible = greeting.untilAudible();
    } catch {
      audible = Promise.resolve();
    }
    audible
      .catch(() => undefined)
      .then(() => {
        if (!isCurrent(current) || current.greeting !== 'asking') {
          return;
        }
        current.askedAt = now();
        playGreeting(current);
      });
  };

  /**
   * Greets, from the recording. On a device with call audio it is switched into first, which is
   * what makes the greeting heard there at all (see `CallAudio`); the greeting is marked as holding
   * it before the switch starts, since a switch that fails partway may still have changed the
   * device's audio mode, and letting go of one that never started changes nothing.
   */
  const startGreeting = (current: Attempt<Timer>) => {
    if (!callAudio) {
      askForGreeting(current);
      return;
    }
    current.greeting = 'preparing';
    current.callAudio = 'greeting';
    let switching: Promise<void>;
    try {
      switching = callAudio.start();
    } catch {
      switching = Promise.resolve();
    }
    switching
      .catch(() => {
        // He still greets; whether he can be heard without it is the device's business.
      })
      .then(() => {
        if (isCurrent(current)) {
          askForGreeting(current);
        }
      });
  };

  /** Every summoning starts in voice, with nothing written, nothing thought and full duplex. */
  const startAfresh = (textOnly: boolean) => {
    typing = false;
    interruptions = 0;
    lastError = undefined;
    halfDuplex.reset();
    caption = textOnly ? textOnlyCaption : voiceCaption;
    textOnlyCaption.reset();
    voiceCaption.reset();
    toolActivity.forget();
    vadScore.forget();
    liveVoice = createLiveVoice(sdkReaders);
  };

  const summon = (options: SummonOptions = {}) => {
    if (disposed || !(phase === 'idle' || phase === 'ended' || phase === 'failed')) {
      return;
    }
    const textOnly = options.textOnly ?? false;
    const current: Attempt<Timer> = {
      closed: false,
      textOnly,
      greeting: textOnly ? 'over' : 'asking',
      greeted: false,
      askedAt: now(),
      onGreetingAnswered: options.onGreetingAnswered,
      reaching: false,
      network: 'unasked',
      dialled: false,
      starting: false,
      callAudio: 'nobody',
      status: 'disconnected',
      mode: 'listening',
      microphoneMuted: false,
    };
    attempt = current;
    startAfresh(textOnly);
    if (textOnly) {
      // No greeting to hold anything open for, and nothing to wait for before dialling.
      answerGreeting(current);
      setPhase('connecting');
      startReaching(current);
      report();
      return;
    }
    setPhase('greeting');
    if (!isCurrent(current)) {
      return;
    }
    if (!untilOnline) {
      startReaching(current);
    }
    startGreeting(current);
    report();
  };

  /**
   * Both ways out close the attempt, so nothing it reports afterwards is shown — a problem after
   * you dismissed him is not one you need to read, and one after the device went to sleep is one
   * you caused. They differ in who asked, which is the app's to know.
   */
  const endNow = () => {
    const current = openAttempt();
    if (current) {
      end(current);
    }
  };

  return {
    summon,
    hangUp: endNow,
    endQuietly: endNow,
    sendText: (text) => {
      const current = openAttempt();
      const line = text.trim();
      // Connected rather than live: a browser dials behind the greeting, and a line typed into a
      // conversation that is up is answered even while the recording is still playing.
      if (!current?.conversation || current.status !== 'connected' || !line) {
        return;
      }
      caption.typed(line);
      try {
        current.conversation.sendUserMessage(line);
      } catch {
        // The session went between the status and this; its ending says so for itself.
      }
    },
    setTyping: (next) => {
      typing = next;
      caption.setTyping(next);
      const current = openAttempt();
      if (current) {
        applyMicrophone(current);
      }
      changed();
    },
    get phase() {
      return phase;
    },
    get voice() {
      const current = openAttempt();
      if (current) {
        checkGreeting(current);
      }
      return voiceNow();
    },
    user,
    get thinking() {
      return toolActivity.thinking();
    },
    get snapshot() {
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    quietFor: (seconds) => {
      const current = openAttempt();
      if (current && (current.mode === 'speaking' || (current.greeting === 'playing' && greeting.position() >= 0))) {
        return false;
      }
      return now() - lastHeardAt >= seconds * 1000;
    },
    dispose: () => {
      endNow();
      disposed = true;
    },
  };
}
