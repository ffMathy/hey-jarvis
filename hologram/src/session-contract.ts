import type { AgentTrackRoom } from './agent-audio-track';
import type { ElevenLabsSettings } from './elevenlabs-settings';
import type { MCPToolCallEvent, ToolCallEvent } from './tool-activity';
import type { JarvisVoice, JarvisVoiceReaders, UserVoice } from './voice-contract';
import type { ConversationMessage } from './written-reply';

/**
 * The shapes a conversation with Jarvis is built from, apart from the code that builds it.
 *
 * Everything the ElevenLabs SDK hands over is named here structurally — no more of it than is
 * read — for the reason `agent-audio-track.ts` gives for LiveKit's room: the session can then be
 * driven in `jarvis-session.spec.ts` by a fake `startSession` and a fake conversation, with no SDK,
 * no room and no device, while `Conversation.startSession` from `@elevenlabs/client` still fits
 * {@link StartSession} as it is (each app's contract spec holds its own copy of the SDK to that).
 * Whatever differs between the devices that hold one — how his track is listened to, how the
 * greeting is played, what a timer is — is handed in, so nothing here reaches for a platform.
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

export interface JarvisSessionEvents {
  onPhase(phase: SessionPhase): void;
  /** A readable problem (token failure, deadline, dropped connection…). Always followed by phase 'failed'. */
  onProblem(message: string): void;
  /** His latest line in writing (for captions), when the written-reply logic says to show it. */
  onCaption(text: string | undefined): void;
  /** For a diagnostics display. */
  onDiagnostics?(diagnostics: SessionDiagnostics): void;
}

export interface GreetingPlayer {
  /** Starts from the beginning; resolves whether it is actually playing. */
  playFromStart(): Promise<boolean>;
  stop(): void;
  /** Seconds into the recording while playing, else −1. */
  position(): number;
  /** The recording's length in seconds, or 0 while the player does not know it yet. */
  readonly duration: number;
}

export interface JarvisSession {
  /** A summoning: the wake word, a select, the assistant gesture. Single-flight: ignored unless idle, ended or failed. */
  summon(): void;
  /** User dismissal: stop the greeting, end the session (reason 'user'); phase → ended. */
  hangUp(): void;
  /** System ending (hidden, backgrounded, gone): like hangUp, and a late 'error' disconnect is not reported. */
  endQuietly(): void;
  /** Typed line into the live session (sendUserMessage); ignored unless live. */
  sendText(text: string): void;
  /** Mutes the microphone while the user writes instead of talking (the phone's text mode). */
  setTyping(typing: boolean): void;
  readonly phase: SessionPhase;
  /** What the sphere follows: the greeting envelope while greeting, his live voice after, silence otherwise. */
  readonly voice: JarvisVoice;
  readonly user: UserVoice;
  readonly thinking: boolean;
  /** Whether his audio output has been silent for at least `seconds` (the headset's re-arm refractory). */
  quietFor(seconds: number): boolean;
  dispose(): void;
}

/**
 * As much of an open conversation as the session calls.
 *
 * Both of the SDK's conversations — `VoiceConversation` and `TextConversation` — have all of it,
 * which is what lets {@link SessionOptions.onConversationCreated} take the SDK's own argument.
 */
export interface SessionConversation {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
  sendUserMessage(text: string): void;
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

/**
 * Exactly the options the session dials with.
 *
 * Every callback takes a structural type that the SDK's own payload satisfies, so this is a valid
 * argument to `Conversation.startSession` as it stands, and a fake can read every field.
 */
export interface SessionOptions {
  conversationToken: string;
  connectionType: 'webrtc';
  connectionDelay?: ConnectionDelay;
  overrides?: { agent: { firstMessage: string } };
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
  now?: () => number;
  /** Default true: dial only once the greeting is over. */
  waitsForGreetingBeforeDialling?: boolean;
  /** What the SDK waits before dialling; its own default when left out. See {@link ConnectionDelay}. */
  connectionDelay?: ConnectionDelay;
  /** Whether the half-duplex fallback may take the microphone while he speaks (see `half-duplex.ts`). */
  halfDuplex?: boolean;
  /** What a request that reached no server says, where "the internet connection" can be more exact. */
  offlineProblem?: string;
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
}
