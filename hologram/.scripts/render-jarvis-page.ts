/**
 * Jarvis on the GPU, in the page every offline render draws him on: the part of the render entries
 * (`render-*-page.ts`) that is him rather than what is round him.
 *
 * All of him — his body and the picture of everything else — through `hologram/gpu`, as a phone
 * and a watch draw him: `createGpuBody` and `createGpuPicture` once, then `drawGpuFrame` each frame
 * on a camera straight on (`FRONT_VIEW`, from infinitely far), with the whole of the scene drawn
 * (density 1), since nothing offline has to hold a frame rate. The frame is premultiplied light on
 * transparent black and unfaded, as on a device; {@link paintJarvis} does what a device's view does
 * with it, fading it by the arrival and laying it over the background.
 */
import {
  createFlatCamera,
  createGpuBody,
  createGpuPicture,
  drawGpuFrame,
  FRONT_VIEW,
  HALO_TEXELS,
  placeFlatCamera,
} from '../src/gpu';
import { analyseFrame, arrivalOf, type HologramFrame, type HologramScene, pictureSceneOf } from '../src/index';

/** Everything a device's GL context is asked for, so the frame is drawn exactly as there. */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: true,
  stencil: true,
  // Kept after the frame is drawn, so the canvas can be painted onto another afterwards.
  preserveDrawingBuffer: true,
};

/** Jarvis drawn into a square canvas of his own, `side` pixels across. */
export interface GpuJarvis {
  canvas: OffscreenCanvas;
  side: number;
  /** Draws `frame` into the canvas, replacing what was there, and throws if the GPU reported an error. */
  draw: (frame: HologramFrame) => void;
  /** Lets the context go, for a render that draws at many sizes one after another. */
  release: () => void;
}

/**
 * A canvas `side` pixels across with Jarvis set up in it, his square the whole of it.
 *
 * One context each: the renderer leaves GL state as it set it, so it needs a context of its own.
 */
export function createGpuJarvis(scene: HologramScene, side: number): GpuJarvis {
  const canvas = new OffscreenCanvas(side, side);
  const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (gl === null) {
    throw new Error('This browser gave no WebGL 2 context, and Jarvis is drawn only on the GPU.');
  }
  // One texel per pixel of the canvas and never more than the headset's, as a device's view has it.
  const body = createGpuBody(gl, scene, { haloTexels: Math.min(side, HALO_TEXELS) });
  const picture = createGpuPicture(gl, pictureSceneOf(scene));
  const camera = createFlatCamera();
  const screen = { width: side, height: side, squareX: side / 2, squareY: side / 2, squareSide: side };

  return {
    canvas,
    side,
    draw: (frame) => {
      const state = analyseFrame(frame, 1);
      placeFlatCamera(camera, screen, state.radius, FRONT_VIEW, Number.POSITIVE_INFINITY);
      drawGpuFrame(gl, body, picture, { state, density: 1, fade: 1, alphaFromLight: 1, camera }, []);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        throw new Error(`The GPU reported error ${error} drawing Jarvis at ${frame.time.toFixed(3)} s.`);
      }
    },
    release: () => gl.getExtension('WEBGL_lose_context')?.loseContext(),
  };
}

/**
 * How he is laid over what is under him, as a device's view lays him: straight over black or over
 * nothing (`source-over`, where the two agree), and Screened onto any other background, which is
 * what the phone's sheet does over its ink.
 */
export type JarvisBlend = 'source-over' | 'screen';

/**
 * Draws `frame` and paints it onto `context` with his square's top left at `x`, `y`, faded by his
 * arrival as a device's view fades the canvas he is drawn in.
 */
export function paintJarvis(
  context: OffscreenCanvasRenderingContext2D,
  jarvis: GpuJarvis,
  frame: HologramFrame,
  placement: { x: number; y: number; blend: JarvisBlend },
) {
  jarvis.draw(frame);
  context.save();
  context.globalAlpha = arrivalOf(frame.appearance, frame.presence);
  context.globalCompositeOperation = placement.blend;
  context.drawImage(jarvis.canvas, placement.x, placement.y);
  context.restore();
}

/** Encodes a canvas as PNG or JPEG, in base64, which is how a page hands bytes back to the script. */
export async function encodeCanvas(canvas: OffscreenCanvas, type: 'image/png' | 'image/jpeg', quality?: number) {
  const blob = await canvas.convertToBlob({ type, quality });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // In slices, since spreading a few megabytes into one call overflows the stack.
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** A 2D context of a new canvas, `width` by `height`, for a render entry to compose a picture on. */
export function createComposition(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('This browser gave no 2D context to compose the picture on.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/** One of the prepared frames from `device-art/`, decoded, which the page fetches like any image. */
export async function loadArt(file: string) {
  const response = await fetch(file);
  if (!response.ok) {
    throw new Error(`Could not fetch ${file} — run ./hologram/.scripts/prepare-device-art.sh`);
  }
  return createImageBitmap(await response.blob());
}

/** The family name `loadRoboto` registers the font under. */
export const ROBOTO = 'Roboto Light';

/** Roboto Light from `device-art/`, registered with the page so a canvas can write in it. */
export async function loadRoboto() {
  const font = new FontFace(ROBOTO, 'url(roboto-light.ttf)');
  await font.load();
  document.fonts.add(font);
}
