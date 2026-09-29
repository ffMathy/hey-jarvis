import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { chooseFrameRate, type FrameRateTarget } from './frame-rate';
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
 */

/**
 * How hard the headset may blur the edges of the view to save fill: 0 is none, 1 is three's
 * default and the most. He is mostly glow, and glow smeared at the periphery reads as a lens
 * flaw, so this stays low until a headset says the frame rate needs more.
 */
export const FOVEATION = 0.3;

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
  /** The session's `local-floor` space. */
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

/** Sets up the renderer on `session` and starts the frame loop. */
export async function createXrStage(session: XRSession): Promise<XrStage> {
  // Transparent, so the passthrough shows through everywhere he is not; premultiplied, which is
  // how the compositor reads the layer anyway; no multisampling, because what is drawn here is
  // antialiased by its own shaders and by Skia.
  const renderer = new WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true });
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
  const referenceSpace = renderer.xr.getReferenceSpace();
  if (referenceSpace === null) throw new Error('The headset gave the room no floor to stand things on.');

  const frameListeners = new Set<(tick: XrFrameTick) => void>();
  const visibilityListeners = new Set<(state: XRVisibilityState) => void>();
  const resetListeners = new Set<(epoch: number) => void>();
  let epoch = 0;
  let requestedFrameRate: number | undefined;
  let previousTime: number | undefined;

  referenceSpace.addEventListener('reset', () => {
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
