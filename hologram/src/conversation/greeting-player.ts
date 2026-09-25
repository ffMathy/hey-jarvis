import { requireOptionalNativeModule } from 'expo';
import { useMemo } from 'react';
import { Image } from 'react-native';
import { GREETING_SOUND } from './greeting-sound';

/** What the greeting needs of whatever plays the recording. */
export interface GreetingPlayer {
  /**
   * Resolves once what is played can be heard where it will be played — at once, unless a headset's
   * call audio is still coming up. Never rejects: a route that does not answer is waited out.
   */
  untilAudible(): Promise<void>;
  /** Plays from the start. Resolves whether it is playing, which is false if it could not. */
  playFromStart(): Promise<boolean>;
  pause(): void;
  /** Whether it is audibly playing right now. */
  readonly playing: boolean;
  /** Where it is in the recording, in seconds. */
  readonly currentTime: number;
  /** How long the recording is, in seconds, or 0 while that is not known. */
  readonly duration: number;
}

/** `hologram/android`'s `JarvisGreetingModule`. */
interface JarvisGreeting {
  untilCallRouteReady(timeoutMs: number): Promise<boolean>;
  play(source: string): Promise<void>;
  pause(): void;
  isPlaying(): boolean;
  currentTime(): number;
  duration(): number;
}

/**
 * The longest a greeting waits for a Bluetooth headset's call audio to come up.
 *
 * Long enough for AirPods to switch from music to the headset profile, which takes about a second;
 * short enough that a headset which never answers costs a pause rather than the greeting. It has
 * to stay under the greeting's own grace — `isGreetingOver` gives up on a greeting its length plus
 * `GREETING_GRACE_SECONDS` after it was asked for — or he would be given up on while waiting.
 */
const WAIT_FOR_HEADSET_MS = 2500;

/**
 * Absent in a build without the native side. The greeting then does not play, and the agent keeps
 * its own first message, so he still greets — in the voice he answers in.
 */
const jarvisGreeting = requireOptionalNativeModule<JarvisGreeting>('JarvisGreeting') ?? undefined;

/**
 * The recording on a phone and a watch: played as call audio, by `hologram/android`.
 *
 * **Not through expo-audio, which is what it used to be.** expo-audio plays as media
 * (`USAGE_MEDIA`), and on a phone the greeting was not heard that way — not on its own, and not
 * inside the call's audio session started before it either. The native player plays it with the attributes the call's
 * own audio has, so it goes where Jarvis's voice goes. See `JarvisGreetingModule.kt`.
 */
export function useGreetingPlayer(): GreetingPlayer {
  return useMemo(() => {
    const module = jarvisGreeting;
    // A Metro URL in a development build, a raw resource's name in a release one.
    const source = Image.resolveAssetSource(GREETING_SOUND)?.uri;
    return {
      untilAudible: async () => {
        // A headset's call link takes a moment, and played into before it is up, AirPods lost the
        // first word. See `untilCallRouteReady` in `JarvisGreetingModule.kt`.
        await module?.untilCallRouteReady(WAIT_FOR_HEADSET_MS).catch(() => false);
      },
      playFromStart: async () => {
        if (!module || !source) {
          return false;
        }
        try {
          await module.play(source);
          return true;
        } catch {
          return false;
        }
      },
      pause: () => module?.pause(),
      get playing() {
        return module?.isPlaying() ?? false;
      },
      get currentTime() {
        return module?.currentTime() ?? 0;
      },
      get duration() {
        return module?.duration() ?? 0;
      },
    };
  }, []);
}
