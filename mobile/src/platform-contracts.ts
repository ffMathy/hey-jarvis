/**
 * The shapes the platform-split modules have to keep.
 *
 * A few things in this app genuinely differ between a phone and a browser, and
 * each is a pair of files Metro picks between by platform: `key-value-store.ts`
 * against `key-value-store.web.ts`, `microphone-permission.ts` against
 * `microphone-permission.web.ts`, and the two voices the hologram listens to —
 * `jarvis-voice.ts` and `sample-voice.ts`, each with a `.web.ts` beside it.
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
 * Asks for the microphone up front, and says whether it was given.
 *
 * Up front because WebRTC would otherwise ask in the middle of connecting, and a
 * refusal then surfaces as a failed connection rather than as the permission
 * question it actually was.
 */
export type RequestMicrophoneAccess = () => Promise<boolean>;

/** Jarvis's voice in the open conversation, if there is one. Must be used inside the ElevenLabs `ConversationProvider`. */
export type UseJarvisVoice = () => JarvisVoice;

/** The user's own voice, for sample mode, and why it cannot be heard if it cannot. */
export interface SampleVoice {
  voice: JarvisVoice;
  problem: string | undefined;
}

/**
 * Opens the microphone while the calling component is mounted and `listening` is true, and closes
 * it the moment either stops being so.
 *
 * `listening` is not an optimisation. Sample mode can show Jarvis speaking, thinking or idle
 * without hearing anything, and holding the microphone open through those would leave a browser's
 * recording light on — and a phone's — while nothing is being listened to.
 */
export type UseSampleVoice = (listening: boolean) => SampleVoice;
