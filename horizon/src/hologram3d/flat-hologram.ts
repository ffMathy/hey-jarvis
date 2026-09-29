import type { Surface } from 'canvaskit-wasm';
import {
  createHologramResources,
  createHologramScene,
  drawHologram,
  type HologramFrame,
  type HologramScene,
  SCENE_SEED,
} from 'hologram';
import type { HologramSurfaceKind } from '../debug-hook';
import { type Painter, wrapCanvas } from './canvaskit';

/**
 * How many pixels across the drawing is.
 *
 * At 1.6 m the square is about 29° across, which on a Quest 3 is some 700 display pixels — but
 * the phone's own look is drawn at under half its screen resolution and scaled up, so 512 is
 * already sharper than the look it copies, at a quarter of the cost of 1024.
 */
export const DRAWING_SIZE_PIXELS = 512;

/** The phone's whole drawing, rasterised once a frame into a picture the headset can show. */
export interface FlatHologram {
  kind: HologramSurfaceKind;
  /** Draws `frame` and hands the result over; the caller owns, and must close, the bitmap. */
  draw(frame: HologramFrame): ImageBitmap;
  dispose(): void;
}

interface DrawingTarget {
  surface: Surface;
  canvas: OffscreenCanvas;
  kind: HologramSurfaceKind;
}

/** How the browsers that emulate WebGL on the CPU name their renderer. */
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|software/i;

/**
 * Whether the only WebGL here is a software rasteriser.
 *
 * CanvasKit's GPU backend turns each frame of him into path tessellation and a stream of draw
 * calls. On a real GPU that is what it is for; on SwiftShader, which a machine with no GPU — a
 * CI runner — falls back to, all of it is emulated on the CPU, and a frame took about a second
 * where CanvasKit's own CPU rasteriser took under a tenth of that on the same machine.
 *
 * Asked of a throwaway context, so the canvas CanvasKit draws on is still free to be given
 * whichever kind of context it needs.
 */
function webGlIsSoftware(): boolean {
  const probe = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (probe === null) return true;
  const rendererInfo = probe.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown = probe.getParameter(
    rendererInfo === null ? probe.RENDERER : rendererInfo.UNMASKED_RENDERER_WEBGL,
  );
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  return typeof renderer === 'string' && SOFTWARE_RENDERERS.test(renderer);
}

/**
 * A surface to draw on, on the GPU if there is a real one.
 *
 * On an OffscreenCanvas of its own, so CanvasKit's WebGL context never shares state with the
 * one three renders the room with. CanvasKit falls back to the CPU by itself when WebGL is
 * refused, but on the canvas that refused it, where a 2D context can no longer be had; so a
 * second canvas is the fallback when that fails too.
 */
function makeDrawingTarget(painter: Painter, size: number): DrawingTarget {
  if (!webGlIsSoftware()) {
    const gpuCanvas = new OffscreenCanvas(size, size);
    const gpuSurface = painter.canvasKit.MakeWebGLCanvasSurface(gpuCanvas);
    if (gpuSurface !== null) {
      return { surface: gpuSurface, canvas: gpuCanvas, kind: gpuSurface.reportBackendTypeIsGPU() ? 'webgl' : 'cpu' };
    }
  }
  const cpuCanvas = new OffscreenCanvas(size, size);
  const cpuSurface = painter.canvasKit.MakeSWCanvasSurface(cpuCanvas);
  if (cpuSurface === null) {
    throw new Error('CanvasKit could not make anything to draw Jarvis on.');
  }
  return { surface: cpuSurface, canvas: cpuCanvas, kind: 'cpu' };
}

/**
 * Jarvis exactly as the phone draws him, flat, for the view-plane quad.
 *
 * Cleared to opaque black every frame, because that is what the phone draws him over: every
 * layer of him is Screen-blended, and Screen over black is the light alone. The quad's shader
 * turns that light into colour and alpha for the passthrough; the picture itself carries none.
 *
 * `scene` is the phone's own by default; the volumetric hologram hands over the one its GPU rows
 * were built from, so the scene is built once and CanvasKit's layers and the body cannot differ.
 */
export function createFlatHologram(
  painter: Painter,
  size: number = DRAWING_SIZE_PIXELS,
  scene: HologramScene = createHologramScene(SCENE_SEED),
): FlatHologram {
  const target = makeDrawingTarget(painter, size);
  const resources = createHologramResources(painter.skia, scene);
  const rawCanvas = target.surface.getCanvas();
  const canvas = wrapCanvas(painter, rawCanvas);
  const black = painter.canvasKit.BLACK;

  return {
    kind: target.kind,
    draw(frame) {
      rawCanvas.clear(black);
      drawHologram(canvas, size, frame, scene, resources);
      target.surface.flush();
      return target.canvas.transferToImageBitmap();
    },
    dispose() {
      target.surface.delete();
    },
  };
}
