import { GLView } from 'expo-gl';
import { createElement } from 'react';
import type {
  AdoptGlContext,
  BodyGl,
  BodyGlViewComponent,
  BodyGlViewProps,
  DrawingBufferSide,
  FinishPreviousFrame,
  GlContextOnDrawingThread,
} from './gl-contract';

/**
 * expo-gl in a browser: a `<canvas>` with a WebGL 2 context, drawn into from the page's own thread,
 * where Reanimated runs its frame callbacks on `requestAnimationFrame`.
 *
 * The browser's GLView hands over a real `WebGL2RenderingContext` and has no worklet lookup, so
 * the contexts are kept here by an id of this file's own: a context lost and restored is the same
 * object, and it comes back under a new id so that it is treated as the new context it is.
 */

/** What the body's canvas asks of the browser: premultiplied light over transparent black, as on a device, and nothing it does not read. */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  // A device's context has no multisampling either; the browser's would only cost fill.
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

/**
 * The browser's GLView takes its context attributes as a prop the device's types do not have, so
 * they are spread in. One object for the life of the page: a new one makes the view lose its
 * context and make another.
 */
const BROWSER_ONLY_PROPS = { webglContextAttributes: CONTEXT_ATTRIBUTES };

const contexts = new Map<number, BodyGl>();
let nextContextId = 1;

function BrowserBodyGlView({ testID, style, onContextCreate }: BodyGlViewProps) {
  return createElement(GLView, { ...BROWSER_ONLY_PROPS, testID, style, pointerEvents: 'none', onContextCreate });
}

/** None in a browser without WebGL 2, where he is drawn without his body. */
export const BodyGlView: BodyGlViewComponent =
  typeof WebGL2RenderingContext === 'undefined' ? undefined : BrowserBodyGlView;

/**
 * expo-gl's browser GLView falls back to WebGL 1 without a word where WebGL 2 is refused, which
 * cannot draw the body. A context lost is forgotten at once, so the next frame finds nothing and
 * the body is not drawn; the browser then restores it, and the GLView hands it over again.
 *
 * **Read as Display P3, as Skia's canvas is.** React Native Skia tags its web canvas's drawing
 * buffer `display-p3` while drawing the same sRGB paint numbers into it, so a browser that manages
 * colour reads the rest of him as P3. Left sRGB, the body's canvas would show the same paint as
 * another colour beside it — his body paler and yellower than the rim, the core and the halos Skia
 * draws round it. Set here, on every context adopted, restored ones included, before the body is
 * made in it; a browser without the property tags neither canvas.
 */
export const adoptGlContext: AdoptGlContext = (gl) => {
  if (!(gl instanceof WebGL2RenderingContext)) {
    return undefined;
  }
  if ('drawingBufferColorSpace' in gl) {
    gl.drawingBufferColorSpace = 'display-p3';
  }
  const contextId = nextContextId++;
  contexts.set(contextId, gl);
  gl.canvas.addEventListener('webglcontextlost', () => contexts.delete(contextId), { once: true });
  return contextId;
};

export const glContextOnDrawingThread: GlContextOnDrawingThread = (contextId) => {
  'worklet';
  return contexts.get(contextId);
};

/** Nothing to wait for: a browser presents what was drawn once the frame's task ends, and throttles the frames itself. */
export const finishPreviousFrame: FinishPreviousFrame = (gl) => {
  'worklet';
  return !gl.isContextLost();
};

/** A browser's drawing buffer follows its canvas, which expo-gl sizes from the layout as it changes. */
export const drawingBufferSide: DrawingBufferSide = (gl) => {
  'worklet';
  return gl.drawingBufferWidth;
};
