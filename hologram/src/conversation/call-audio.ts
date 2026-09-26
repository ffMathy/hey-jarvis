import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { requireOptionalNativeModule } from 'expo';

/** The half of `hologram/android`'s `JarvisGreetingModule` that switches the audio mode. */
interface CallMode {
  enterCallMode(): Promise<void>;
  leaveCallMode(): Promise<void>;
}

/** Absent in a build without the native side, where LiveKit switches the mode as it always did. */
const callMode = requireOptionalNativeModule<CallMode>('JarvisGreeting') ?? undefined;

/** The last start or stop asked for, so the next one waits for it: each is several steps long. */
let lastChange: Promise<void> = Promise.resolve();

function afterLastChange(change: () => Promise<void>): Promise<void> {
  const next = lastChange.then(change, change);
  lastChange = next.catch(() => {
    // Reported to whoever asked for it; the next change still goes ahead.
  });
  return next;
}

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
 * start — so the SDK's speaker-only preference does not move him back.
 *
 * **Call mode is switched first, off the main thread.** LiveKit switches the device into
 * `MODE_IN_COMMUNICATION` as its session starts, on Android's main thread — where Reanimated draws
 * the sphere — and Android takes a noticeable moment over it, which froze him once in every arrival,
 * just as the greeting began. `enterCallMode` does it on a thread of its own and waits for it, so
 * LiveKit then asks for the mode already in force, which changes nothing. That leaves LiveKit
 * remembering call mode as the one to put back, so going back is `stopCallAudio`'s job.
 */
export function startCallAudio(): Promise<void> {
  return afterLastChange(async () => {
    await callMode?.enterCallMode();
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
  });
}

/**
 * Lets go of the call's audio, and puts back the audio mode it was started from.
 *
 * Called whenever it ends: a greeting that never got as far as a conversation, and every
 * conversation that has ended — whose audio the SDK has already stopped by the time it says so, so
 * stopping it again here does nothing.
 *
 * **The order is the point.** LiveKit's `stopAudioSession` returns before it has done anything: it
 * is queued on React Native's bridge, and there it only posts the real stop to the front of the
 * main thread's queue — a stop that puts back call mode, which is what LiveKit found. `leaveCallMode`
 * has to come after that. So a call that *answers* is made on the same bridge queue first
 * (`getAudioOutputs`), which runs after the stop has been posted; `leaveCallMode` then waits its turn
 * on the main thread behind it, and switches back off it.
 */
export function stopCallAudio(): Promise<void> {
  return afterLastChange(async () => {
    await AudioSession.stopAudioSession();
    await AudioSession.getAudioOutputs();
    await callMode?.leaveCallMode();
  });
}
