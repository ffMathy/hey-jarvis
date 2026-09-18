import { useConversationMode, useConversationStatus } from '@elevenlabs/react-native';
import type { JarvisVoice } from '../voice-contract';
import { useSdkVoiceReaders } from './sdk-voice-readers';

/**
 * Jarvis's voice as the ElevenLabs SDK hears it, which is all the hologram needs to follow him.
 *
 * Two flags out of the conversation's own state and two readers out of the SDK's analysers. It is
 * the whole of the voice on every surface that has no better source: **a browser**, where the SDK
 * uses Web Audio's `AnalyserNode` and reads it well, and **the watch**, which has no native audio
 * tap of its own.
 *
 * The phone does have one (`mobile/src/jarvis-voice.ts`) and prefers it, because LiveKit's
 * processors on Android report a mostly-empty spectrum and a volume with the bytes of each sample
 * swapped — see "The hologram on a device" in mobile/AGENTS.md. A sphere drawn from these on a
 * phone turns and flashes rather than following a voice. On a watch that trade is worth taking
 * anyway: tapping the track means a native module, a WebRTC peer-connection id and a ring buffer,
 * and the watch is not where that complexity earns its keep yet.
 */
export function useAgentVoice(): JarvisVoice {
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  const readers = useSdkVoiceReaders();

  const listening = status === 'connected';
  return { listening, speaking: listening && mode === 'speaking', ...readers };
}
