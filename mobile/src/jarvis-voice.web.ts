import { useConversationMode, useConversationStatus } from '@elevenlabs/react-native';
import type { UseJarvisVoice } from './platform-contracts';
import { useSdkVoiceReaders } from './sdk-voice-readers';

/**
 * The conversation's output audio in a browser: the SDK measures it with Web
 * Audio's `AnalyserNode`, which reads it well, so it is used as it comes.
 */
export const useJarvisVoice: UseJarvisVoice = () => {
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  const readers = useSdkVoiceReaders();

  const listening = status === 'connected';
  return { listening, speaking: listening && mode === 'speaking', ...readers };
};
