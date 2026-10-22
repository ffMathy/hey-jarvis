import type { ExpoWebGLRenderingContext } from 'expo-gl';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * What the GPU body needs of the platform it is drawn on, as the two halves of `gl-context` must
 * each give it: `gl-context.ts` with expo-gl's native view on a device, `gl-context.web.ts` with
 * its browser view. Nothing else imports both, so these types are what keeps either from drifting.
 */

/**
 * The context the body is drawn with: expo-gl's on a device, a browser's WebGL 2 context with
 * expo-gl's few additions in one. Both fit the renderer's `HologramGl`.
 */
export type BodyGl = ExpoWebGLRenderingContext;

/** What the body layer hands the view that makes the context. */
export interface BodyGlViewProps {
  testID: string;
  style: StyleProp<ViewStyle>;
  /** Called on the JS thread with each context the view makes: one per surface, and again for each restored. */
  onContextCreate: (gl: BodyGl) => void;
}

/** The view that makes a context and shows what is drawn into it, or undefined where there is none to be had. */
export type BodyGlViewComponent = ComponentType<BodyGlViewProps> | undefined;

/**
 * On the JS thread, as a context arrives: the id the drawing thread will find it under, or
 * undefined for a context that cannot draw the body (WebGL 1, or OpenGL ES 2 on a device).
 */
export type AdoptGlContext = (gl: BodyGl) => number | undefined;

/** A worklet: the context under `contextId` on the thread that draws, or undefined once it has gone. */
export type GlContextOnDrawingThread = (contextId: number) => BodyGl | undefined;

/**
 * A worklet, once at the start of every frame drawn: waits until the previous frame has been drawn,
 * where the platform queues frames rather than waiting on its own, and says whether the context is
 * still there to draw with.
 */
export type FinishPreviousFrame = (gl: BodyGl) => boolean;

/**
 * A worklet: how many pixels across the context's drawing buffer is, for a view laid out at
 * `laidOutPixels` of them.
 */
export type DrawingBufferSide = (gl: BodyGl, laidOutPixels: number) => number;
