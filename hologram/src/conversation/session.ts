import { Conversation } from '@elevenlabs/client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { AgentTrackRoom } from '../agent-audio-track';
import type { ElevenLabsSettings } from '../elevenlabs-settings';
import { DEADLINE_PROBLEM } from '../failure-text';
import { createJarvisSession } from '../jarvis-session';
import type {
  CaptionRule,
  ClientTools,
  FollowAgentVoice,
  GreetingPlayer,
  ProblemSource,
  SessionSnapshot,
  StartSession,
  SummonOptions,
} from '../session-contract';
import type { MCPToolCallEvent } from '../tool-activity';
import type { UserVoice } from '../voice-contract';
import { startCallAudio, stopCallAudio } from './call-audio';
import { useGreetingPlayer } from './greeting-player';

/** What a screen tells the session it holds: who is asking, and how this device differs. */
export interface JarvisSessionOptions {
  /** Read afresh for every token, so a change reaches the next summoning. */
  settings: ElevenLabsSettings;
  /** What this device calls itself in the ElevenLabs history — see `conversation-token.ts`. */
  participantName: string;
  /** Told every problem that ends a summoning, and where it came from. */
  onProblem: (message: string, source: ProblemSource) => void;
  /** Read once, when the session is made: the device's check that a room is its own `Room`. */
  findRoom?: (conversation: object) => AgentTrackRoom | undefined;
  /** Read once: how the device listens to his track. Without it, the SDK's own readings. */
  followAgentVoice?: FollowAgentVoice;
  /** Read once: which of his lines a voice conversation writes down. */
  captions?: CaptionRule;
  /** What the deadline says when it gives up, asked at that moment. */
  deadlineProblem?: () => string;
  /** Resolves once the device is on a network that carries a conversation (the watch's Wi-Fi). */
  untilOnline?: () => Promise<void>;
  /** Lets go of that network once the summoning is over. */
  leaveNetwork?: () => void;
  /** Read at every dial: the agent's client tools as this device answers them. See `ClientTools`. */
  clientTools?: ClientTools;
  /** Told every MCP tool call the agent makes (the phone's camera takes its upload URL from one). */
  onMCPToolCall?: (event: MCPToolCallEvent) => void;
}

/** Everything a screen draws from its conversation, and everything it can do to it. */
export interface JarvisConversation extends SessionSnapshot {
  /** The person talking to him, for the listening lattice: one object for the life of the screen. */
  user: UserVoice;
  summon(options?: SummonOptions): void;
  hangUp(): void;
  endQuietly(): void;
  sendText(text: string): void;
  setTyping(typing: boolean): void;
  sendContextualUpdate(text: string): void;
  sendUserActivity(): void;
}

/** `Conversation.startSession`, called as a plain function, which is all the SDK asks of it. */
const startSession: StartSession = (options) => Conversation.startSession(options);

/**
 * The greeting's player as the session holds it: whichever the screen rendered last, so a player
 * remade by its hook is the one played. Whether there is a headset's link to wait for is the
 * platform's, and so is decided by the first one.
 */
function latestOf(player: () => GreetingPlayer): GreetingPlayer {
  const waitsForRoute = player().untilAudible !== undefined;
  return {
    ...(waitsForRoute ? { untilAudible: () => player().untilAudible?.() ?? Promise.resolve() } : {}),
    playFromStart: () => player().playFromStart(),
    stop: () => player().stop(),
    position: () => player().position(),
    get duration() {
      return player().duration;
    },
  };
}

/**
 * Jarvis's conversation, held by a screen: `createJarvisSession` from the main entry — the one the
 * headset runs too — with what a phone and a watch hand it, read into React.
 *
 * **The session is the rules; this is only the wiring.** One start at a time, stale callbacks
 * dropped, failures in words, the deadline that ends what it gives up on, the greeting's mute, the
 * captions: all of it is the main entry's, pinned by its specs, and nothing here decides any of it.
 * What is here is what only a React Native screen has: the SDK's client itself
 * (`Conversation.startSession` from `@elevenlabs/client`, the very copy `@elevenlabs/react-native`
 * registers its native session strategy on — the app still imports that package first, for its
 * side effects), the greeting's player, the call's audio on a device (`call-audio.ts`), and a
 * snapshot held with `useSyncExternalStore`, so the screen renders when something it shows has
 * moved and not otherwise.
 *
 * **Why not the SDK's React provider.** The provider reports any `onError` as the conversation's
 * status, so a non-fatal error once connected made Jarvis fade out while his voice played on; its
 * screens bounded the wait for a conversation to open themselves, and a late connection was never
 * ended; and its errors reached the screen in the SDK's and LiveKit's own words. The session gets
 * all three right for every device.
 *
 * **The platform differences are the session's options.** A device plays the greeting inside the
 * call's audio and dials only once he has finished; a browser dials behind him, muted until he
 * has. Both are decided here, by platform, so a screen does not have to know.
 *
 * The session lasts as long as the screen: leaving it ends the conversation, quietly.
 */
export function useJarvisSession(options: JarvisSessionOptions): JarvisConversation {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const player = useGreetingPlayer();
  const latestPlayer = useRef(player);
  useEffect(() => {
    latestPlayer.current = player;
  }, [player]);

  const [session] = useState(() => {
    const { findRoom, followAgentVoice, captions, untilOnline } = latest.current;
    const onADevice = Platform.OS !== 'web';
    return createJarvisSession({
      get settings() {
        return latest.current.settings;
      },
      participantName: latest.current.participantName,
      startSession,
      greeting: latestOf(() => latestPlayer.current),
      events: {
        onProblem: (message, source) => latest.current.onProblem(message, source),
        onMCPToolCall: (event) => latest.current.onMCPToolCall?.(event),
      },
      get clientTools() {
        return latest.current.clientTools;
      },
      setTimeout: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
      // A wall clock, because the screen compares the written reply's `readingUntil` with one.
      now: () => Date.now(),
      waitsForGreetingBeforeDialling: onADevice,
      ...(onADevice ? { callAudio: { start: startCallAudio, stop: stopCallAudio } } : {}),
      ...(findRoom ? { findRoom } : {}),
      ...(followAgentVoice ? { followAgentVoice } : {}),
      ...(captions ? { captions } : {}),
      deadlineProblem: () => latest.current.deadlineProblem?.() ?? DEADLINE_PROBLEM,
      ...(untilOnline ? { untilOnline: () => latest.current.untilOnline?.() ?? Promise.resolve() } : {}),
      leaveNetwork: () => latest.current.leaveNetwork?.(),
    });
  });
  useEffect(() => () => session.endQuietly(), [session]);

  const snapshot = useSyncExternalStore(session.subscribe, () => session.snapshot);
  const actions = useMemo(
    () => ({
      user: session.user,
      summon: session.summon,
      hangUp: session.hangUp,
      endQuietly: session.endQuietly,
      sendText: session.sendText,
      setTyping: session.setTyping,
      sendContextualUpdate: session.sendContextualUpdate,
      sendUserActivity: session.sendUserActivity,
    }),
    [session],
  );
  return { ...snapshot, ...actions };
}
