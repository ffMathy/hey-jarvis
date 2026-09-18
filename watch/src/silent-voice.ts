import type { JarvisVoice } from 'hologram';

/** Nothing to hear, so nothing to report. Shared: the sphere never writes to it. */
const NOTHING: readonly number[] = [];

/**
 * A voice that is not there, which is what the watch has while it is waiting for the phone.
 *
 * The sphere takes a `JarvisVoice` and asks it two questions every 40 ms. Given this one it idles:
 * turning, materialising once at startup, never brightening. That is exactly the right picture of
 * a watch with no credentials yet — he is here, he simply has nothing to talk to — so it is what
 * `waiting-for-the-phone.tsx` hands the drawing.
 *
 * It used to be the whole app, back when the watch answered nobody. The conversation screen now
 * hands over a real voice instead (`useAgentVoice`), and the only thing that differs between them
 * is where the two readings come from; nothing in the drawing knows which it has.
 */
export const silentVoice: JarvisVoice = {
  listening: false,
  speaking: false,
  getVolume: () => 0,
  getSpectrum: () => NOTHING,
};
