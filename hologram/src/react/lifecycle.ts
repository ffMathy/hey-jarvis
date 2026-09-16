/**
 * The parts of `hologram/react` that must be reachable *before* Skia exists.
 *
 * **Nothing in this file, or anything it imports, may touch `@shopify/react-native-skia`.** In a
 * browser that package is only usable once CanvasKit's WebAssembly has loaded, and it captures
 * what it found the moment it is first evaluated — so importing it early leaves `Skia` undefined
 * for the life of the page, and the first thing the hologram does with it throws. The lazy
 * `import()` in `jarvis-hologram.web.tsx` exists precisely to keep that from happening, and a
 * single eager import from the main `hologram/react` entry is enough to defeat it. That is not
 * hypothetical: it is what turned the published site black.
 *
 * So the screen-level pieces live here, apart from the view, and `react.contract.spec.ts` checks
 * that nothing on this side of the line reaches across it.
 */

export { useIsForeground } from './is-foreground';
export { LEAVING_SECONDS } from './leaving';
