/**
 * Which renderer draws his body on a phone or a watch: the GPU, through `hologram/gpu`, or Skia,
 * inside the same picture as the rest of him.
 *
 * The GPU draws it in three dimensions — what the tilt turns round him — and frees Skia of the
 * thousands of strokes and halos that cost the most of every picture, so the GPU body is what a
 * view asks for first. Skia's body is what it always was, and stays as the fallback: a device
 * without the GPU it needs, a context that will not come up in time, or one lost while he is on
 * screen. `react/body-layer.tsx` decides which, frame by frame; this is only what it decides
 * between, and what each choice starts the density loop at.
 *
 * Nothing here imports anything, like the rest of the main entry, and the worklet runs in the
 * view's frame callback.
 */

/** Which renderer a view is asked to draw the body with. Asked for Skia, the GPU is never tried. */
export type BodyRenderer = 'gpu' | 'skia';

/**
 * Which renderer draws the body right now: one of the two, or `pending` while the GPU's context is
 * being made and its programs compiled, during which the view holds his clock at the start of the
 * arrival, where nothing of him shows yet.
 */
export type BodyLayer = 'pending' | BodyRenderer;

/**
 * How long a view waits for the GPU body before arriving with Skia's instead, in milliseconds,
 * from the moment it mounts or comes back to the foreground.
 *
 * The wait is his arrival held back, so it has to be short: a context and three programs compiled
 * on the JS thread are expected well inside it, and a device that takes longer is one that would
 * have stuttered through the arrival anyway. A GPU body that comes up later is used at the next
 * arrival, not mid-show.
 */
export const GPU_READY_TIMEOUT_MS = 800;

/**
 * The least share of the particles the GPU body starts at.
 *
 * The density loop steers by how long a frame's JavaScript takes, and with the body on the GPU
 * that is the picture at density nought and the calls that issue the GPU's frame — well under a
 * millisecond, whatever the share. So the build time always says there is room, the share climbs
 * at the loop's own pace, and the frame rate's ceiling is what stops it. Starting at the floor
 * would spend six seconds climbing to where any GPU that drew him at all could start; half is
 * where the loop would settle on a GPU too weak for all of him.
 */
export const GPU_STARTING_SHARE = 0.5;

/**
 * What share the density loop starts at for a body drawn by `renderer`, given the share
 * remembered from last time (`startFromRemembered` of it, or undefined for none).
 *
 * Skia's body starts where it always has, from the remembered share or the floor. The GPU's
 * starts at least at GPU_STARTING_SHARE, and higher where the remembered share is. A view starts
 * the loop again from here whenever the body changes renderer, since a share one could hold says
 * nothing about the other.
 */
export function bodyStartingShare(renderer: BodyRenderer, remembered: number | undefined): number | undefined {
  'worklet';
  if (renderer === 'skia') {
    return remembered;
  }
  return remembered === undefined || remembered < GPU_STARTING_SHARE ? GPU_STARTING_SHARE : remembered;
}
