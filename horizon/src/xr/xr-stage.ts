import { PerspectiveCamera, Scene, WebGLRenderer, type WebGLRendererParameters } from 'three';
import { chooseFrameRate, type FrameRateTarget } from './frame-rate';
import { type OriginOffset, originPose } from './origin-offset';
import { type CentreEye, centreEyeOfPose } from './viewer-pose';

/**
 * The room, as a renderer and a frame loop over one immersive session.
 *
 * Everything the app draws is added to {@link XrStage.scene}; everything it does per frame
 * subscribes with {@link XrStage.onFrame} and is handed the frame, the `local-floor` reference
 * space, the viewer pose and the centre eye read from it, and the time since the last frame. The
 * stage renders once every subscriber has run, so a subscriber that moves or redraws something
 * does it before the frame is drawn.
 *
 * It also keeps what the session says about itself: whether it is visible, blurred or hidden;
 * how many times the reference space has been reset under it (a recentre moves every pose, and
 * anything cached against the old origin is stale — the count is the epoch that says so); and the
 * display rate it has been asked for.
 *
 * The browser tests can open it with its origin moved (`?origin`, `origin-offset.ts`), so a
 * session in the emulator starts somewhere new in the room as one on a headset does.
 */

/**
 * How hard the headset may blur the edges of the view to save fill: 0 is none, 1 is three's
 * default and the most. He is mostly glow, and glow smeared at the periphery reads as a lens
 * flaw, so this stays low until a headset says the frame rate needs more.
 */
export const FOVEATION = 0.3;

/**
 * How the room's WebGL context is made; the preview's renderers are made the same way.
 *
 * Transparent, so the passthrough shows through everywhere nothing is drawn, and premultiplied,
 * which is how the compositor reads the layer anyway.
 *
 * Multisampled, four samples a pixel. Jarvis smooths his own edges — his strokes are distance
 * fields a pixel soft at the rim, his flat parts are Skia's — and the canvases' outlines are
 * smoothed in their pictures (`ui3d/ui-canvas.ts`), but the rest of the room is plain triangles
 * whose edges nothing else smooths: the tokens and rings of what he works on, the pointing
 * reticle, the pointer arrow, and a canvas's plane seen edge on.
 *
 * With `antialias` set, three's WebXRManager renders each eye into a four-sample target when the
 * browser has WebXR layers: through WEBGL_multisampled_render_to_texture, straight into the
 * projection layer's texture, when the GPU has that extension and the layer ignores depth — the
 * samples then live in the GPU's tile memory and are resolved as each tile is written out — and
 * otherwise into a multisampled renderbuffer that is blitted into the layer at the end of the
 * frame. Without layers it asks the XRWebGLLayer for `antialias`, and the browser multisamples a
 * framebuffer of its own. The framebuffer scale factor, left at 1 (the headset's recommended
 * size), says how many pixels there are; the samples say how many coverage tests each of them
 * gets. Foveation is still set on the layer, whatever the samples; on the blit path the eyes are
 * drawn into three's renderbuffer rather than the layer's own texture, and whether the headset
 * still foveates them there is its to show. Fragments are still shaded once a pixel, so what
 * already smoothed itself is drawn exactly as before: his strokes, the CanvasKit quad and the halo
 * union, which renders into a target of its own that is never multisampled.
 *
 * Meta recommends four samples on Quest, and no more, as nearly free on its tiled GPUs — 0.5 to
 * 1.5 ms a frame in its measurements:
 * https://developers.meta.com/horizon/documentation/unity/gpu-improved-algorithms/ and
 * https://developers.meta.com/vr/documentation/native/android/mobile-msaa-analysis/. Those pages
 * are for native apps on the same GPUs; what it costs in Quest Browser, and whether its layers
 * take the render-to-texture path, only a headset can say (`?debug` shows the frame time and
 * whether the extension is there).
 */
export const RENDERER_PARAMETERS = {
  alpha: true,
  antialias: true,
  premultipliedAlpha: true,
} as const satisfies WebGLRendererParameters;

/**
 * The longest step a single frame may advance anything by, in seconds.
 *
 * The first frame after a blur or a hiccup can come seconds after the last; handed on whole, it
 * would jump every animation to its end in one frame. A tenth of a second is under the shortest
 * thing he does (leaving takes 0.45 s), so it still shows.
 */
export const LONGEST_FRAME_SECONDS = 0.1;

/** What each frame subscriber is handed. */
export interface XrFrameTick {
  frame: XRFrame;
  referenceSpace: XRReferenceSpace;
  viewerPose: XRViewerPose;
  /** The head, from this frame's viewer pose — not three's XR camera, which lags a frame. */
  centreEye: CentreEye;
  /** The frame's time, in milliseconds, as the session's animation frame reports it. */
  time: number;
  /** Seconds since the previous frame, 0 on the first, at most {@link LONGEST_FRAME_SECONDS}. */
  deltaSeconds: number;
  /** How many times the reference space has been reset. */
  epoch: number;
}

export interface XrStage {
  readonly session: XRSession;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /** The session's `local-floor` space — moved by the origin offset, when there is one. */
  readonly referenceSpace: XRReferenceSpace;
  readonly visibility: XRVisibilityState;
  readonly epoch: number;
  /** The rate last asked for, if the headset offers a choice. */
  readonly requestedFrameRate: number | undefined;
  readonly supportedFrameRates: readonly number[];
  /** Settles once the session has ended, however it ended. */
  readonly ended: Promise<void>;
  onFrame(listener: (tick: XrFrameTick) => void): () => void;
  onVisibility(listener: (state: XRVisibilityState) => void): () => void;
  onReset(listener: (epoch: number) => void): () => void;
  /** Asks for the lowest rate, or the highest up to 90; does nothing when that is already what was asked. */
  setFrameRate(target: FrameRateTarget): void;
  /** Ends the session, if it has not ended already. */
  end(): void;
  /** Stops the loop and releases the renderer. Call once the session has ended. */
  dispose(): void;
}

/** `floor` with its origin moved by `origin`, or `floor` itself when there is nothing to move. */
function moveOrigin(floor: XRReferenceSpace, origin: OriginOffset | undefined): XRReferenceSpace {
  if (origin === undefined) return floor;
  const { position, orientation } = originPose(origin);
  return floor.getOffsetReferenceSpace(new XRRigidTransform({ ...position, w: 1 }, orientation));
}

/** Calls each listener, so that one that throws cannot stop the others or the frame. */
function notify<Value>(listeners: Set<(value: Value) => void>, value: Value) {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      // Reported, not rethrown: a throw here would end the frame loop, and with it the room.
      console.error(error);
    }
  }
}

export interface XrStageOptions {
  /** `?origin`: where the room's space starts, from where the headset put it (see `origin-offset.ts`). */
  origin?: OriginOffset;
}

/** Sets up the renderer on `session` and starts the frame loop. */
export async function createXrStage(session: XRSession, options: XrStageOptions = {}): Promise<XrStage> {
  const renderer = new WebGLRenderer(RENDERER_PARAMETERS);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const scene = new Scene();
  // Never used for the room itself: three renders each eye with the XR system's own cameras.
  const camera = new PerspectiveCamera();

  const ended = new Promise<void>((resolve) => session.addEventListener('end', () => resolve(), { once: true }));
  let hasEnded = false;
  void ended.then(() => {
    hasEnded = true;
  });

  await renderer.xr.setSession(session);
  renderer.xr.setFoveation(FOVEATION);
  const floor = renderer.xr.getReferenceSpace();
  if (floor === null) throw new Error('The headset gave the room no floor to stand things on.');
  const referenceSpace = moveOrigin(floor, options.origin);
  // three draws the eyes from the space it is given, so the room and its drawing agree.
  if (referenceSpace !== floor) renderer.xr.setReferenceSpace(referenceSpace);

  const frameListeners = new Set<(tick: XrFrameTick) => void>();
  const visibilityListeners = new Set<(state: XRVisibilityState) => void>();
  const resetListeners = new Set<(epoch: number) => void>();
  let epoch = 0;
  let requestedFrameRate: number | undefined;
  let previousTime: number | undefined;

  // The headset's own space: a recentre resets it, and every space offset from it with it.
  floor.addEventListener('reset', () => {
    epoch += 1;
    notify(resetListeners, epoch);
  });
  session.addEventListener('visibilitychange', () => notify(visibilityListeners, session.visibilityState));

  renderer.setAnimationLoop((time, frame) => {
    if (frame === undefined) return;
    const viewerPose = frame.getViewerPose(referenceSpace);
    // A frame the headset has lost track of itself in has nothing to place anything against.
    if (viewerPose !== undefined) {
      const deltaSeconds =
        previousTime === undefined ? 0 : Math.min(LONGEST_FRAME_SECONDS, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      const centreEye = centreEyeOfPose(viewerPose);
      notify(frameListeners, { frame, referenceSpace, viewerPose, centreEye, time, deltaSeconds, epoch });
    }
    renderer.render(scene, camera);
  });

  return {
    session,
    renderer,
    scene,
    referenceSpace,
    get visibility() {
      return session.visibilityState;
    },
    get epoch() {
      return epoch;
    },
    get requestedFrameRate() {
      return requestedFrameRate;
    },
    get supportedFrameRates() {
      return Array.from(session.supportedFrameRates ?? []);
    },
    ended,
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onVisibility(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => resetListeners.delete(listener);
    },
    setFrameRate(target) {
      const rate = chooseFrameRate(session.supportedFrameRates, target);
      // Older runtimes, and the emulator, may not have the method at all despite what the types say.
      if (rate === undefined || rate === requestedFrameRate || typeof session.updateTargetFrameRate !== 'function') {
        return;
      }
      requestedFrameRate = rate;
      session.updateTargetFrameRate(rate).catch(() => {
        // Refused (the session ended, or the rate is not allowed now): the next change asks again.
        requestedFrameRate = undefined;
      });
    },
    end() {
      if (!hasEnded) session.end().catch(() => undefined);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      frameListeners.clear();
      visibilityListeners.clear();
      resetListeners.clear();
      renderer.dispose();
    },
  };
}
