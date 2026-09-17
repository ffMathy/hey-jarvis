// On Android Skia is linked into the app and ready at startup, so the view is
// used directly. The browser has to fetch CanvasKit first — see the `.web.tsx`
// beside this file, which is the only reason the two are separate.
export type { JarvisHologramProps } from 'hologram/react';
export { JarvisHologram } from 'hologram/react';
