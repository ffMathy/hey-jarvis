/**
 * What the sphere is told about a voice.
 *
 * Here rather than in either app because both of them draw from it and neither owns it — the
 * phone reads Jarvis's WebRTC track or its own microphone, the watch reads the watch's, and a
 * browser reads an AnalyserNode. The drawing never learns which.
 */

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
