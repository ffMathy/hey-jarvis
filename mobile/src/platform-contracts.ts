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

/**
 * A voice, as far as anything drawn from it needs to know: whether to listen,
 * and how to read it. The hologram polls the two readers about every 40 ms.
 */
export interface JarvisVoice {
  /** Whether there is anything to listen to. Nothing is read from the voice otherwise. */
  listening: boolean;
  /** Whether the voice is talking right now, rather than merely there to be listened to. */
  speaking: boolean;
  /**
   * Volume, 0–1. On Android the RMS of the last 40 ms; in a browser, as the
   * ElevenLabs web SDK reports it, the mean of the voice-range spectrum.
   */
  getVolume: () => number;
  /** Byte spectrum, 0–255 per value across 100–8000 Hz. Empty when there is nothing to report. */
  getSpectrum: () => ArrayLike<number>;
}

/** Jarvis's voice in the open conversation, if there is one. Must be used inside the ElevenLabs `ConversationProvider`. */
export type UseJarvisVoice = () => JarvisVoice;

/** The user's own voice, for sample mode, and why it cannot be heard if it cannot. */
export interface SampleVoice {
  voice: JarvisVoice;
  problem: string | undefined;
}

/** Opens the microphone while the calling component is mounted, and closes it when it unmounts. */
export type UseSampleVoice = () => SampleVoice;
