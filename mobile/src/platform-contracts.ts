/**
 * The shapes the platform-split modules have to keep.
 *
 * A few things in this app genuinely differ between a phone and a browser, and
 * each is a pair of files Metro picks between by platform: `key-value-store.ts`
 * against `key-value-store.web.ts`, `microphone-permission.ts` against
 * `microphone-permission.web.ts`, the voice the hologram listens to —
 * `jarvis-voice.ts`, with a `.web.ts` beside it — and the camera, `take-photo.ts`
 * against `take-photo.web.ts`.
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
import type { FollowAgentVoice, JarvisVoice } from 'hologram';

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

/**
 * How this platform listens to Jarvis's track in the conversation's LiveKit room, for the session's
 * `followAgentVoice`: natively on Android, through Web Audio in a browser.
 */
export type FollowJarvisVoice = FollowAgentVoice;

/**
 * The voice the sphere follows in a conversation, given the session's. Both platforms hand the
 * session's straight back; it is a hook of its own so the emulator check can swap in a recording.
 */
export type UseJarvisVoice = (sessionVoice: JarvisVoice) => JarvisVoice;

/**
 * Moves the conversation onto a headset, if one is connected, for as long as `inCall` is true.
 *
 * Both halves of it: on Android the call's output and its *input* are one route, so sending the
 * audio to a pair of AirPods is also what makes Jarvis listen through their microphone rather than
 * through the phone's. Which is the whole point — a phone in your pocket hears your pocket.
 */
export type UsePreferredHeadset = (inCall: boolean) => void;

/**
 * Takes one photo for Jarvis, and resolves with it as a JPEG ready to send — or `undefined` when
 * none was taken.
 *
 * On a phone it is the phone's own camera app, reached from wherever the conversation is drawn:
 * `inAssistantWindow` says whether that is the assistant's window, which has to make way for it.
 * In a browser it is the file picker, which a phone's browser opens on its camera.
 *
 * **Call it straight from a tap, before anything is awaited.** A browser opens its picker only
 * inside the gesture that asked for it, so a call that comes after an `await` in the press handler
 * is refused without a word. A phone does not mind either way.
 */
export type TakePhoto = (options: {
  inAssistantWindow: boolean;
  /**
   * Whether the conversation is still open, asked once the camera has closed: the assistant's window
   * was put away for it and comes back only to a conversation that is.
   */
  stillTalking: () => boolean;
}) => Promise<Blob | undefined>;
