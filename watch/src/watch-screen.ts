import { useWindowDimensions } from 'react-native';

/**
 * How much larger than the screen the square is drawn.
 *
 * The sphere is `SPHERE_FRACTION` of the square, so at the screen's own width he was a ball about
 * half of it across, with a wide black ring around him — and the user asked for him to fill about
 * a quarter more of the watch. Growing the square rather than the fraction keeps the phone's
 * sphere where it is, and the part of the square that now hangs off the edge is the room the
 * drawing keeps for the chips he throws, which a round bezel was going to cut anyway. The same
 * trade the phone's `CHIP_HEADROOM` makes, for the same reason.
 */
const WATCH_SCALE = 1.25;

/**
 * How big the sphere is drawn on this watch.
 *
 * The whole screen and then some, unlike the phone, where it shares the screen with other things.
 * A watch face is round and small: anything held back from the edges reads as a widget rather than
 * as a presence, and there is nothing else on screen to leave room for.
 *
 * The shorter side, because a square screen is square and a round one is a circle, and on both
 * the smaller dimension is the one that clips.
 */
export function useWatchHologramSize(): number {
  const { width, height } = useWindowDimensions();
  return Math.round(Math.min(width, height) * WATCH_SCALE);
}
