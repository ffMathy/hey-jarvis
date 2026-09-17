/**
 * The sphere as a React Native view, for the apps that put one on a screen.
 *
 * Kept apart from the package's main entry on purpose. That entry imports nothing but types,
 * which is what lets the drawing be run headlessly in the tests and under CanvasKit in a browser;
 * this one needs React, Reanimated and Skia for real. Importing `hologram` gets you the design
 * and the voice tracking with no framework attached; importing `hologram/react` gets you
 * something you can render.
 *
 * **In a browser, importing this at startup is a bug.** Everything here reaches
 * `@shopify/react-native-skia`, which cannot be touched before CanvasKit's WebAssembly has loaded;
 * `hologram/react/lifecycle` is the entry for the pieces a screen needs before then.
 */
export type { JarvisHologramProps } from './hologram-view';
export { JarvisHologram } from './hologram-view';
export { useIsForeground } from './is-foreground';
export { LEAVING_SECONDS } from './leaving';
