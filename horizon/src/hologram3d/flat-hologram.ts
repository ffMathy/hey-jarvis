import type { GrDirectContext, Surface } from 'canvaskit-wasm';
import {
  createHologramScene,
  createReleasableHologramResources,
  drawHologram,
  type HologramFrame,
  type HologramScene,
  type ReleasableHologramResources,
  SCENE_SEED,
} from 'hologram';
import { type Painter, wrapCanvas } from './canvaskit';

/** Where CanvasKit draws him: on the GPU through WebGL, or with its own CPU rasteriser. */
export type DrawingSurfaceKind = 'webgl' | 'cpu';

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
  kind: DrawingSurfaceKind;
  /** Draws `frame` and hands the result over; the caller owns, and must close, the bitmap. */
  draw(frame: HologramFrame): ImageBitmap;
  dispose(): void;
}

interface DrawingTarget {
  surface: Surface;
  canvas: OffscreenCanvas;
  kind: DrawingSurfaceKind;
  /** Lets go of the surface and of whatever CanvasKit made to draw on it. */
  release(): void;
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
 * Loses the WebGL context CanvasKit made on `canvas` now, rather than whenever the collector gets
 * to the canvas: a page may hold only so many live contexts, and each keeps a drawing buffer.
 *
 * Asked for again, a canvas hands back the context it already has and never makes a second, so
 * this finds CanvasKit's, whichever version it chose. Only for a canvas known to have one: on a
 * canvas with none, it would make one.
 */
function loseContext(canvas: OffscreenCanvas) {
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * A surface on the GPU, or undefined when any step of making one fails.
 *
 * Built a step at a time — the WebGL context, Skia's GrDirectContext on it, the surface — rather
 * than with MakeWebGLCanvasSurface, for two reasons. On an OffscreenCanvas every failure in there
 * throws instead of returning null: a refused context, a null GrDirectContext, and its fallback,
 * which swaps in a copy of the canvas through the DOM an OffscreenCanvas is not part of. And it
 * keeps the context's handle, without which CanvasKit's table of contexts holds the context, its
 * drawing buffer and the GrDirectContext for as long as the page is open.
 *
 * The colour space is sRGB, which is what CanvasKit's own CPU surface uses. MakeWebGLCanvasSurface
 * passes none; in Chromium the two drew his frames the same to the byte.
 */
function makeGpuTarget(painter: Painter, size: number): DrawingTarget | undefined {
  const { canvasKit } = painter;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvasKit.GetWebGLContext(canvas);
  // CanvasKit's answer when the browser would not give it a context at all.
  if (!(context > 0)) return undefined;
  let grContext: GrDirectContext | null = null;
  let surface: Surface | null = null;
  try {
    grContext = canvasKit.MakeWebGLContext(context);
    if (grContext !== null) {
      surface = canvasKit.MakeOnScreenGLSurface(grContext, size, size, canvasKit.ColorSpace.SRGB);
    }
  } catch (error) {
    console.warn('CanvasKit could not draw on the GPU, so Jarvis is drawn on the CPU:', error);
  }
  const release = () => {
    surface?.delete();
    // Deleting the GrDirectContext makes its WebGL context current first, so the GPU resources
    // it frees are freed on the right one.
    grContext?.delete();
    canvasKit.deleteContext(context);
    loseContext(canvas);
  };
  if (surface === null) {
    release();
    return undefined;
  }
  return { surface, canvas, kind: surface.reportBackendTypeIsGPU() ? 'webgl' : 'cpu', release };
}

/**
 * A surface to draw on, on the GPU if there is a real one and CanvasKit can draw on it, and with
 * CanvasKit's CPU rasteriser otherwise.
 *
 * On an OffscreenCanvas of its own, so CanvasKit's WebGL context never shares state with the
 * one three renders the room with. The CPU surface gets a second canvas, since one that has had a
 * WebGL context can no longer give a 2D one.
 */
function makeDrawingTarget(painter: Painter, size: number): DrawingTarget {
  const gpu = webGlIsSoftware() ? undefined : makeGpuTarget(painter, size);
  if (gpu !== undefined) return gpu;
  const cpuCanvas = new OffscreenCanvas(size, size);
  const cpuSurface = painter.canvasKit.MakeSWCanvasSurface(cpuCanvas);
  if (cpuSurface === null) {
    throw new Error('CanvasKit could not make anything to draw Jarvis on.');
  }
  // dispose, not delete: it also frees the pixels CanvasKit allocated for a CPU surface.
  return { surface: cpuSurface, canvas: cpuCanvas, kind: 'cpu', release: () => cpuSurface.dispose() };
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
  // Nothing in CanvasKit frees the paths a frame makes: left to add up at 72 frames a second,
  // they would run CanvasKit out of memory in about two hours of him being drawn.
  let drawing: ReleasableHologramResources;
  try {
    drawing = createReleasableHologramResources(painter.skia, scene);
  } catch (error) {
    target.release();
    throw error;
  }
  const rawCanvas = target.surface.getCanvas();
  const canvas = wrapCanvas(painter, rawCanvas);
  const black = painter.canvasKit.BLACK;
  let disposed = false;

  return {
    kind: target.kind,
    draw(frame) {
      rawCanvas.clear(black);
      try {
        drawHologram(canvas, size, frame, scene, drawing.resources);
        target.surface.flush();
      } finally {
        // Once flushed the frame no longer needs them; after a throw, it never will.
        drawing.release();
      }
      return target.canvas.transferToImageBitmap();
    },
    dispose() {
      // Twice would delete CanvasKit's objects twice, which throws.
      if (disposed) return;
      disposed = true;
      drawing.dispose();
      target.release();
    },
  };
}
