import { requireOptionalNativeModule } from 'expo';
import { createElement } from 'react';
import { Platform } from 'react-native';
import type {
  AdoptGlContext,
  BodyGlViewComponent,
  BodyGlViewProps,
  DrawingBufferSide,
  FinishPreviousFrame,
  GlContextOnDrawingThread,
} from './gl-contract';

/**
 * expo-gl on a device: a `TextureView` with a GL thread of its own, made in the JS thread and
 * drawn into from the UI thread.
 *
 * **Only where the app was built with expo-gl's native module.** Loading expo-gl asks for the
 * module as it loads and throws without it, so it is required here only once the module is known
 * to be there; a development client built before the dependency was added draws him without his
 * body. The phone and the watch both require Android 10 or later (`minSdkVersion`), the first on
 * which React Native Screens a view onto its siblings (`mixBlendMode`), which is how he is laid
 * onto a background that is not black.
 *
 * **The UI thread draws, through expo-gl's worklet support.** `enableExperimentalWorkletSupport`
 * puts every context the view makes into the UI runtime too, under the same id, and
 * `getWorkletContext` finds it there. The JS thread compiles and uploads once per context and never
 * calls GL again, because both runtimes write into one unlocked batch of calls: a call from each at
 * once is a native crash, not an exception.
 */

const expoGl = Platform.OS === 'android' && requireOptionalNativeModule('ExpoGL') !== null ? loadExpoGl() : undefined;

function loadExpoGl(): typeof import('expo-gl') {
  return require('expo-gl');
}

/** expo-gl's own lookup of a context on the UI runtime, captured on its own: a worklet carries functions, not modules. */
const lookUpWorkletContext = expoGl?.getWorkletContext;

function deviceBodyGlView(GLView: typeof import('expo-gl').GLView) {
  return function DeviceBodyGlView({ testID, style, onContextCreate }: BodyGlViewProps) {
    return createElement(GLView, {
      testID,
      style,
      pointerEvents: 'none',
      enableExperimentalWorkletSupport: true,
      onContextCreate,
    });
  };
}

export const BodyGlView: BodyGlViewComponent = expoGl === undefined ? undefined : deviceBodyGlView(expoGl.GLView);

/**
 * expo-gl makes a WebGL 2 context where the driver gives it OpenGL ES 3 and quietly falls back to
 * a WebGL 1 one where it gives ES 2, which cannot compile the body's GLSL ES 3.00.
 */
export const adoptGlContext: AdoptGlContext = (gl) =>
  'supportsWebGL2' in gl && gl.supportsWebGL2 === true ? gl.contextId : undefined;

export const glContextOnDrawingThread: GlContextOnDrawingThread = (contextId) => {
  'worklet';
  return lookUpWorkletContext?.(contextId);
};

/**
 * `flushEXP`, which blocks until expo-gl's GL thread has run everything queued before it.
 *
 * Without it nothing holds the UI thread back: expo-gl queues each frame's calls without limit and
 * its GL thread runs every queued frame before it swaps once, so a GPU that falls behind is handed
 * more frames than it can draw while the frame callback goes on counting sixty a second. Waiting
 * here makes the frame rate the density loop steers by the rate frames reach the screen. It is also
 * the liveness check: a call on a context that has gone answers `undefined`, where a live one
 * answers `null`.
 */
export const finishPreviousFrame: FinishPreviousFrame = (gl) => {
  'worklet';
  const answer: unknown = gl.flushEXP();
  return answer !== undefined;
};

/**
 * What the view is laid out at, in pixels: expo-gl sets `drawingBufferWidth` once, when it makes
 * the context, and never again as the view is resized, while the surface itself follows the view.
 * The view's side is on the pixel grid (`drawnSize` in the view), so the surface is exactly that
 * many pixels across wherever the view is laid out.
 */
export const drawingBufferSide: DrawingBufferSide = (_gl, laidOutPixels) => {
  'worklet';
  return laidOutPixels;
};
