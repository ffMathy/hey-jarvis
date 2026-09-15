import { useWindowDimensions } from 'react-native';
import { theme } from './theme';

/** The hologram never grows past this, however wide the screen: beyond it, it stops reading as a presence and starts reading as wallpaper. */
const MAXIMUM_HOLOGRAM_SIZE = 380;

/** How big the hologram is drawn on this screen: the width between the screen's side margins, up to a limit. */
export function useHologramSize(): number {
  const { width } = useWindowDimensions();
  return Math.min(width - theme.spacing.large * 2, MAXIMUM_HOLOGRAM_SIZE);
}
