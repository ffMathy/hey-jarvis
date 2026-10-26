import { Component, type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { runOnUI, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import {
  createFlatCamera,
  createGpuBody,
  createGpuPicture,
  drawGpuFrame,
  FRONT_VIEW,
  type GpuBody,
  type GpuPicture,
  HALO_TEXELS,
  placeFlatCamera,
} from '../gpu';
import {
  analyseFrame,
  createFrameClockState,
  type HologramScene,
  hologramFrameOf,
  MATERIALISE_SECONDS,
  pictureSceneOf,
} from '../index';
import { adoptGlContext, BodyGlView, finishPreviousFrame, glContextOnDrawingThread } from './gl-context';
import type { BodyGl } from './gl-contract';

/**
 * Jarvis on the GPU, through expo-gl: the GL view, the context it is drawn with, and whether there
 * is anything to draw this frame. He is all drawn here — his body (`createGpuBody`) and the rest of
 * him (`createGpuPicture`), which was Skia's picture — into the one canvas.
 *
 * **Set up on the JS thread, drawn on the UI thread.** The body and the picture compile their
 * programs and upload their tables with queries that block until the GPU answers, so they are made
 * once per context in `onContextCreate`, which is where the context is handed over, once a frame
 * drawn to warm the driver up has been waited for. They are plain data, and cross to the UI thread
 * through a shared value with the context's id; the frame callback finds the context by that id and
 * draws on the clock it has just stepped. From the handover on, the JS thread never calls GL again:
 * see `gl-context.ts`.
 *
 * **Pending on every arrival, for a bounded while.** His arrival is his body spiralling out of the
 * core, so the frame callback holds his clock at the start of it — where nothing of him shows yet —
 * until he is ready to draw or GPU_READY_TIMEOUT_MS has passed, and then lets it go. Again on every
 * return to the foreground, since a device may make the view a new surface, and a new context with
 * it, while the app is away.
 *
 * **Where the GPU cannot draw him, he is not drawn.** No GL view at all (expo-gl's native module
 * missing from the build, a browser without WebGL 2), a context that is WebGL 1 or OpenGL ES 2, a
 * program that will not compile, a GL view that throws or a warm-up frame the GPU reports an error
 * for: the GL view goes and nothing is pending. There is nothing else to draw him with: the Skia
 * picture that used to stand in for the rest of him is gone. A context lost while he is on screen —
 * expo-gl's calls on it answering `undefined`, a browser's `webglcontextlost` — takes him away from
 * the next frame, and he is drawn again from the first frame after expo-gl hands a new context over
 * and it has been set up.
 */

/**
 * Whether he is drawn this frame: `pending` while the view waits for the GPU at the start of an
 * arrival, then `drawn` or `absent`, frame by frame.
 */
export type GpuLayer = 'pending' | 'drawn' | 'absent';

/**
 * How long a view holds his arrival for the GPU, in milliseconds, from the moment it mounts or
 * comes back to the foreground.
 *
 * The wait is his arrival held back, so it has to be short: a context and the programs compiled on
 * the JS thread are expected well inside it, and a device that takes longer is one that would have
 * stuttered through the arrival anyway. A GPU that comes up later draws him from the frame it is
 * ready, wherever the arrival has got to by then.
 */
export const GPU_READY_TIMEOUT_MS = 800;

/** No context lost. Context ids are positive. */
const NO_CONTEXT = 0;

/** What a context holds, handed from the JS thread to the UI thread with the context's id. */
interface HandedDrawing {
  contextId: number;
  body: GpuBody;
  picture: GpuPicture;
}

/** What a GPU frame draws with. */
export interface GpuDrawing {
  gl: BodyGl;
  body: GpuBody;
  picture: GpuPicture;
}

/** Texels across each half of the halo target: one per pixel of the canvas, and never more than the headset's. */
function haloTexelsFor(gl: BodyGl): number {
  const side = Math.round(gl.drawingBufferWidth);
  return side > 0 && side < HALO_TEXELS ? side : HALO_TEXELS;
}

/**
 * One frame of everything he draws — the body at density nought, and the picture of him formed —
 * before the context is handed over: a driver finishes compiling a program the first time it draws
 * with it. expo-gl draws it on its GL thread, and `onContextCreate` waits for it there, so that is
 * paid while he is pending and the UI thread's first `flushEXP` finds it done, rather than holding up
 * his first frame — and with it the rest of the app, whose main thread that is. It is drawn and
 * cleared away before his first frame: nothing of it shows.
 */
function warmUp(gl: BodyGl, body: GpuBody, picture: GpuPicture, scene: HologramScene) {
  const arrived = createFrameClockState();
  arrived.time = MATERIALISE_SECONDS;
  const state = analyseFrame(hologramFrameOf(arrived), 1, scene);
  const side = Math.max(1, gl.drawingBufferWidth);
  const screen = { width: side, height: side, squareX: side / 2, squareY: side / 2, squareSide: side };
  const camera = placeFlatCamera(createFlatCamera(), screen, state.radius, FRONT_VIEW, Number.POSITIVE_INFINITY);
  drawGpuFrame(gl, body, picture, { state, density: 0, fade: 1, alphaFromLight: 1, camera }, []);
}

interface GlViewBoundaryProps {
  onFailure: () => void;
  children: ReactNode;
}

/**
 * Keeps a GL view that throws from taking the screen with it: expo-gl's browser view throws while
 * rendering where there is no WebGL at all.
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

interface GpuLayerOptions {
  scene: HologramScene;
  isForeground: boolean;
}

export function useGpuLayer({ scene, isForeground }: GpuLayerOptions) {
  // Whether the GL view is in the tree. It only ever goes away, and only when the GPU cannot draw
  // him at all, so the view tree changes at most once a mount.
  const [glMounted, setGlMounted] = useState(BodyGlView !== undefined);
  const layer = useSharedValue<GpuLayer>(glMounted ? 'pending' : 'absent');
  const handed = useSharedValue<HandedDrawing | null>(null);
  // The context last found gone, so it is not tried again.
  const lostContext = useSharedValue(NO_CONTEXT);

  // For the mount: the GL view goes, and nothing of him is drawn until the view is mounted again.
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
        console.warn('Jarvis is not drawn: the GPU gave a context that cannot draw him.');
        giveUp();
        return;
      }
      let body: GpuBody;
      let picture: GpuPicture;
      try {
        body = createGpuBody(gl, scene, { haloTexels: haloTexelsFor(gl) });
        picture = createGpuPicture(gl, pictureSceneOf(scene));
        warmUp(gl, body, picture, scene);
        gl.endFrameEXP();
        // Waits until the GPU has drawn the warm-up, on this thread rather than the UI thread, and
        // says whether it went wrong: the warm-up makes every call a frame makes, so a frame would.
        if (gl.getError() !== gl.NO_ERROR) {
          throw new Error('The GPU reported an error for his warm-up frame.');
        }
      } catch (refusal) {
        // A shader's info log, where it was one; said once, since a device that refuses will refuse again.
        console.warn('Jarvis is not drawn: the GPU could not draw him.', refusal);
        giveUp();
        return;
      }
      handed.value = { contextId, body, picture };
    },
    [scene, giveUp, handed],
  );

  // Pending again on every arrival the GL view is there for, for at most GPU_READY_TIMEOUT_MS.
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
      GPU_READY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isForeground, glMounted, layer]);

  /**
   * A worklet: the context and what to draw with this frame, once the previous frame is done with —
   * or nothing, where nothing is ready or its context has gone. A context found gone is remembered,
   * and waited past until another is handed over.
   */
  const drawingForFrame = (): GpuDrawing | undefined => {
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
    return { gl, body: ready.body, picture: ready.picture };
  };

  /**
   * A worklet, for a frame of his clock: what to draw with, if there is anything, with the layer set
   * to say so. Pending ends here as soon as he is ready.
   */
  const drawingThisFrame = (): GpuDrawing | undefined => {
    'worklet';
    const drawing = drawingForFrame();
    const next: GpuLayer = drawing === undefined ? 'absent' : 'drawn';
    if (layer.value !== next) {
      layer.value = next;
    }
    return drawing;
  };

  /** A worklet, for a frame while pending: whether he is ready to draw, which lets his clock go. */
  const gpuReady = (): boolean => {
    'worklet';
    return drawingForFrame() !== undefined;
  };

  // Shown only while he is drawn into it. A context that has gone leaves its canvas behind, and a
  // browser paints that canvas, the next time the page is laid out, as a placeholder of its own — a
  // white square — while a device's view can go on showing the last frame it was handed, frozen.
  const shown = useAnimatedStyle(() => ({ opacity: layer.value === 'drawn' ? 1 : 0 }));

  const glView =
    glMounted && BodyGlView !== undefined ? (
      <GlViewBoundary onFailure={giveUp}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shown]}>
          <BodyGlView testID="hologram-canvas" style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        </Animated.View>
      </GlViewBoundary>
    ) : null;

  return { layer, glView, glMounted, drawingThisFrame, gpuReady };
}
