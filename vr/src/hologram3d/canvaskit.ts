import type { SkCanvas } from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { JsiSkCanvas } from '@shopify/react-native-skia/lib/module/skia/web/JsiSkCanvas';
import type { Canvas, CanvasKit } from 'canvaskit-wasm';
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit';

/**
 * CanvasKit, and React Native Skia's API over it.
 *
 * The hologram's drawing takes a Skia as an argument; on the phone that is native Skia, in the
 * phone's web build and in hologram's own tests it is this same `JsiSkApi` over CanvasKit. So
 * the headset draws Jarvis with exactly the calls the phone makes, and nothing here knows how.
 */
export interface Painter {
  canvasKit: CanvasKit;
  skia: ReturnType<typeof JsiSkApi>;
}

/**
 * Loads CanvasKit's WebAssembly from `vendorUrl` and builds the Skia API over it.
 *
 * From the site's own `vendor/` folder, where `turbo initialize` copies it: served from GitHub
 * Pages the app lives under /hey-jarvis/vr/, so the URL has to be relative to the page, not
 * to the domain. The phone's first published page asked for its wasm at the domain root, got a
 * 404 page back, and drew everything but Jarvis.
 */
export async function loadPainter(vendorUrl: URL): Promise<Painter> {
  const canvasKit = await CanvasKitInit({ locateFile: (file) => new URL(file, vendorUrl).href });
  return { canvasKit, skia: JsiSkApi(canvasKit) };
}

/** CanvasKit's own canvas, wrapped in the API the hologram draws with. */
export function wrapCanvas(painter: Painter, canvas: Canvas): SkCanvas {
  return new JsiSkCanvas(painter.canvasKit, canvas);
}
