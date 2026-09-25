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
 * The configuration is the one `@elevenlabs/react-native` applies as a session starts
 * (`reactNativeSessionSetup`), so when the session does start, LiveKit is already where the SDK was
 * going to put it: its `start` does nothing on an audio session already running, and the SDK stops
 * it as usual when the conversation ends.
 */
export async function startCallAudio(): Promise<void> {
  await AudioSession.configureAudio({
    android: {
      preferredOutputList: ['speaker'],
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
