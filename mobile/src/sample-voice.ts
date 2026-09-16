import { useIsForeground } from 'hologram/react';
import { useEffect, useMemo, useState } from 'react';
import { jarvisAudio } from '../modules/jarvis-audio';
import { requestMicrophoneAccess } from './microphone-permission';
import type { UseSampleVoice } from './platform-contracts';
import { createTappedVoiceReaders, type VoiceReaders } from './tapped-voice';

const SILENT_READERS: VoiceReaders = { getVolume: () => 0, getSpectrum: () => new Uint8Array(0) };

/**
 * The user's own voice on Android, for sample mode.
 *
 * WebRTC's recorder — the one a conversation uses — is started without a
 * conversation, and what it records is analysed exactly as Jarvis's voice is in
 * one. Nothing is kept or sent: the native side holds the last third of a second
 * and keeps overwriting it.
 *
 * The microphone is only open while the screen is mounted and the app is in
 * front. Leaving either closes it at once, and synchronously, so it has let go
 * before whatever comes next asks for it.
 */
export const useSampleVoice: UseSampleVoice = () => {
  const isForeground = useIsForeground();
  const [access, setAccess] = useState<'asking' | 'granted' | 'denied'>('asking');
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // Asked once a visit, and not tied to being in front. The permission dialog is
  // an activity of its own, so it sends the app to the background and back; a
  // question asked again on every return would throw each answer away and ask
  // again at once — and two refusals make Android's refusal permanent, for the
  // conversation later as well as for this.
  useEffect(() => {
    let isMounted = true;
    void requestMicrophoneAccess().then((granted) => {
      if (isMounted) {
        setAccess(granted ? 'granted' : 'denied');
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const audio = jarvisAudio;
    if (!audio) {
      setProblem('This build has no way to reach the microphone.');
      return;
    }
    if (access === 'denied') {
      setProblem('The hologram needs the microphone to hear you.');
      return;
    }
    if (access !== 'granted' || !isForeground) {
      return;
    }

    try {
      audio.startMicrophone();
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'The microphone could not be started.');
      return;
    }
    setProblem(undefined);
    setListening(true);

    return () => {
      audio.stopMicrophone();
      setListening(false);
    };
  }, [access, isForeground]);

  const readers = useMemo(() => (jarvisAudio ? createTappedVoiceReaders(jarvisAudio) : SILENT_READERS), []);
  const voice = useMemo(() => ({ listening, speaking: listening, ...readers }), [listening, readers]);

  return { voice, problem };
};
