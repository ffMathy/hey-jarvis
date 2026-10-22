import type { BodyRenderer } from 'hologram';
import { JarvisHologram as HologramView, type JarvisHologramProps } from 'hologram/react';

/**
 * Which renderer draws his body: the GPU wherever the watch has what it needs (`body` on the view),
 * unless the bundle was built with `EXPO_PUBLIC_HOLOGRAM_BODY=skia`, which keeps him in Skia's flat
 * drawing — the phone's switch, for the same uses. Read at bundle time, as every `EXPO_PUBLIC_`
 * variable is.
 */
const BODY: BodyRenderer = process.env.EXPO_PUBLIC_HOLOGRAM_BODY === 'skia' ? 'skia' : 'gpu';

/** The hologram as the watch shows it: straight on, since nothing here asks for `tilt`. */
export function JarvisHologram(props: JarvisHologramProps) {
  return <HologramView body={BODY} {...props} />;
}
