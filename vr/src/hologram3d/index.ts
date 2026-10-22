/**
 * Jarvis in three dimensions: what the rest of the app needs of `src/hologram3d/`.
 *
 * `createJarvisHologram3D` is the whole of it for the room; the rest is here for the pieces that
 * drive him (the frame clock's drive), place him (his radius) and preview him on a desktop.
 */

export { loadPainter, type Painter } from './canvaskit';
export { DISTANCE_AHEAD_METRES, HOLOGRAM_RADIUS_METRES } from './dimensions';
export type { HologramDrive } from './frame-clock';
export {
  createJarvisHologram3D,
  type HologramDiagnostics,
  type JarvisHologram3D,
  type JarvisHologramOptions,
} from './jarvis-hologram-3d';
export { ALPHA_FROM_LIGHT } from './view-plane-quad';
