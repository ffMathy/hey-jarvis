import { useWindowDimensions } from 'react-native';
import { theme } from './theme';

/**
 * The only gap left between Jarvis and the edge of the screen, where he has it to himself.
 *
 * The user asked for him "as wide as the screen, minus maybe just 20 pixels", so this is that
 * twenty: enough that the sphere is not touching the bezel, and no more.
 */
const SCREEN_MARGIN = 20;

/** On a screen with other things on it, the hologram never grows past this: beyond it, it stops reading as a presence and starts reading as wallpaper. */
const MAXIMUM_HOLOGRAM_SIZE = 380;

/**
 * How big the square is when the hologram shares the screen — the conversation, which has a title,
 * a status line and the Talk button to leave room for.
 */
export function useHologramSize(): number {
  const { width } = useWindowDimensions();
  return Math.min(width - theme.spacing.large * 2, MAXIMUM_HOLOGRAM_SIZE);
}

/**
 * And how big it is when Jarvis is the only thing on the screen: sample mode, and the window the
 * assistant gesture opens.
 *
 * The whole screen but for {@link SCREEN_MARGIN}. The sphere is not that wide — it is
 * `SPHERE_FRACTION` of this, and the rest is the room the drawing needs beyond the limb for its
 * rim, its fray, the chips it throws while he speaks and the fade of the shadow he sits on.
 * The shorter side, so it is a square that fits either way up.
 */
export function useWholeScreenHologramSize(): number {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) - SCREEN_MARGIN;
}
