import type {
  AgentTrackRoom,
  ConversationMessage,
  ElevenLabsSettings,
  JarvisVoice,
  JarvisVoiceReaders,
  MCPToolCallEvent,
  ToolCallEvent,
  UserVoice,
} from 'hologram';

/**
 * The shapes the headset's conversation is built from, apart from the code that builds it.
 *
 * Everything the ElevenLabs SDK hands over is named here structurally — no more of it than is
 * read — for the reason `hologram/src/agent-audio-track.ts` gives for LiveKit's room: the session
 * can then be driven in `jarvis-session.spec.ts` by a fake `startSession` and a fake conversation,
 * with no SDK, no room and no browser, while `Conversation.startSession` from `@elevenlabs/client`
 * still fits {@link StartSession} as it is (`agent-room.contract.spec.ts` holds it to that).
 */

/**
 * Where one summoning has got to.
 *
 * `failed` is terminal and separate from `ended`, because the two mean different things in the
 * room: an ending is him leaving, and a failure is a panel saying why, which has to outlive him.
 * Every way a summoning can go wrong before or after it opens ends in `failed`, so nothing is ever
 * left waiting for a conversation that is not coming.
 */
export type SessionPhase = 'idle' | 'greeting' | 'connecting' | 'live' | 'ended' | 'failed';

/** What the session looks like from the debug HUD. */
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
  /** For the HUD. */
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
  /** Wake fired / select summon. Single-flight: ignored unless idle, ended or failed. */
  summon(): void;
  /** User dismissal: stop the greeting, end the session (reason 'user'); phase → ended. */
  hangUp(): void;
  /** System ending (XR hidden / session end): like hangUp, and a late 'error' disconnect is not reported. */
  endQuietly(): void;
  /** Typed line into the live session (sendUserMessage); ignored unless live. */
  sendText(text: string): void;
  /** Mutes the mic while the keyboard is up (phone text mode's rule). */
  setTyping(typing: boolean): void;
  readonly phase: SessionPhase;
  /** What the sphere follows: the greeting envelope while greeting, his live voice after, silence otherwise. */
  readonly voice: JarvisVoice;
  readonly user: UserVoice;
  readonly thinking: boolean;
  /** Whether his audio output has been silent for at least `seconds` (re-arm refractory). */
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
 * Exactly the options the session dials with.
 *
 * Every callback takes a structural type that the SDK's own payload satisfies, so this is a valid
 * argument to `Conversation.startSession` as it stands, and a fake can read every field.
 */
export interface SessionOptions {
  conversationToken: string;
  connectionType: 'webrtc';
  /**
   * No platform delay, anywhere. The SDK waits three seconds before dialling on anything whose
   * user agent says Android, and whether a Quest's does depends on the browser's mode and on how
   * the page was opened; there is nothing on a headset for that wait to protect.
   */
  connectionDelay: { default: number; android: number };
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

/** `Conversation.startSession` from `@elevenlabs/client`'s browser entry, or a fake of it. */
export type StartSession = (options: SessionOptions) => Promise<SessionConversation>;

/**
 * As much of an `AudioContext` as listening to Jarvis's track takes. The app's one context has all
 * of it; naming only this much is what lets a test hand in something that is not a browser's.
 */
export interface ListeningAudioContext {
  readonly sampleRate: number;
  readonly state: string;
  createAnalyser(): AnalyserNode;
  createMediaStreamSource(stream: MediaStream): MediaStreamAudioSourceNode;
  resume(): Promise<void>;
}

/** Everything a session is made from. */
export interface JarvisSessionDependencies {
  settings: ElevenLabsSettings;
  /** Conversation.startSession from '@elevenlabs/client'. Tests pass a fake. */
  startSession: StartSession;
  greeting: GreetingPlayer;
  events: JarvisSessionEvents;
  /** For Jarvis's track analyser; the app's single AudioContext (not the wake engine's 16 kHz one). */
  audioContext: ListeningAudioContext;
  fetch?: typeof fetch;
  now?: () => number;
  setTimeout?: (callback: () => void, milliseconds: number) => number;
  clearTimeout?: (handle: number) => void;
  /** Default true on the headset: dial only once the greeting is over. */
  waitsForGreetingBeforeDialling?: boolean;
  /**
   * The LiveKit room an open conversation runs in. By default the SDK's own, found through
   * `roomOfConversation` and checked against this app's `livekit-client` (`agent-room.ts`).
   */
  findRoom?: (conversation: object) => AgentTrackRoom | undefined;
  /**
   * Follows Jarvis's track in `room` and hands over readers for his voice as it is played, or
   * `undefined` while there is no track to read; returns how to stop. By default an analyser on
   * `audioContext` (`agent-room.ts`).
   */
  followAgentVoice?: (room: AgentTrackRoom, onReaders: (readers: JarvisVoiceReaders | undefined) => void) => () => void;
  /** Removes the SDK's `<audio>` elements a dropped connection leaves behind (`orphaned-audio.ts`). */
  removeOrphanedAudio?: () => void;
}
