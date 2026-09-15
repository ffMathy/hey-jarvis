import { useConversationMode, useConversationStatus, useRawConversation } from '@elevenlabs/react-native';
import { useEffect, useMemo, useState } from 'react';
import { jarvisAudio } from '../modules/jarvis-audio';
import { followAgentAudioTrack, type NativeTrackIds, roomOfConversation } from './agent-audio-track';
import type { UseJarvisVoice } from './platform-contracts';
import { useSdkVoiceReaders } from './sdk-voice-readers';
import { createTappedVoiceReaders } from './tapped-voice';

/**
 * The conversation's output audio on Android.
 *
 * Read from Jarvis's own WebRTC track: `modules/jarvis-audio` keeps the samples
 * that play on it, and `tapped-voice.ts` analyses them the way a browser would.
 * The SDK's own readers are only the fallback, until that track is found or if
 * it cannot be. They come from LiveKit's processors, whose spectrum is mostly
 * empty and whose volume reads the bytes of each sample swapped (see "The
 * hologram on a device" in mobile/AGENTS.md), so a hologram drawn from them
 * turns and flashes rather than following his voice.
 *
 * One module, so it can be swapped whole: `.scripts/verify-hologram-on-emulator.sh`
 * can build the app with `tests/hologram-preview/jarvis-voice.replay.ts` in its
 * place, since an emulator has no ElevenLabs session to listen to.
 */
export const useJarvisVoice: UseJarvisVoice = () => {
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  const conversation = useRawConversation();
  const sdkReaders = useSdkVoiceReaders();
  const [agentTrack, setAgentTrack] = useState<NativeTrackIds | undefined>(undefined);
  const [isTapped, setIsTapped] = useState(false);

  useEffect(() => {
    const room = conversation ? roomOfConversation(conversation) : undefined;
    if (!room) {
      setAgentTrack(undefined);
      return;
    }
    return followAgentAudioTrack(room, setAgentTrack);
  }, [conversation]);

  useEffect(() => {
    const audio = jarvisAudio;
    if (!audio || !agentTrack) {
      return;
    }
    try {
      audio.listenToTrack(agentTrack.peerConnectionId, agentTrack.trackId);
    } catch {
      // Not found natively after all: the SDK's readers carry on.
      return;
    }
    setIsTapped(true);
    return () => {
      audio.stopListeningToTrack();
      setIsTapped(false);
    };
  }, [agentTrack]);

  // Made once, so they stay the same functions for the life of the screen — see
  // `useSdkVoiceReaders` for why that matters.
  const tappedReaders = useMemo(() => (jarvisAudio ? createTappedVoiceReaders(jarvisAudio) : undefined), []);
  const readers = isTapped && tappedReaders ? tappedReaders : sdkReaders;

  const listening = status === 'connected';
  return { listening, speaking: listening && mode === 'speaking', ...readers };
};
