import type { JarvisVoice } from 'hologram';

/** Nothing to hear, so nothing to report. Shared: the sphere never writes to it. */
const NOTHING: readonly number[] = [];

/**
 * A voice that is not there, which is what the watch has for now.
 *
 * The sphere takes a `JarvisVoice` and asks it two questions every 40 ms. Given this one it
 * idles: turning, materialising once at startup, never brightening. That is deliberately the
 * first thing to put on a watch, because it answers the question the watch app exists to answer —
 * can this hardware draw Jarvis at a frame rate worth looking at — without a microphone, a
 * permission prompt or an ElevenLabs account in the way.
 *
 * The conversation replaces it. When it does, the only thing that changes here is where the two
 * readings come from; nothing in the drawing knows the difference.
 */
export const silentVoice: JarvisVoice = {
  listening: false,
  speaking: false,
  getVolume: () => 0,
  getSpectrum: () => NOTHING,
};
