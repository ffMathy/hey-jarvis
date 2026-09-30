/**
 * Jarvis's conversation on the headset: the ElevenLabs session from summon to ending, the recorded
 * greeting he answers with, his voice and yours for the hologram, and what he is thinking about.
 *
 * Built on the SDK's own client (`Conversation.startSession` from `@elevenlabs/client`) and on
 * hologram's framework-free halves of the phone's conversation — the token request, the rules for
 * the greeting, the tool calls, the voice-activity score, the played voice, the agent's track and
 * the written reply — so the headset and the phone answer every question about a conversation the
 * same way. See `jarvis-session.ts` for the session itself.
 */
export { createGreetingPlayer, type GreetingElement, type PrimableGreetingPlayer } from './greeting-player';
export { greetingRecordingUrl } from './greeting-recording';
export { createJarvisSession } from './jarvis-session';
export type {
  GreetingPlayer,
  JarvisSession,
  JarvisSessionDependencies,
  JarvisSessionEvents,
  ListeningAudioContext,
  SessionConversation,
  SessionDiagnostics,
  SessionEnding,
  SessionOptions,
  SessionPhase,
  StartSession,
} from './session-contract';
