import { useConversationMode, useConversationStatus, useRawConversation } from '@elevenlabs/react-native';
import { useSdkVoiceReaders } from 'hologram/conversation';
import { useEffect, useMemo, useState } from 'react';
import { type AgentTrackRoom, agentAudioTracks, followAgentTrack, roomOfConversation } from './agent-audio-track';
import type { UseJarvisVoice } from './platform-contracts';
import { createPlayedVoiceReaders, type PlayedAudioSource, readingWindowSize } from './played-voice';

/** An analyser watching one track, and the way to let go of it. */
interface OpenedAudio {
  source: PlayedAudioSource;
  close: () => void;
}

/**
 * Jarvis's audio track in `room` as the browser's own object, which is what Web Audio takes.
 *
 * The check is here rather than beside the room, because it is the browser half of a question the
 * two platforms answer differently: Android turns the same publication into a pair of native ids
 * instead (`agent-audio-track.ts`). Asked before the track has been subscribed, this finds nothing.
 */
function findPlayableTrack(room: AgentTrackRoom): MediaStreamTrack | undefined {
  for (const { mediaStreamTrack } of agentAudioTracks(room)) {
    if (mediaStreamTrack instanceof MediaStreamTrack) {
      return mediaStreamTrack;
    }
  }
  return undefined;
}

/**
 * Points Web Audio at a track the browser is already playing.
 *
 * Nothing is connected to the destination, and that is deliberate: the ElevenLabs SDK attaches
 * this track to a hidden `<audio>` element of its own, so a second path to the speakers would play
 * Jarvis twice. The attachment is also what makes this work at all — Chrome gives a
 * `MediaStreamAudioSourceNode` built from a remote WebRTC track nothing but silence unless the
 * stream is playing through a media element somewhere.
 *
 * A browser with no `AudioContext`, or one that refuses to make another, gets nothing back and the
 * SDK's own readings carry on.
 */
function listenToTrack(track: MediaStreamTrack): OpenedAudio | undefined {
  if (typeof AudioContext === 'undefined') {
    return undefined;
  }

  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = readingWindowSize(context.sampleRate);
    const media = context.createMediaStreamSource(new MediaStream([track]));
    media.connect(analyser);
    // A context made outside a gesture starts suspended, and a suspended context processes
    // nothing. There has always been a gesture by the time a conversation is open, so this
    // succeeds; if it does not, the readings are silence rather than wrong.
    void context.resume();

    return {
      source: {
        sampleRate: () => context.sampleRate,
        sampleCount: () => analyser.fftSize,
        readLatest: (into) => analyser.getFloatTimeDomainData(into),
      },
      close: () => {
        media.disconnect();
        void context.close();
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * The conversation's output audio in a browser, read from the audio itself.
 *
 * It used to be whatever the SDK said — `useAgentVoice`, which is still what the watch uses and
 * still the fallback here. The SDK's volume is the mean of an `AnalyserNode`'s byte spectrum on a
 * −100 dB floor, which never reads silence as silence: the gaps between Jarvis's words stayed well
 * above the tracker's speech threshold, so the sphere stayed agitated and the rim threw chips
 * through them. See `played-voice.ts` for the whole of that argument.
 *
 * So the track is found in the LiveKit room the same way the phone finds it — `agent-audio-track.ts`,
 * shared between them — and analysed with the same code the phone runs on its tapped samples. What
 * differs is only how the samples are come by: natively there, through Web Audio here.
 */
export const useJarvisVoice: UseJarvisVoice = () => {
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  const conversation = useRawConversation();
  const sdkReaders = useSdkVoiceReaders();
  const [agentTrack, setAgentTrack] = useState<MediaStreamTrack | undefined>(undefined);
  const [playedAudio, setPlayedAudio] = useState<PlayedAudioSource | undefined>(undefined);

  useEffect(() => {
    const room = conversation ? roomOfConversation(conversation) : undefined;
    if (!room) {
      setAgentTrack(undefined);
      return;
    }
    return followAgentTrack(room, findPlayableTrack, (one, other) => one === other, setAgentTrack);
  }, [conversation]);

  useEffect(() => {
    if (!agentTrack) {
      return;
    }
    const opened = listenToTrack(agentTrack);
    if (!opened) {
      // Not listenable after all: the SDK's readers carry on.
      return;
    }
    setPlayedAudio(opened.source);
    return () => {
      setPlayedAudio(undefined);
      opened.close();
    };
  }, [agentTrack]);

  // Remade only when the audio behind them is, so they stay the same functions while Jarvis
  // switches between speaking and listening — see `useSdkVoiceReaders` for why that matters.
  const playedReaders = useMemo(() => (playedAudio ? createPlayedVoiceReaders(playedAudio) : undefined), [playedAudio]);
  const readers = playedReaders ?? sdkReaders;

  const listening = status === 'connected';
  return { listening, speaking: listening && mode === 'speaking', ...readers };
};
