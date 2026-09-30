import { jarvisAudio } from '../modules/jarvis-audio';
import { followAgentAudioTrack } from './agent-audio-track';
import type { FollowJarvisVoice, UseJarvisVoice } from './platform-contracts';
import { createTappedVoiceReaders } from './tapped-voice';

/**
 * Jarvis's voice on Android, read from his own WebRTC track.
 *
 * `modules/jarvis-audio` keeps the samples that play on the track and `tapped-voice.ts` analyses
 * them the way a browser would. Until the track is found, or if it cannot be listened to, the
 * session falls back to the SDK's own readers — LiveKit's processors, whose spectrum is mostly empty
 * and whose volume reads the bytes of each sample swapped (see "The hologram on a device" in
 * mobile/AGENTS.md), so a sphere drawn from them turns and flashes rather than following his voice.
 *
 * Handed to the session as its `followAgentVoice`, which calls it once his room is found and stops
 * it when the conversation is over. The room comes checked against this app's own `Room`
 * (`roomOfConversation` in `agent-audio-track.ts`).
 */
export const followJarvisVoice: FollowJarvisVoice = (room, onReaders) => {
  const audio = jarvisAudio;
  if (!audio) {
    return () => undefined;
  }
  const tapped = createTappedVoiceReaders(audio);
  let listening = false;

  const stopListening = () => {
    if (listening) {
      listening = false;
      audio.stopListeningToTrack();
    }
  };

  const stopFollowing = followAgentAudioTrack(room, (track) => {
    if (listening) {
      stopListening();
      onReaders(undefined);
    }
    if (!track) {
      return;
    }
    try {
      audio.listenToTrack(track.peerConnectionId, track.trackId);
    } catch {
      // Not found natively after all: the SDK's readers carry on.
      return;
    }
    listening = true;
    onReaders(tapped);
  });

  return () => {
    stopFollowing();
    stopListening();
  };
};

/**
 * The voice the sphere follows in a conversation: the session's own, which already follows his
 * track through {@link followJarvisVoice}.
 *
 * Here so the whole voice can be swapped in one place: `.scripts/verify-hologram-on-emulator.sh`
 * builds the app with `tests/hologram-preview/jarvis-voice.replay.ts` in this module's place, since
 * an emulator has no ElevenLabs session to listen to.
 */
export const useJarvisVoice: UseJarvisVoice = (voice) => voice;
