/**
 * The shapes the platform-split modules have to keep.
 *
 * A few things in this app genuinely differ between a phone and a browser, and
 * each is a pair of files Metro picks between by platform: `key-value-store.ts`
 * against `key-value-store.web.ts`, `microphone-permission.ts` against
 * `microphone-permission.web.ts`, and the voice the hologram listens to —
 * `jarvis-voice.ts`, with a `.web.ts` beside it.
 *
 * The contracts live here rather than in either implementation so that neither
 * half can drift: nothing else in the app would notice if the web one grew an
 * argument the native one does not take, because nothing else imports both.
 */

/**
 * The voice contract itself lives in the `hologram` package, because the sphere is what reads
 * it and the sphere is shared with the watch. Re-exported here so the rest of the app carries on
 * asking this file what a voice looks like.
 */
import type { JarvisVoice } from 'hologram';

export type { JarvisVoice };

export type ReadStoredValue = (key: string) => Promise<string | undefined>;

export type WriteStoredValue = (key: string, value: string) => Promise<void>;

/**
 * A microphone that was given, and may still be held open by the asking.
 *
 * A browser holds it, because a page using the microphone may play sound without
 * a click and the recorded greeting starts before the session opens a stream of
 * its own. `release` lets go of it once the greeting has started; see
 * `microphone-permission.web.ts`. On a phone there is nothing to let go of.
 */
export interface MicrophoneAccess {
  release: () => void;
}

/**
 * Asks for the microphone up front, and says whether it was given: `undefined`
 * if it was not.
 *
 * Up front because WebRTC would otherwise ask in the middle of connecting, and a
 * refusal then surfaces as a failed connection rather than as the permission
 * question it actually was.
 */
export type RequestMicrophoneAccess = () => Promise<MicrophoneAccess | undefined>;

/** Jarvis's voice in the open conversation, if there is one. Must be used inside the ElevenLabs `ConversationProvider`. */
export type UseJarvisVoice = () => JarvisVoice;

/**
 * Moves the conversation onto a headset, if one is connected, for as long as `inCall` is true.
 *
 * Both halves of it: on Android the call's output and its *input* are one route, so sending the
 * audio to a pair of AirPods is also what makes Jarvis listen through their microphone rather than
 * through the phone's. Which is the whole point — a phone in your pocket hears your pocket.
 */
export type UsePreferredHeadset = (inCall: boolean) => void;
