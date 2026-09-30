import type { AffectedEntity } from './affected-entities';
import type { AgentTrackRoom } from './agent-audio-track';
import type { ElevenLabsSettings } from './elevenlabs-settings';
import type { MCPToolCallEvent, ToolCallEvent } from './tool-activity';
import type { JarvisVoice, JarvisVoiceReaders, UserVoice } from './voice-contract';
import type { ConversationMessage, WrittenReply } from './written-reply';

/**
 * The shapes a conversation with Jarvis is built from, apart from the code that builds it.
 *
 * Everything the ElevenLabs SDK hands over is named here structurally — no more of it than is
 * read — for the reason `agent-audio-track.ts` gives for LiveKit's room: the session can then be
 * driven in `jarvis-session.spec.ts` by a fake `startSession` and a fake conversation, with no SDK,
 * no room and no device, while `Conversation.startSession` from `@elevenlabs/client` still fits
 * {@link StartSession} as it is (each app's contract spec holds its own copy of the SDK to that).
 * Whatever differs between the devices that hold one — how his track is listened to, how the
 * greeting is played, whether there is call audio to switch into, what a timer is — is handed in,
 * so nothing here reaches for a platform.
 */

/**
 * Where one summoning has got to.
 *
 * `failed` is terminal and separate from `ended`, because the two mean different things on a
 * screen: an ending is him leaving, and a failure is a line or a panel saying why, which has to
 * outlive him. Every way a summoning can go wrong before or after it opens ends in `failed`, so
 * nothing is ever left waiting for a conversation that is not coming.
 */
export type SessionPhase = 'idle' | 'greeting' | 'connecting' | 'live' | 'ended' | 'failed';

/** What the session looks like from a diagnostics display, such as the headset's HUD. */
export interface SessionDiagnostics {
  /** The SDK's own status, as its `onStatusChange` last reported it. */
  status: string;
  /** The SDK's mode, as its `onModeChange` last reported it. */
  mode: string;
  /** Interruptions in this summoning. */
  interruptions: number;
  /** Whether the half-duplex fallback has taken over the microphone (see `half-duplex.ts`). */
  halfDuplex: boolean;
  /** The last non-fatal error the SDK reported once connected, if any. */
  lastError?: string;
}

/**
 * Where a problem came from, for a device that says some of them louder than others.
 *
 * `reaching` is the request for a token or a signed URL, `deadline` is nothing having answered in
 * time, and `session` is the SDK itself: a start that failed, an error before the conversation
 * opened, or one that ended with an error. The phone shows the last kind as a toast as well as on
 * its line, because a session that fails once open takes the sheet, and the line, with it.
 */
export type ProblemSource = 'reaching' | 'deadline' | 'session';

/** What a session tells whoever holds it. Every one is optional: a screen may read its snapshot instead. */
export interface JarvisSessionEvents {
  onPhase?(phase: SessionPhase): void;
  /** A readable problem (token failure, deadline, dropped connection…). Always followed by phase 'failed'. */
  onProblem?(message: string, source: ProblemSource): void;
  /** His latest line in writing (for captions), when the caption's rules say to show it. */
  onCaption?(text: string | undefined): void;
  /** For a diagnostics display. */
  onDiagnostics?(diagnostics: SessionDiagnostics): void;
  /**
   * One of his interruptions, as the SDK reported it, once the session has dealt with it itself
   * (dropped what the browser had queued, weighed it for the half-duplex fallback). For a device
   * that watches for its own echo: the headset, whose voice may come from where he stands.
   */
  onInterruption?(): void;
  /**
   * Every line of the conversation as the SDK reported it — his (`agent`) and the user's (`user`)
   * — whatever the caption's rules show. For the same watch: a transcript of the user that repeats
   * what he has just said is his own voice coming back through the microphone.
   */
  onMessage?(message: ConversationMessage): void;
  /**
   * The entities the agent says the request under way affects, every time it says so through its
   * `markAffected` client tool: validated, never empty (see `affected-entities.ts`). For a device
   * that shows what he is working on — the headset, which lights it up where it stands. The phone
   * and the watch leave it out, and the tool is answered on them all the same.
   */
  onAffected?(entities: readonly AffectedEntity[]): void;
}

/** Whatever plays the recorded greeting. */
export interface GreetingPlayer {
  /**
   * Resolves once what is played can be heard where it will be played — a Bluetooth headset's
   * call link coming up, say. Optional; the wait counts as the greeting being asked for, and the
   * clock that gives up on it starts again once it is over. Must not reject for long: a route that
   * never answers is waited out by the player itself.
   */
  untilAudible?(): Promise<void>;
  /** Starts from the beginning; resolves whether it is actually playing. */
  playFromStart(): Promise<boolean>;
  stop(): void;
  /** Seconds into the recording while playing, else −1. */
  position(): number;
  /** The recording's length in seconds, or 0 while the player does not know it yet. */
  readonly duration: number;
}

/**
 * The audio a call runs in, on a device that has to switch into it: a phone and a watch play the
 * greeting as call audio, inside the session the conversation will use, or it is not heard (see
 * `hologram/src/conversation/call-audio.ts`).
 */
export interface CallAudio {
  /** Switches into it, before the greeting plays. */
  start(): Promise<void>;
  /** Lets it go, and puts back what it switched from. */
  stop(): Promise<void>;
}

/**
 * Which of his lines are written down, in a voice conversation. A text-only one writes every line
 * down whatever this says.
 *
 * - `while-writing` — the headset's: while the keyboard is up, or the last thing you said was
 *   typed, until you speak again (`createWrittenCaption`).
 * - `while-typing` — the phone's text mode: while it is switched on, cleared at every switch
 *   (`createTextModeCaption`).
 */
export type CaptionRule = 'while-writing' | 'while-typing';

/** How one summoning is held. */
export interface SummonOptions {
  /**
   * Held in writing on both sides: a signed URL and a socket rather than a token and a room, no
   * recorded greeting, and every line he writes shown and mimed. For a browser whose microphone
   * was refused, which has no audio for a room to wait for (see `requestSignedConversationUrl`).
   */
  textOnly?: boolean;
  /**
   * Called once the greeting has started, or will not — refused, given up on, or the summoning
   * over. A browser holds its microphone open until then, because a tab nobody has clicked may play
   * a sound only while it is using one.
   */
  onGreetingAnswered?: () => void;
}

/**
 * Everything a screen draws from a session, as of its last change.
 *
 * A new object whenever any of it changes and the same one otherwise, so a React screen can hold
 * it with `useSyncExternalStore` and render only when something it shows has moved.
 */
export interface SessionSnapshot {
  readonly phase: SessionPhase;
  /** The SDK's status for the summoning under way, `disconnected` when there is none. */
  readonly status: string;
  /** The SDK's mode for the summoning under way, `listening` when there is none. */
  readonly mode: string;
  /**
   * What the sphere follows, with `listening` and `speaking` as they are now and readers that stay
   * the same functions for as long as their source does.
   */
  readonly voice: JarvisVoice;
  /** Whether that voice is the recorded greeting's. */
  readonly greeting: boolean;
  readonly thinking: boolean;
  /** His last line in writing, as the caption's rules keep it. */
  readonly writtenReply: WrittenReply;
  /** Whether the user is writing rather than talking (see {@link JarvisSession.setTyping}). */
  readonly typing: boolean;
  /** Whether the summoning under way has got as far as dialling. */
  readonly dialled: boolean;
}

export interface JarvisSession {
  /** A summoning: the wake word, a select, the assistant gesture. Single-flight: ignored unless idle, ended or failed. */
  summon(options?: SummonOptions): void;
  /** User dismissal: stop the greeting, end the session (reason 'user'); phase → ended. */
  hangUp(): void;
  /** System ending (hidden, backgrounded, gone): like hangUp, and a late 'error' disconnect is not reported. */
  endQuietly(): void;
  /** Typed line into the connected session (sendUserMessage); ignored unless connected. */
  sendText(text: string): void;
  /** Mutes the microphone while the user writes instead of talking (the phone's text mode). */
  setTyping(typing: boolean): void;
  /**
   * Tells the agent something it should know without answering it — what the user is pointing at,
   * say — as a contextual update. Sent at once while connected. Before that, the latest update for
   * each `contextId` waits for the summoning under way and goes the moment it connects; whatever is
   * still waiting when it ends is dropped, and with no summoning under way nothing is kept. The
   * server keeps only the newest update for a context id, so a holder that says the same kind of
   * thing again says it under the same one.
   */
  sendContextualUpdate(text: string, contextId?: string): void;
  readonly phase: SessionPhase;
  /** What the sphere follows: the greeting envelope while greeting, his live voice after, silence otherwise. */
  readonly voice: JarvisVoice;
  readonly user: UserVoice;
  readonly thinking: boolean;
  /** Everything a screen draws from, as of the last change. */
  readonly snapshot: SessionSnapshot;
  /** Calls `listener` after every change to {@link JarvisSession.snapshot}; returns how to stop. */
  subscribe(listener: () => void): () => void;
  /** Whether his audio output has been silent for at least `seconds` (the headset's re-arm refractory). */
  quietFor(seconds: number): boolean;
  dispose(): void;
}

/**
 * As much of an open conversation as the session calls.
 *
 * Both of the SDK's conversations — `VoiceConversation` and `TextConversation` — have all of it,
 * which is what lets `onConversationCreated` take the SDK's own argument.
 */
export interface SessionConversation {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
  sendUserMessage(text: string): void;
  sendContextualUpdate(text: string, options?: { contextId?: string }): void;
  getInputVolume(): number;
  getOutputVolume(): number;
  getOutputByteFrequencyData(): Uint8Array;
}

/** How a conversation ended, as the SDK's `onDisconnect` reports it. */
export interface SessionEnding {
  /** `user` after `endSession`, `agent` after `end_call` or the agent leaving, `error` otherwise. */
  reason: string;
  /** Only with `error`: what went wrong, in the SDK's (or LiveKit's) words. */
  message?: string;
}

/**
 * How long the SDK waits before dialling, by platform, as its `connectionDelay` option takes it.
 *
 * Left out, the SDK's own default applies: three seconds on anything whose user agent says Android,
 * to let its audio mode settle, and none elsewhere.
 */
export interface ConnectionDelay {
  default: number;
  android: number;
}

/** The callbacks the session dials with, whichever way it dials. */
export interface SessionCallbacks {
  onConversationCreated: (conversation: SessionConversation) => void;
  onStatusChange: (event: { status: string }) => void;
  onModeChange: (event: { mode: string }) => void;
  onVadScore: (event: { vadScore: number }) => void;
  onAgentToolRequest: (event: ToolCallEvent) => void;
  onAgentToolResponse: (event: ToolCallEvent) => void;
  onMCPToolCall: (event: MCPToolCallEvent) => void;
  onInterruption: () => void;
  onMessage: (message: ConversationMessage) => void;
  onError: (message: string) => void;
  onDisconnect: (ending: SessionEnding) => void;
}

/**
 * The client tools the session answers, by name, as the SDK's `clientTools` takes them. Each is
 * handed the parameters exactly as the agent wrote them — model output, hence `unknown` — and
 * returns what the agent is sent back, or nothing for the SDK's own "Client tool execution
 * successful.". A tool that throws is reported to the agent as having failed, so none of them do.
 */
export type SessionClientTools = Record<string, (parameters: unknown) => string | undefined>;

/** A spoken conversation: a token for a WebRTC room. */
export interface VoiceSessionOptions extends SessionCallbacks {
  clientTools: SessionClientTools;
  conversationToken: string;
  connectionType: 'webrtc';
  connectionDelay?: ConnectionDelay;
  overrides?: { agent: { firstMessage: string } };
}

/** A conversation held in writing: a signed URL for a socket (see {@link SummonOptions.textOnly}). */
export interface TextSessionOptions extends SessionCallbacks {
  clientTools: SessionClientTools;
  signedUrl: string;
  connectionType: 'websocket';
  textOnly: true;
  connectionDelay?: ConnectionDelay;
}

/**
 * Exactly the options the session dials with.
 *
 * Every callback takes a structural type that the SDK's own payload satisfies, so this is a valid
 * argument to `Conversation.startSession` as it stands, and a fake can read every field.
 */
export type SessionOptions = VoiceSessionOptions | TextSessionOptions;

/** `Conversation.startSession` from `@elevenlabs/client`, or a fake of it. */
export type StartSession = (options: SessionOptions) => Promise<SessionConversation>;

/**
 * Follows Jarvis's track in `room` and hands over readers for his voice as it is played, or
 * `undefined` while there is no track to read; returns how to stop.
 */
export type FollowAgentVoice = (
  room: AgentTrackRoom,
  onReaders: (readers: JarvisVoiceReaders | undefined) => void,
) => () => void;

/**
 * Everything a session is made from.
 *
 * The timers are handed in, as `createToolActivity`'s are, so that this entry reaches for no clock
 * of its own and a test can step through the greeting and the deadline instead of waiting them out.
 * `Timer` is whatever the platform's `setTimeout` returns — a number in a browser and on a device,
 * an object under Bun.
 */
export interface JarvisSessionDependencies<Timer> {
  /** Read afresh for every token, so a holder can hand over a getter that follows its settings. */
  settings: ElevenLabsSettings;
  /**
   * What this device calls itself in the ElevenLabs conversation history — one of the names in
   * `conversation-token.ts`. Required for the reason given there: a default is how one device
   * ends up filed under another's name.
   */
  participantName: string;
  /** Conversation.startSession from '@elevenlabs/client'. Tests pass a fake. */
  startSession: StartSession;
  greeting: GreetingPlayer;
  events: JarvisSessionEvents;
  setTimeout: (callback: () => void, milliseconds: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  fetch?: typeof fetch;
  /**
   * The clock everything is measured on. The written reply's `readingUntil` is a moment on it, so
   * a screen that compares that with `Date.now()` hands over `Date.now`.
   */
  now?: () => number;
  /** Default true: dial only once the greeting is over. */
  waitsForGreetingBeforeDialling?: boolean;
  /** What the SDK waits before dialling; its own default when left out. See {@link ConnectionDelay}. */
  connectionDelay?: ConnectionDelay;
  /** Whether the half-duplex fallback may take the microphone while he speaks (see `half-duplex.ts`). */
  halfDuplex?: boolean;
  /**
   * Asked at every interruption: whether the half-duplex fallback may count this one. Always yes
   * when left out. The headset says no while his voice comes from where he stands — an echo there
   * moves his voice back to the headset's own speakers first, which the headset watches for itself
   * — and for a few seconds after moving it, while the browser's echo canceller settles on the new
   * sound.
   */
  halfDuplexMayJudge?: () => boolean;
  /** Which of his lines a voice conversation writes down; `while-writing` when left out. */
  captions?: CaptionRule;
  /** What a request that reached no server says, where "the internet connection" can be more exact. */
  offlineProblem?: string;
  /** What the deadline says when it gives up, asked at that moment; `DEADLINE_PROBLEM` when left out. */
  deadlineProblem?: () => string;
  /**
   * The audio the call runs in, on a device that has to switch into it before the greeting (see
   * {@link CallAudio}). Let go once nothing uses it: at once when no conversation was dialled, and
   * otherwise once the conversation has finished ending.
   */
  callAudio?: CallAudio;
  /**
   * Resolves once the device is on a network a conversation can be held over. Asked once the
   * greeting has started or will not, and only then are the token requested and the deadline
   * armed: the watch brings up Wi-Fi here, off the phone's Bluetooth, which carries no audio.
   * Without it, the token is asked for the moment he is summoned.
   */
  untilOnline?: () => Promise<void>;
  /**
   * Lets go of the network `untilOnline` brought up, once the summoning it was brought up for is
   * over, however it ended — including one that ended while the network was still coming up, which
   * is let go of the moment it has.
   */
  leaveNetwork?: () => void;
  /**
   * The LiveKit room an open conversation runs in, checked against the app's own `livekit-client`
   * (see `roomOfConversation`). Without one, his voice is the SDK's own readings and nothing is
   * dropped from a media element when he is interrupted.
   */
  findRoom?: (conversation: object) => AgentTrackRoom | undefined;
  /** How this device listens to his track in that room. Without it, the SDK's own readings. */
  followAgentVoice?: FollowAgentVoice;
  /** Removes the SDK's `<audio>` elements a dropped connection leaves behind, where a page lives on. */
  removeOrphanedAudio?: () => void;
  /**
   * What the agent should know about the device a conversation is held on, said as a contextual
   * update under `DEVICE_CONTEXT_ID` the moment each conversation connects, before anything else
   * the holder has to say. The headset's says it lights up what he is working on and hears what
   * sir points at, which is what the agent's prompt waits for before it calls `markAffected`.
   * Without it nothing is said, as on the phone and the watch.
   */
  deviceContext?: string;
}
