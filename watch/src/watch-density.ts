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
 * already works this way: it opens at `FEWEST_PARTICLES` — a fortieth of the scene, which on the
 * watch's `WATCH_PARTICLE_COUNT` is 125 fragments — and adds more while building a picture takes
 * less than the watch's budget (`WATCH_PACE`: 16 ms, at thirty frames a second), never past a count
 * at which the frame rate was seen falling behind, and sheds them quickly when either says it is
 * too many. Start at nearly nothing, climb only while it is affordable.
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

  // The watch's pace — sixteen milliseconds to build a picture, and thirty frames a second as the
  // backstop — handed to the drawing with the rest.
  return { frameRate, buildMilliseconds, particleShare, provenShare, pace: WATCH_PACE };
}
