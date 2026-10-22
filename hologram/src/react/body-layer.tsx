import { Component, type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  runOnUI,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
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
  type BodyLayer,
  type BodyRenderer,
  bodyStartingShare,
  createDensityControl,
  createFrameClockState,
  type DensityControl,
  type DensityPace,
  GPU_READY_TIMEOUT_MS,
  type HologramScene,
  type HologramScript,
  hologramFrameOf,
  MATERIALISE_SECONDS,
} from '../index';
import {
  adoptGlContext,
  BodyGlView,
  finishPreviousFrame,
  GPU_BODY_SUPPORTED,
  glContextOnDrawingThread,
} from './gl-context';
import type { BodyGl } from './gl-contract';

/**
 * Which renderer draws Jarvis's body, and the GL context the GPU's is drawn with: everything about
 * the GPU body that is not the drawing itself.
 *
 * **Set up on the JS thread, drawn on the UI thread.** `createGpuBody` compiles three programs and
 * uploads about 3 MB of rows, with queries that block until the GPU answers, so it runs once per
 * context in `onContextCreate`, which is where the context is handed over. The body it returns is
 * plain data, and crosses to the UI thread through a shared value with the context's id; the frame
 * callback finds the context by that id and draws, beside the picture it steps on the same clock.
 * From the handover on, the JS thread never calls GL again: see `gl-context.ts`.
 *
 * **Pending, then the GPU or Skia, and never a flash.** A view asked for the GPU body starts
 * pending, and the frame callback holds his clock at the start of the arrival — where he has not
 * yet appeared — until the context is ready or GPU_READY_TIMEOUT_MS has passed. Then it lets the
 * clock go with whichever renderer is ready. Again on every return to the foreground, since a
 * device may make the view a new surface, and a new context with it, while the app is away.
 *
 * **Skia takes the body over, rather than the hologram failing.** A context that is WebGL 1, a
 * program that will not compile, a view that throws, or a first frame the GPU reports an error for
 * puts the body in Skia for as long as the view is mounted, and takes the GL view away. A context
 * lost while he is on screen — expo-gl's calls on it answering `undefined`, a browser's
 * `webglcontextlost` — puts it in Skia from the next frame, and the GPU has it back at the next
 * arrival if a context has come back by then. The body never changes renderer mid-show otherwise.
 *
 * **Each change of renderer starts the density loop again** from that renderer's starting share
 * (`bodyStartingShare`): a share the one could hold says nothing about the other.
 */

/** No context: none lost, none checked. Context ids are positive. */
const NO_CONTEXT = 0;
/** `gl.NO_ERROR`, which a worklet reads as a number rather than off the context. */
const NO_ERROR = 0;

/** The body a context holds, handed from the JS thread to the UI thread with the context's id. */
interface HandedBody {
  contextId: number;
  body: GpuBody;
}

/** What a GPU frame draws with. */
export interface GpuBodyDrawing extends HandedBody {
  gl: BodyGl;
}

/** Whether a view asked for `asked` draws the body on the GPU at all, which is fixed for as long as it is mounted. */
export function gpuBodyWanted(asked: BodyRenderer): boolean {
  return asked === 'gpu' && GPU_BODY_SUPPORTED && BodyGlView !== undefined;
}

/** Texels across each half of the halo target: one per pixel of the canvas, as Skia draws them, and never more than the headset's. */
function haloTexelsFor(gl: BodyGl): number {
  const side = Math.round(gl.drawingBufferWidth);
  return side > 0 && side < HALO_TEXELS ? side : HALO_TEXELS;
}

/**
 * One frame of everything the body draws, at density nought, before the context is handed over:
 * a driver finishes compiling a program the first time it draws with it, and this way that is paid
 * on the JS thread while he is pending rather than on the UI thread in his first frame. Nothing of
 * it shows: with no rows there is nothing for the strokes or the halos to light.
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
 * while rendering where there is no WebGL at all. Skia's body then carries on alone.
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
  /** Whether this view tries the GPU at all: `gpuBodyWanted`, fixed for the mount. */
  wanted: boolean;
  scene: HologramScene;
  isForeground: boolean;
  /** The view's density loop, started again whenever the body changes renderer. */
  density: SharedValue<DensityControl>;
  /** The share remembered from last time, as the view was handed it. */
  startingShare: number | undefined;
  pace: DensityPace | undefined;
}

export function useBodyLayer({ wanted, scene, isForeground, density, startingShare, pace }: BodyLayerOptions) {
  // Whether the GL view is in the tree. It only ever goes away, and only when the GPU cannot draw
  // the body at all, so the view tree changes at most once a mount.
  const [glMounted, setGlMounted] = useState(wanted);
  const layer = useSharedValue<BodyLayer>(wanted ? 'pending' : 'skia');
  // Which renderer the density loop was last started for.
  const steeredFor = useSharedValue<BodyRenderer>(wanted ? 'gpu' : 'skia');
  const handed = useSharedValue<HandedBody | null>(null);
  // The context last found gone, so it is not tried again; and the last whose first frame was checked.
  const lostContext = useSharedValue(NO_CONTEXT);
  const checkedContext = useSharedValue(NO_CONTEXT);
  // A shared value rather than the prop, so the worklets below keep one identity for the mount: the
  // remembered share arrives a moment after the first render.
  const remembered = useSharedValue(startingShare);
  useEffect(() => {
    remembered.value = startingShare;
  }, [startingShare, remembered]);

  const drawBodyWith = useCallback(
    (renderer: BodyRenderer) => {
      'worklet';
      layer.value = renderer;
      if (steeredFor.value !== renderer) {
        steeredFor.value = renderer;
        density.value = createDensityControl(bodyStartingShare(renderer, remembered.value), pace);
      }
    },
    [layer, steeredFor, density, remembered, pace],
  );

  // For good: the GL view goes, and Skia draws the body until the view is mounted again.
  const giveUp = useCallback(() => {
    setGlMounted(false);
    runOnUI(drawBodyWith)('skia');
  }, [drawBodyWith]);

  const onContextCreate = useCallback(
    (gl: BodyGl) => {
      const contextId = adoptGlContext(gl);
      if (contextId === undefined) {
        giveUp();
        return;
      }
      let body: GpuBody;
      try {
        body = createGpuBody(gl, scene, { haloTexels: haloTexelsFor(gl) });
        warmUp(gl, body, scene);
        gl.endFrameEXP();
      } catch (refusal) {
        // A shader's info log, where it was one; said once, since a device that refuses will refuse again.
        console.warn('Jarvis is drawn by Skia alone: the GPU could not draw his body.', refusal);
        giveUp();
        return;
      }
      handed.value = { contextId, body };
    },
    [scene, giveUp, handed],
  );

  // Pending again on every arrival the GL view is there for, and Skia's if the GPU is not ready in time.
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
            drawBodyWith('skia');
          }
        })(),
      GPU_READY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isForeground, glMounted, layer, drawBodyWith]);

  /**
   * A worklet, for a frame while pending: whether the GPU body is ready, in which case the body is
   * the GPU's from this frame on. A context found gone is remembered, and waited past.
   */
  const startOnGpu = (): boolean => {
    'worklet';
    const ready = handed.value;
    if (ready === null || ready.contextId === lostContext.value) {
      return false;
    }
    const gl = glContextOnDrawingThread(ready.contextId);
    if (gl === undefined || !finishPreviousFrame(gl)) {
      lostContext.value = ready.contextId;
      return false;
    }
    drawBodyWith('gpu');
    return true;
  };

  /**
   * A worklet, at the start of a frame the GPU draws: the context and the body, once the previous
   * frame is done with — or nothing, with the body Skia's from this frame on, if the context has gone.
   */
  const gpuForFrame = (): GpuBodyDrawing | undefined => {
    'worklet';
    const ready = handed.value;
    const gl = ready === null ? undefined : glContextOnDrawingThread(ready.contextId);
    if (ready === null || gl === undefined || !finishPreviousFrame(gl)) {
      if (ready !== null) {
        lostContext.value = ready.contextId;
      }
      drawBodyWith('skia');
      return undefined;
    }
    return { gl, body: ready.body, contextId: ready.contextId };
  };

  /**
   * A worklet, at the end of a frame the GPU drew: presents it, and after a context's first frame
   * asks the GPU once whether anything went wrong — a question that waits for the GPU to answer, so
   * it is asked once and never again.
   */
  const presentGpuFrame = ({ gl, contextId }: GpuBodyDrawing) => {
    'worklet';
    gl.endFrameEXP();
    if (checkedContext.value === contextId) {
      return;
    }
    checkedContext.value = contextId;
    if (gl.getError() !== NO_ERROR) {
      lostContext.value = contextId;
      drawBodyWith('skia');
      runOnJS(setGlMounted)(false);
    }
  };

  // Shown only while the GPU draws the body. A context that has gone leaves its canvas behind, and
  // a browser paints that canvas, the next time the page is laid out, as a placeholder of its own —
  // a white square, which Screened over him is all there is to see — while a device's view can go
  // on showing the last frame it was handed, a body frozen over Skia's moving one. Pending, there
  // is nothing of him to show yet either way.
  const shown = useAnimatedStyle(() => ({ opacity: layer.value === 'gpu' ? 1 : 0 }));

  const glView =
    glMounted && BodyGlView !== undefined ? (
      <GlViewBoundary onFailure={giveUp}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.body, shown]}>
          <BodyGlView testID="hologram-body" style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        </Animated.View>
      </GlViewBoundary>
    ) : null;

  return { glMounted, layer, glView, startOnGpu, gpuForFrame, presentGpuFrame };
}

const styles = StyleSheet.create({
  /**
   * Over Skia's picture, Screened onto it: light added to light, as every part of him is drawn, so
   * the two compose as one picture would have.
   */
  body: { mixBlendMode: 'screen' },
});
