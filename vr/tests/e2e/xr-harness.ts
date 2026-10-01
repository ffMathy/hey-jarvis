import { SyntheticEnvironmentModule } from '@iwer/sem';
import { metaQuest3, XRDevice, XRReferenceSpace, XRSession } from 'iwer';

/**
 * An emulated Meta Quest 3 standing in an emulated living room, for the browser tests.
 *
 * Headless Chromium has no headset, so Meta's Immersive Web Emulation Runtime stands in for
 * one: it replaces `navigator.xr` with a Quest 3 that grants `immersive-ar`, and its Synthetic
 * Environment Module plays the passthrough — a real room capture drawn behind the page, with
 * the planes, furniture boxes and room mesh that Quest Browser hands a page from Space Setup.
 * The rooms ship inside the package, so nothing is fetched.
 *
 * This file runs in the page, not in the test. The spec bundles it with esbuild and injects it
 * with `page.addInitScript`, so it is in place before the app's first line runs and never goes
 * anywhere near the production bundle.
 */

export interface XrHarness {
  device: XRDevice;
  /** Settles once the room has loaded; entering the room before then finds it empty. */
  ready: Promise<void>;
  /**
   * When each XR frame the page was handed was stamped, in milliseconds on the page's clock: how
   * slowly the emulator drew, which `fixtures.ts` reports after every test. SwiftShader's frame
   * times on a CPU, which say how busy the machine was and nothing about a Quest's.
   */
  frameTimes: number[];
}

declare global {
  interface Window {
    __xrHarness?: XrHarness;
  }
}

/**
 * Where the emulated head stands: at the living room's south end, eyes at 1.6 m, looking north
 * across the room at the windows — so a hologram placed ahead of him lands in the middle of the
 * room with the whole of it behind.
 *
 * The capture's origin is on the floor near the middle of the room, which runs from about
 * x = -2.9 to 3.0 and z = -2.5 to 2.1, with the couch along the east wall and the windows in
 * the north one.
 */
const HEAD_POSITION = { x: 0, y: 1.6, z: 1.2 };

/** What IWER's `getOffsetReferenceSpace` takes, against the WebXR spec: the offset as a bare matrix. */
type OffsetMatrix = Parameters<XRReferenceSpace['getOffsetReferenceSpace']>[0];

/**
 * Teaches the emulator `XRReferenceSpace.getOffsetReferenceSpace` as the WebXR spec and Quest
 * Browser have it: taking an `XRRigidTransform`.
 *
 * IWER 2.4 takes a bare matrix instead (its own typings say so) and clones whatever it is given as
 * one, so the spec's transform becomes a matrix of NaNs; the failed inverse then leaves the new
 * space silently behaving as the emulator's global one. The app's `?origin` seam
 * (`src/xr/origin-offset.ts`) passes the spec's transform, which is what a headset needs, so the
 * transform's own matrix is handed on here.
 */
function acceptRigidTransforms() {
  const offsetByMatrix = XRReferenceSpace.prototype.getOffsetReferenceSpace;
  XRReferenceSpace.prototype.getOffsetReferenceSpace = function (
    this: XRReferenceSpace,
    originOffset: OffsetMatrix | { readonly matrix: Float32Array },
  ) {
    return offsetByMatrix.call(this, 'matrix' in originOffset ? originOffset.matrix : originOffset);
  };
}

/**
 * Writes down the time of every XR frame into `times`, by wrapping the emulator's
 * `XRSession.requestAnimationFrame`: every callback of a frame is handed the same time, so it is
 * written once.
 */
function recordFrameTimes(times: number[]) {
  const request = XRSession.prototype.requestAnimationFrame;
  XRSession.prototype.requestAnimationFrame = function (
    this: XRSession,
    callback: Parameters<XRSession['requestAnimationFrame']>[0],
  ) {
    return request.call(this, (time, frame) => {
      if (times.at(-1) !== time) times.push(time);
      callback(time, frame);
    });
  };
}

function installHarness(): XrHarness {
  acceptRigidTransforms();
  const frameTimes: number[] = [];
  recordFrameTimes(frameTimes);
  const device = new XRDevice(metaQuest3);
  // Chromium has a `navigator.xr` of its own, which says no to immersive-ar. Without
  // `forceInstall` the runtime sees it, decides a real one is present and does nothing at all.
  device.installRuntime({ forceInstall: true });
  device.position.set(HEAD_POSITION.x, HEAD_POSITION.y, HEAD_POSITION.z);
  device.installSEM(SyntheticEnvironmentModule);
  // Narrowed to the module's own class: the emulator types `sem` as a minimal interface whose
  // loadDefaultEnvironment returns nothing, while the real one returns the load's promise.
  const environment = device.sem;
  if (!(environment instanceof SyntheticEnvironmentModule)) {
    throw new Error('The synthetic environment did not install.');
  }
  return { device, ready: environment.loadDefaultEnvironment('living_room'), frameTimes };
}

window.__xrHarness = installHarness();
