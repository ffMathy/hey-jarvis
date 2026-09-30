import { type AgentTrackRoom, agentAudioTracks } from './agent-audio-track';
import { GIVE_UP_CONNECTING_AFTER_MS, isLive } from './conversation-life';
import { requestConversationToken } from './conversation-token';
import { DEADLINE_PROBLEM, describeDisconnect, describeStartFailure, describeTokenFailure } from './failure-text';
import { isGreetingOver, WITHOUT_FIRST_MESSAGE } from './greeting-handover';
import { createGreetingReaders } from './greeting-voice';
import { createHalfDuplexDetector } from './half-duplex';
import { flushQueuedAudio } from './queued-audio';
import type {
  JarvisSession,
  JarvisSessionDependencies,
  SessionConversation,
  SessionDiagnostics,
  SessionEnding,
  SessionOptions,
  SessionPhase,
} from './session-contract';
import { createToolActivity } from './tool-activity';
import { createVadScoreKeeper } from './vad-score';
import type { JarvisVoice, JarvisVoiceReaders, UserVoice } from './voice-contract';
import { createWrittenCaption } from './written-caption';
import type { ConversationMessage } from './written-reply';

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
 * Where the recording is in one summoning. `asking` until the browser has answered `play()`,
 * `playing` while it is heard, and `over` once it has finished, been refused or been given up on.
 */
type GreetingState = 'asking' | 'playing' | 'over';

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
  greeting: GreetingState;
  /** Whether the recording actually played, which is what switches the agent's first message off. */
  greeted: boolean;
  /** When the recording was asked for, on `now()`'s clock. */
  askedAt: number;
  token?: string;
  dialled: boolean;
  conversation?: SessionConversation;
  room?: AgentTrackRoom;
  stopFollowing?: () => void;
  /** The SDK's status and mode, only ever as its callbacks report them. */
  status: string;
  mode: string;
  /** Whether this app has muted the session's microphone, which the SDK publishes unmuted. */
  microphoneMuted: boolean;
  deadline?: Timer;
  greetingCheck?: Timer;
}

/**
 * Jarvis's conversation, summoning by summoning, on the ElevenLabs SDK's own client.
 *
 * Written for the headset, which has no React, and in the main entry so that every device holds
 * its conversation by the same rules. The SDK's React provider brings guarantees the raw client
 * does not have, and this recreates them without a framework. **One start at a time**:
 * a summon is ignored unless the last one is over, since two WebRTC sessions at once tear each
 * other down. **An ending is always reached**: every way a summoning can go wrong — the token
 * request, a start that rejects, an error before the conversation opens, the deadline, a
 * connection that drops once open — lands in `failed` with a readable problem, and every ending
 * stops the greeting and ends the session, including one that only connects after it was given up
 * on. **Status and mode come from the SDK's callbacks only**, never from its errors: the React
 * provider marks any error as the conversation's end, which would send Jarvis away mid-sentence
 * over a non-fatal server message.
 *
 * On summon, the greeting starts and the token is requested at the same moment, so the handshake
 * overlaps him speaking. The session is dialled once the greeting is over, as a phone does it:
 * opening the session's microphone mid-greeting switches an Android audio stack into call mode,
 * which is what clipped the recording on the phone, and dialling behind it also let the agent hear
 * the greeting before the session could be muted. `waitsForGreetingBeforeDialling: false` dials
 * behind it instead, muted from `onConversationCreated` until he has finished.
 */
export function createJarvisSession<Timer>(dependencies: JarvisSessionDependencies<Timer>): JarvisSession {
  const { settings, participantName, startSession, greeting, events } = dependencies;
  const now = dependencies.now ?? (() => performance.now());
  const schedule = dependencies.setTimeout;
  const cancel = dependencies.clearTimeout;
  const waitsForGreetingBeforeDialling = dependencies.waitsForGreetingBeforeDialling ?? true;
  const halfDuplexAllowed = dependencies.halfDuplex ?? false;
  const offlineProblem = dependencies.offlineProblem;
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

  const halfDuplex = createHalfDuplexDetector(now);
  const vadScore = createVadScoreKeeper();
  const caption = createWrittenCaption((text) => events.onCaption(text));
  const toolActivity = createToolActivity({
    // Read through `thinking` on the hologram's clock; nothing needs telling as it changes.
    onChange: () => undefined,
    setTimeout: schedule,
    clearTimeout: cancel,
  });

  const openAttempt = () => (attempt && !attempt.closed ? attempt : undefined);
  const isCurrent = (candidate: Attempt<Timer>) => candidate === attempt && !candidate.closed;

  const setPhase = (next: SessionPhase) => {
    if (next === phase) {
      return;
    }
    phase = next;
    events.onPhase(next);
  };

  const report = () => {
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

  /**
   * Closes an attempt for good: the greeting stopped, the session ended — now, or the moment its
   * start resolves — and everything drawn from it let go. Says whether it was still open.
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
    stopTimers(current);
    current.stopFollowing?.();
    current.stopFollowing = undefined;
    liveVoice = createLiveVoice(sdkReaders);
    toolActivity.forget();
    vadScore.forget();
    caption.reset();
    current.conversation?.endSession().catch(() => undefined);
    report();
    return true;
  };

  const end = (current: Attempt<Timer>) => {
    if (close(current)) {
      setPhase('ended');
    }
  };

  const fail = (current: Attempt<Timer>, problem: string) => {
    if (close(current)) {
      events.onProblem(problem);
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
    applyMicrophone(current);
    const room = findRoom(conversation);
    if (!room) {
      return;
    }
    current.room = room;
    current.stopFollowing = followVoice?.(room, (readers) => {
      if (isCurrent(current)) {
        liveVoice = createLiveVoice(readers ?? sdkReaders);
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
   * it is not an ending — that is `onDisconnect`'s to say — so it goes to the HUD and no further.
   */
  const errorReported = (current: Attempt<Timer>, message: string) => {
    if (current.status !== 'connected') {
      fail(current, describeStartFailure(message, offlineProblem));
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
    fail(current, describeDisconnect(ending.message));
    sweepOrphanedAudio();
  };

  const sessionOptions = (current: Attempt<Timer>, token: string): SessionOptions => ({
    conversationToken: token,
    connectionType: 'webrtc',
    ...(dependencies.connectionDelay ? { connectionDelay: dependencies.connectionDelay } : {}),
    ...(current.greeted ? { overrides: WITHOUT_FIRST_MESSAGE } : {}),
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

  // ── Dialling ───────────────────────────────────────────────────────────────────────────────────

  const started = (current: Attempt<Timer>, conversation: SessionConversation) => {
    if (!isCurrent(current)) {
      // Given up on or hung up while it was dialling: nobody is waiting for it now.
      conversation.endSession().catch(() => undefined);
      return;
    }
    if (!current.conversation) {
      adopt(current, conversation);
    }
  };

  const dial = (current: Attempt<Timer>, token: string) => {
    current.dialled = true;
    let starting: Promise<SessionConversation>;
    try {
      starting = startSession(sessionOptions(current, token));
    } catch (error) {
      fail(current, describeStartFailure(error, offlineProblem));
      return;
    }
    starting.then(
      (conversation) => started(current, conversation),
      (error: unknown) => {
        if (isCurrent(current)) {
          fail(current, describeStartFailure(error, offlineProblem));
        }
      },
    );
  };

  /** Dials once there is a token and the greeting allows it — whichever of the two comes last. */
  const dialWhenReady = (current: Attempt<Timer>) => {
    if (!isCurrent(current) || current.dialled || current.token === undefined || current.greeting === 'asking') {
      return;
    }
    if (current.greeting === 'playing' && waitsForGreetingBeforeDialling) {
      return;
    }
    dial(current, current.token);
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
    applyMicrophone(current);
    if (!isCurrent(current)) {
      return;
    }
    setPhase(current.status === 'connected' ? 'live' : 'connecting');
    dialWhenReady(current);
  }

  /**
   * Whether the greeting is over, by the shared rule (`isGreetingOver`): the recording reached its
   * end, or the wall clock ran past its length and a grace. A player that has not answered `play()`
   * by then is given up on and stopped, so a late start cannot talk over the agent.
   */
  function checkGreeting(current: Attempt<Timer>) {
    if (current.closed || current.greeting === 'over') {
      return;
    }
    const progress = { secondsSinceAsked: (now() - current.askedAt) / 1000, durationSeconds: greeting.duration };
    if (current.greeting === 'asking') {
      if (isGreetingOver({ ...progress, positionSeconds: undefined })) {
        greeting.stop();
        finishGreeting(current);
      }
      return;
    }
    const position = greeting.position();
    if (position < 0 || isGreetingOver({ ...progress, positionSeconds: position })) {
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
      // Hung up on, failed or given up on while the browser was deciding: whatever it decided,
      // nobody is waiting to hear it — unless a newer summoning has the player by now.
      if (playing && !greetingInUseBeyond(current)) {
        greeting.stop();
      }
      return;
    }
    if (!playing) {
      // Refused: the agent keeps its own first message, so he is never left not greeting at all.
      finishGreeting(current);
      return;
    }
    current.greeting = 'playing';
    current.greeted = true;
    applyMicrophone(current);
    dialWhenReady(current);
  };

  const startGreeting = (current: Attempt<Timer>) => {
    current.askedAt = now();
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
    scheduleGreetingCheck(current);
  };

  const requestToken = (current: Attempt<Timer>) => {
    requestConversationToken({ settings, participantName }, dependencies.fetch).then(
      ({ token }) => {
        if (isCurrent(current)) {
          current.token = token;
          dialWhenReady(current);
        }
      },
      (error: unknown) => {
        if (isCurrent(current)) {
          fail(current, describeTokenFailure(error, offlineProblem));
        }
      },
    );
  };

  const giveUp = (current: Attempt<Timer>) => {
    current.deadline = undefined;
    if (isCurrent(current) && current.status !== 'connected') {
      fail(current, DEADLINE_PROBLEM);
    }
  };

  /** Every summoning starts in voice, with nothing written, nothing thought and full duplex. */
  const startAfresh = () => {
    typing = false;
    interruptions = 0;
    lastError = undefined;
    halfDuplex.reset();
    caption.reset();
    toolActivity.forget();
    vadScore.forget();
    liveVoice = createLiveVoice(sdkReaders);
  };

  const summon = () => {
    if (disposed || !(phase === 'idle' || phase === 'ended' || phase === 'failed')) {
      return;
    }
    const current: Attempt<Timer> = {
      closed: false,
      greeting: 'asking',
      greeted: false,
      askedAt: now(),
      dialled: false,
      status: 'disconnected',
      mode: 'listening',
      microphoneMuted: false,
    };
    attempt = current;
    startAfresh();
    setPhase('greeting');
    if (!isCurrent(current)) {
      return;
    }
    current.deadline = schedule(() => giveUp(current), GIVE_UP_CONNECTING_AFTER_MS);
    requestToken(current);
    startGreeting(current);
    report();
  };

  /**
   * Both ways out close the attempt, so nothing it reports afterwards is shown — a problem after
   * you dismissed him is not one you need to read, and one after the headset went to sleep is one
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
      if (!current?.conversation || phase !== 'live' || !line) {
        return;
      }
      caption.typed(line);
      try {
        current.conversation.sendUserMessage(line);
      } catch {
        // The session went between the phase and this; its ending says so for itself.
      }
    },
    setTyping: (next) => {
      typing = next;
      caption.setTyping(next);
      const current = openAttempt();
      if (current) {
        applyMicrophone(current);
      }
    },
    get phase() {
      return phase;
    },
    get voice() {
      const current = openAttempt();
      if (!current) {
        return SILENT_VOICE;
      }
      checkGreeting(current);
      if (current.greeting !== 'over') {
        return greetingVoice;
      }
      return current.status === 'connected' ? liveVoice : SILENT_VOICE;
    },
    user,
    get thinking() {
      return toolActivity.thinking();
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
