import { useSharedValue } from 'react-native-reanimated';

/**
 * Everything a screen needs in order to let the hologram find its own particle count.
 *
 * The hologram decides how many particles it can afford by measuring what it is getting — how long
 * each frame takes to build, with the frame rate as a backstop — and moving the number until it is
 * right; see `density-control.ts`. All a screen has to do is give it somewhere to put the answers,
 * and handing them over is what turns the loop on at all.
 *
 * In a hook of its own because both screens want it. Sample mode had it first; the conversation
 * screen had none of it, and so drew whatever the default was on every phone regardless of what
 * the phone could do.
 */
export function useSparkDensity() {
  // Filled in on the UI thread by the hologram, read back by whoever is watching.
  const frameRate = useSharedValue(0);
  const buildMilliseconds = useSharedValue(0);
  const particleShare = useSharedValue(0);
  return { frameRate, buildMilliseconds, particleShare };
}
