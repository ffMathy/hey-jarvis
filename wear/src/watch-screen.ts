import { useWindowDimensions } from 'react-native';

/**
 * How big the sphere is drawn on this watch.
 *
 * The whole screen, unlike the phone, where it is inset from the margins and capped at 380
 * points. A watch face is round and small: anything held back from the edges reads as a widget
 * rather than as a presence, and there is nothing else on screen to leave room for. The drawing
 * keeps its own distance — the sphere is `SPHERE_FRACTION` of the canvas — so a square the width
 * of the screen still sits comfortably inside the circle.
 *
 * The shorter side, because a square screen is square and a round one is a circle, and on both
 * the smaller dimension is the one that clips.
 */
export function useWatchHologramSize(): number {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height);
}
