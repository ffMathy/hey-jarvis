import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { JarvisHologramProps } from 'hologram/react';
import { Component, type ReactNode } from 'react';
import { View } from 'react-native';

export type { JarvisHologramProps };

interface HologramUnavailableProps {
  size: number;
  children: ReactNode;
}

/**
 * Holds the hologram's space empty if CanvasKit never loads.
 *
 * `WithSkiaWeb` suspends on the WebAssembly and has no error handling of its
 * own, so a wasm that fails to load or instantiate — a missing file, a dropped
 * request, a browser with WebAssembly switched off — throws during render. With
 * nothing to catch it, React unmounts the whole app, Talk button and all, for
 * the sake of a decoration. There is no retry: Skia caches the failed load.
 */
class HologramUnavailable extends Component<HologramUnavailableProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <View style={{ width: this.props.size, height: this.props.size }} testID="hologram-unavailable" />;
    }
    return this.props.children;
  }
}

/**
 * The same hologram in a browser, once CanvasKit has loaded.
 *
 * Skia's web build is WebAssembly, and nothing Skia-backed may even be imported
 * before it has loaded — so the view is fetched lazily, and the space it will
 * occupy is held empty until then rather than letting the screen jump. The wasm
 * is served from the site itself: `turbo initialize` copies it into `public/`,
 * which the web export publishes as-is, so a browser never reaches for a CDN.
 *
 * From the site, not from the domain root. Published to GitHub Pages the app
 * lives under /<repo>/, and asking for /canvaskit.wasm there fetches a 404 page,
 * which fails to instantiate — so the boundary above caught it and held the
 * hologram's space empty, which is precisely how it looked: everything but
 * Jarvis. `EXPO_BASE_URL` is what `experiments.baseUrl` sets, and is empty when
 * the app is served from a root.
 */
const BASE_URL = process.env.EXPO_BASE_URL ?? '';
export function JarvisHologram(props: JarvisHologramProps) {
  return (
    <HologramUnavailable size={props.size}>
      <WithSkiaWeb
        opts={{ locateFile: (file: string) => `${BASE_URL}/${file}` }}
        getComponent={() => import('hologram/react/hologram-view')}
        fallback={<View style={{ width: props.size, height: props.size }} />}
        componentProps={props}
      />
    </HologramUnavailable>
  );
}
