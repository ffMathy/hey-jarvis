import { useSharedValue } from 'react-native-reanimated';

/**
 * How many fragments the watch's scene is built from.
 *
 * A fraction of the phone's {@link PARTICLE_COUNT}, and the single biggest thing that makes the
 * sphere affordable here. The density share thins the scene by skipping fragments *inside* the
 * draw loop, so no share, however small, stops the loop visiting every fragment there is — and
 * building the scene costs this many again, serialised into the worklet runtime at mount. Neither
 * is something the controller can steer away from. On a watch both were being paid in full, for a
 * scene sized for a phone.
 *
 * It is a ceiling rather than a count: what is actually drawn starts far below this and only comes
 * up if the frame rate allows, which is the whole point of wiring the controller in below.
 */
export const WATCH_PARTICLE_COUNT = 1200;

/**
 * Everything the drawing needs in order to find a particle count this watch can actually hold.
 *
 * **The watch used to pass none of this, and that was the bug.** `hologram-view.tsx` gates its
 * whole density loop on being given somewhere to write the frame rate — `if (frameRate ===
 * undefined) return;` — so with nothing passed, `steerDensity` never ran once. The share stayed at
 * whatever it started as for the life of the app: it could never climb when there was room, and,
 * worse on a watch, could never fall when there was not. The sphere was drawn at a fixed count
 * chosen by nobody, on the one device least able to afford being wrong about it.
 *
 * Wiring it up is all it takes for the behaviour the watch wanted anyway, because the controller
 * already works this way: it opens at `FEWEST_PARTICLES` — a sixtieth of the scene, which here is
 * twenty fragments — and adds more only while the measured rate is at or above
 * `TARGET_FRAMES_PER_SECOND`, dropping them quickly when it is not. Start at nearly nothing, climb
 * only if the frame rate is held.
 *
 * No persistence, unlike the phone's `useSparkDensity`. What that saves is the second or so of
 * climbing at startup, and it costs a keystore write on a device where the app is opened for a few
 * seconds at a time. The climb is the honest thing to show here: a watch's spare capacity varies
 * far more than a phone's, so last time's answer is a weaker guess.
 */
export function useWatchDensity() {
  // Written by the drawing on the UI thread every measurement window; read by nothing else yet.
  // They exist because handing them over is what turns the controller on.
  const frameRate = useSharedValue(0);
  const buildMilliseconds = useSharedValue(0);
  const particleShare = useSharedValue(0);
  const provenShare = useSharedValue(0);

  return { frameRate, buildMilliseconds, particleShare, provenShare };
}
