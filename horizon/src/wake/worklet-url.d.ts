/**
 * Vite's `?worker&url` import: the URL of a file Vite bundles, with its imports, as a module of
 * its own — which is what `audioWorklet.addModule` needs for the frame-packing worklet.
 *
 * Declared here, and only for `.worklet.ts` files, rather than by referencing `vite/client`,
 * whose `ImportMeta` augmentation would clash with `bun-types`' for the rest of the package.
 */
declare module '*.worklet.ts?worker&url' {
  const url: string;
  export default url;
}
