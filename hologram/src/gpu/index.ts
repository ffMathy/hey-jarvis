/**
 * Jarvis's body on the GPU: the headset's passes, with no framework in them.
 *
 * The fragment arithmetic in GLSL and the CPU reference it is held to, the rows every pass reads,
 * the halo union, the strokes and the halos' light as shader sources, the view-basis maths, and a
 * renderer over a bare WebGL 2 context (`gpu-body.ts`) with the camera a flat screen needs
 * (`flat-camera.ts`). The headset draws the same sources through three.js
 * (`vr/src/hologram3d/`); a phone and a watch draw them through `drawGpuBody`.
 *
 * Like the main entry, nothing here imports a value from outside the package — no three.js, no
 * React, no expo-gl — so it runs under `bun test`, in a browser and in a worklet.
 */
export * from './body-rows';
export * from './body-strokes';
export * from './flat-camera';
export * from './fragment-3d';
export * from './fragment-glsl';
export * from './glsl';
export * from './gpu-body';
export * from './halo-light';
export * from './halo-union';
export * from './row-vertices';
export * from './sparkle';
export * from './view-basis';
