import { Component, type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { runOnUI, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import {
  createFlatCamera,
  createGpuBody,
  drawGpuBody,
  FRONT_VIEW,
  type GpuBody,
  HALO_TEXELS,
  placeFlatCamera,
} from '../gpu';
import {
  analyseFrame,
  createFrameClockState,
  type HologramScene,
  type HologramScript,
  hologramFrameOf,
  MATERIALISE_SECONDS,
} from '../index';
import { adoptGlContext, BodyGlView, finishPreviousFrame, glContextOnDrawingThread } from './gl-context';
import type { BodyGl } from './gl-contract';

/**
 * Jarvis's body on the GPU, through expo-gl: the GL view, the context it is drawn with, and
 * whether there is a body to draw this frame.
 *
 * **Set up on the JS thread, drawn on the UI thread.** `createGpuBody` compiles three programs and
 * uploads about 3 MB of rows, with queries that block until the GPU answers, so it runs once per
 * context in `onContextCreate`, which is where the context is handed over, once a frame drawn to
 * warm the driver up has been waited for. The body it returns is plain data, and crosses to the UI
 * thread through a shared value with the context's id; the frame callback finds the context by
 * that id and draws, beside the picture it steps on the same clock. From the handover on, the JS
 * thread never calls GL again: see `gl-context.ts`.
 *
 * **Pending on every arrival, for a bounded while.** His arrival is his body spiralling out of the
 * core, so the frame callback holds his clock at the start of it — where nothing of him shows yet —
 * until the body is ready to draw or BODY_READY_TIMEOUT_MS has passed, and then lets it go. Again on
 * every return to the foreground, since a device may make the view a new surface, and a new context
 * with it, while the app is away.
 *
 * **Where the GPU cannot draw him, there is no body, and nothing else changes.** No GL view at all
 * (expo-gl's native module missing from the build, a browser without WebGL 2), a context that is
 * WebGL 1 or OpenGL ES 2, a program that will not compile, a GL view that throws or a warm-up frame
 * the GPU reports an error for: the GL view goes, nothing is pending, and Skia's picture of the rest
 * of him arrives on time. A context lost while he is on screen — expo-gl's calls on it answering
 * `undefined`, a browser's `webglcontextlost` — takes the body away from the next frame, and it is
 * drawn again from the first frame after expo-gl hands a new context over and it has been set up.
 */

/**
 * Whether his body is drawn this frame: `pending` while the view waits for it at the start of an
 * arrival, then `drawn` or `absent`, frame by frame.
 */
export type BodyLayer = 'pending' | 'drawn' | 'absent';

/**
 * How long a view holds his arrival for the body, in milliseconds, from the moment it mounts or
 * comes back to the foreground.
 *
 * The wait is his arrival held back, so it has to be short: a context and three programs compiled
 * on the JS thread are expected well inside it, and a device that takes longer is one that would
 * have stuttered through the arrival anyway. A body that comes up later is drawn from the frame it
 * is ready, wherever the arrival has got to by then.
 */
export const BODY_READY_TIMEOUT_MS = 800;

/** No context lost. Context ids are positive. */
const NO_CONTEXT = 0;

/** The body a context holds, handed from the JS thread to the UI thread with the context's id. */
interface HandedBody {
  contextId: number;
  body: GpuBody;
}

/** What a GPU frame draws with. */
export interface GpuBodyDrawing {
  gl: BodyGl;
  body: GpuBody;
}

/** Texels across each half of the halo target: one per pixel of the canvas, and never more than the headset's. */
function haloTexelsFor(gl: BodyGl): number {
  const side = Math.round(gl.drawingBufferWidth);
  return side > 0 && side < HALO_TEXELS ? side : HALO_TEXELS;
}

/**
 * One frame of everything the body draws, at density nought, before the context is handed over:
 * a driver finishes compiling a program the first time it draws with it. expo-gl draws it on its
 * GL thread, and `onContextCreate` waits for it there, so that is paid while he is pending and the
 * UI thread's first `flushEXP` finds it done, rather than holding up his first frame — and with it
 * the rest of the app, whose main thread that is. Nothing of it shows: with no rows there is
 * nothing for the strokes or the halos to light.
 */
function warmUp(gl: BodyGl, body: GpuBody, script: HologramScript) {
  const arrived = createFrameClockState();
  arrived.time = MATERIALISE_SECONDS;
  const state = analyseFrame(hologramFrameOf(arrived, 0), 1, script);
  const side = Math.max(1, gl.drawingBufferWidth);
  const screen = { width: side, height: side, squareX: side / 2, squareY: side / 2, squareSide: side };
  const camera = placeFlatCamera(createFlatCamera(), screen, state.radius, FRONT_VIEW, Number.POSITIVE_INFINITY);
  drawGpuBody(gl, body, { state, density: 0, fade: 1, alphaFromLight: 1, camera });
}

interface GlViewBoundaryProps {
  onFailure: () => void;
  children: ReactNode;
}

/**
 * Keeps a GL view that throws from taking the hologram with it: expo-gl's browser view throws
 * while rendering where there is no WebGL at all. The rest of him carries on without his body.
 */
class GlViewBoundary extends Component<GlViewBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface BodyLayerOptions {
  scene: HologramScene;
  isForeground: boolean;
}

export function useBodyLayer({ scene, isForeground }: BodyLayerOptions) {
  // Whether the GL view is in the tree. It only ever goes away, and only when the GPU cannot draw
  // the body at all, so the view tree changes at most once a mount.
  const [glMounted, setGlMounted] = useState(BodyGlView !== undefined);
  const layer = useSharedValue<BodyLayer>(glMounted ? 'pending' : 'absent');
  const handed = useSharedValue<HandedBody | null>(null);
  // The context last found gone, so it is not tried again.
  const lostContext = useSharedValue(NO_CONTEXT);

  // For the mount: the GL view goes, and he is drawn without his body until the view is mounted again.
  const giveUp = useCallback(() => {
    setGlMounted(false);
    runOnUI(() => {
      'worklet';
      layer.value = 'absent';
    })();
  }, [layer]);

  const onContextCreate = useCallback(
    (gl: BodyGl) => {
      const contextId = adoptGlContext(gl);
      if (contextId === undefined) {
        console.warn('Jarvis is drawn without his body: the GPU gave a context that cannot draw it.');
        giveUp();
        return;
      }
      let body: GpuBody;
      try {
        body = createGpuBody(gl, scene, { haloTexels: haloTexelsFor(gl) });
        warmUp(gl, body, scene);
        gl.endFrameEXP();
        // Waits until the GPU has drawn the warm-up, on this thread rather than the UI thread, and
        // says whether it went wrong: the warm-up makes every call a frame makes, so a frame would.
        if (gl.getError() !== gl.NO_ERROR) {
          throw new Error("The GPU reported an error for his body's warm-up frame.");
        }
      } catch (refusal) {
        // A shader's info log, where it was one; said once, since a device that refuses will refuse again.
        console.warn('Jarvis is drawn without his body: the GPU could not draw it.', refusal);
        giveUp();
        return;
      }
      handed.value = { contextId, body };
    },
    [scene, giveUp, handed],
  );

  // Pending again on every arrival the GL view is there for, for at most BODY_READY_TIMEOUT_MS.
  useEffect(() => {
    if (!isForeground || !glMounted) {
      return;
    }
    layer.value = 'pending';
    const timer = setTimeout(
      () =>
        runOnUI(() => {
          'worklet';
          if (layer.value === 'pending') {
            layer.value = 'absent';
          }
        })(),
      BODY_READY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isForeground, glMounted, layer]);

  /**
   * A worklet: the context and the body to draw this frame with, once the previous frame is done
   * with — or nothing, where there is no body ready or its context has gone. A context found gone
   * is remembered, and waited past until another is handed over.
   */
  const bodyForFrame = (): GpuBodyDrawing | undefined => {
    'worklet';
    const ready = handed.value;
    if (ready === null || ready.contextId === lostContext.value) {
      return undefined;
    }
    const gl = glContextOnDrawingThread(ready.contextId);
    if (gl === undefined || !finishPreviousFrame(gl)) {
      lostContext.value = ready.contextId;
      return undefined;
    }
    return { gl, body: ready.body };
  };

  /**
   * A worklet, for a frame of his clock: the body to draw, if there is one, with the layer set to
   * say so. Pending ends here as soon as the body is ready.
   */
  const bodyThisFrame = (): GpuBodyDrawing | undefined => {
    'worklet';
    const drawing = bodyForFrame();
    const next: BodyLayer = drawing === undefined ? 'absent' : 'drawn';
    if (layer.value !== next) {
      layer.value = next;
    }
    return drawing;
  };

  /** A worklet, for a frame while pending: whether the body is ready, which lets his clock go. */
  const bodyReady = (): boolean => {
    'worklet';
    return bodyForFrame() !== undefined;
  };

  // Shown only while there is a body drawn into it. A context that has gone leaves its canvas
  // behind, and a browser paints that canvas, the next time the page is laid out, as a placeholder
  // of its own — a white square, which Screened over him is all there is to see — while a device's
  // view can go on showing the last frame it was handed, a body frozen over the rest of him moving.
  const shown = useAnimatedStyle(() => ({ opacity: layer.value === 'drawn' ? 1 : 0 }));

  const glView =
    glMounted && BodyGlView !== undefined ? (
      <GlViewBoundary onFailure={giveUp}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.body, shown]}>
          <BodyGlView testID="hologram-body" style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        </Animated.View>
      </GlViewBoundary>
    ) : null;

  return { layer, glView, glMounted, bodyThisFrame, bodyReady };
}

const styles = StyleSheet.create({
  /**
   * Over Skia's picture, Screened onto it: light added to light, as every part of him is drawn, so
   * the two compose as one picture would have.
   */
  body: { mixBlendMode: 'screen' },
});
