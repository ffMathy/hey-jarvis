// On Android Skia is linked into the app and ready at startup, so the view is
// used directly. The browser has to fetch CanvasKit first — see the `.web.tsx`
// beside this file, which is the only reason the two are separate.
import type { BodyRenderer } from 'hologram';
import { JarvisHologram as HologramView, type JarvisHologramProps } from 'hologram/react';

export type { JarvisHologramProps };

/**
 * Which renderer draws his body: the GPU wherever the phone has what it needs (`body` on the view),
 * unless the bundle was built with `EXPO_PUBLIC_HOLOGRAM_BODY=skia`, which keeps him in Skia's flat
 * drawing — for comparing the two on one phone, and for a phone whose GPU draws him wrongly. Read at
 * bundle time, as every `EXPO_PUBLIC_` variable is.
 */
const BODY: BodyRenderer = process.env.EXPO_PUBLIC_HOLOGRAM_BODY === 'skia' ? 'skia' : 'gpu';

export function JarvisHologram(props: JarvisHologramProps) {
  return <HologramView body={BODY} {...props} />;
}
