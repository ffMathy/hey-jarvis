import { WATCH_PACE } from 'hologram';
import { useSharedValue } from 'react-native-reanimated';

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
 * already works this way: it opens at `FEWEST_PARTICLES` — a fortieth of the scene, which here is
 * thirty fragments — and adds more only while the measured rate is at or above
 * `TARGET_FRAMES_PER_SECOND`, dropping them quickly when it is not. Start at nearly nothing, climb
 * only if the frame rate is held.
 *
 * No persistence, unlike the phone's `useSparkDensity`. What that saves is the second or so of
 * climbing at startup, and it costs a keystore write on a device where the app is opened for a few
 * seconds at a time. The climb is the honest thing to show here: a watch's spare capacity varies
 * far more than a phone's, so last time's answer is a weaker guess.
 */
export function useWatchDensity() {
  // Written by the drawing on the UI thread every measurement window. They exist because handing
  // them over is what turns the controller on. The only other reader is the waiting screen's
  // sample-mode readout — the conversation screen shows none of it.
  const frameRate = useSharedValue(0);
  const buildMilliseconds = useSharedValue(0);
  const particleShare = useSharedValue(0);
  const provenShare = useSharedValue(0);

  // The watch's pace — thirty frames a second — handed to the drawing with the rest.
  return { frameRate, buildMilliseconds, particleShare, provenShare, pace: WATCH_PACE };
}
