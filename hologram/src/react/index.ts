/**
 * The sphere as a React Native view, for the apps that put one on a screen.
 *
 * Kept apart from the package's main entry on purpose. That entry imports nothing from outside the
 * package but types, which is what lets it run in the tests and on the headset; this one needs React
 * and Reanimated for real, and expo-gl to draw him: on a device only once its native module is found.
 * Importing `hologram` gets you the design and the voice tracking with no framework attached;
 * importing `hologram/react` gets you something you can render.
 *
 * The view reaches expo-gl, so `hologram/react/lifecycle` and `hologram/react/sample` are the entries
 * for the pieces a screen needs without it (`react.contract.spec.ts`).
 */
export type { JarvisHologramProps } from './hologram-view';
export { JarvisHologram } from './hologram-view';
export { useIsForeground } from './is-foreground';
export { LEAVING_SECONDS } from './leaving';
