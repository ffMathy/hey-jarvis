/**
 * What a sample-mode screen needs besides the sphere: a voice made from the clock, the name of the
 * mood for a moment after a tap, and the frame-rate readout.
 *
 * Both devices have a sample mode — the phone's before there is an account, the watch's while it
 * waits for the phone — and these are the parts of it that are the same on both. Where they sit on
 * the screen is not: each takes a `style`, and the layout stays in the app.
 *
 * **Skia-free, like `lifecycle.ts`, and for the same reason.** A browser screen can import this
 * before CanvasKit has loaded, so nothing here may reach `@shopify/react-native-skia`;
 * `react.contract.spec.ts` checks it. The moods themselves, their names and the readout's text are
 * in the main `hologram` entry, which imports nothing at all.
 */

export { FrameRate } from './frame-rate';
export { ModeToast } from './mode-toast';
export { useSimulatedUser, useSimulatedVoice } from './use-simulated-voice';
