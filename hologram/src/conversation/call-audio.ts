import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';

/**
 * Puts a phone or a watch into the audio a conversation uses, before there is a conversation.
 *
 * **So the greeting plays where Jarvis is about to talk.** The greeting is played as call audio
 * (`greeting-player.ts`), and call audio goes where this session routes it: the speaker, at call
 * volume. Starting it first also means nothing switches under him mid-word when the conversation
 * takes over — which, dialled behind him, was heard as the recording turning thin and clipping.
 * On its own it was not enough: a recording still played as media inside it was not heard on a
 * phone.
 *
 * **On the headset, if there is one.** The SDK starts its session preferring the speaker alone, and
 * the phone app moves the call onto a headset only once it has connected (`usePreferredHeadset`).
 * Started that way here, the greeting came out of the phone's speaker and the conversation after
 * it out of the AirPods. So this prefers a Bluetooth headset, then a wired one, then the speaker —
 * LiveKit's own default order — and the greeting goes where the conversation will.
 *
 * Otherwise it is the configuration `@elevenlabs/react-native` applies as a session starts
 * (`reactNativeSessionSetup`). When the session does start, LiveKit's `start` does nothing on an
 * audio session already running — and its `configureAudio` only records settings for the next
 * start — so the SDK's speaker-only preference does not move him back. The SDK stops the session as
 * usual when the conversation ends.
 */
export async function startCallAudio(): Promise<void> {
  await AudioSession.configureAudio({
    android: {
      preferredOutputList: ['bluetooth', 'headset', 'speaker'],
      audioTypeOptions: AndroidAudioTypePresets.communication,
    },
    ios: {
      defaultOutput: 'speaker',
    },
  });
  await AudioSession.startAudioSession();
}

/** Lets go of the call's audio again, for a greeting that never got as far as a conversation. */
export function stopCallAudio(): Promise<void> {
  return AudioSession.stopAudioSession();
}
