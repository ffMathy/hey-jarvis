/**
 * The drawing half of `render-preview.ts`, run in headless Chromium: Jarvis on black, one frame at
 * a time, as a JPEG for the clip to be stitched from.
 */
import { createHologramScene, type HologramFrame, SCENE_SEED } from '../src/index';
import { createComposition, createGpuJarvis, encodeCanvas, paintJarvis } from './render-jarvis-page';

/** What the script drives the page with. */
export interface PreviewPage {
  /** Sets him up in a square `size` pixels across; once, before any frame. */
  setUp: (size: number) => void;
  /** One frame as a base64 JPEG: black, with him on it once there is a frame of him. */
  frame: (frame: HologramFrame | null) => Promise<string>;
}

declare global {
  interface Window {
    /** Set as the page entry loads, which `addScriptTag` waits for, so every `evaluate` after it finds it. */
    preview: PreviewPage;
  }
}

/** How good each JPEG is, out of 1: the frames are stitched into a VP8 clip, so they are not the last word. */
const JPEG_QUALITY = 0.95;

function createPreviewPage(): PreviewPage {
  let drawing:
    | { jarvis: ReturnType<typeof createGpuJarvis>; composition: ReturnType<typeof createComposition> }
    | undefined;
  return {
    setUp: (size) => {
      drawing = {
        jarvis: createGpuJarvis(createHologramScene(SCENE_SEED), size),
        composition: createComposition(size, size),
      };
    },
    frame: (frame) => {
      if (drawing === undefined) {
        throw new Error('The preview was asked for a frame before it was set up.');
      }
      const { context, canvas } = drawing.composition;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (frame !== null) {
        paintJarvis(context, drawing.jarvis, frame, { x: 0, y: 0, blend: 'source-over' });
      }
      return encodeCanvas(canvas, 'image/jpeg', JPEG_QUALITY);
    },
  };
}

window.preview = createPreviewPage();
