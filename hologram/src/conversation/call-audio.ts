import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';

/**
 * Puts a phone or a watch into the audio a conversation uses, before there is a conversation.
 *
 * **This is what makes the greeting audible at all.** Played as ordinary media it was heard on a
 * phone only from the moment LiveKit's audio session started under it — a second in, thin and
 * clipped — and once the session was held back until the greeting had finished, not at all. So
 * the device is put into the call's audio first, and the greeting plays inside it: on the speaker,
 * at the volume Jarvis is about to talk at, with nothing changing under him mid-word.
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
