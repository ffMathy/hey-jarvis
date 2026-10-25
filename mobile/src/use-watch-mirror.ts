import { encodeMirrorFrame, MIRROR_INTERVAL_MS, type MirroredSphereState } from 'hologram';
import { useEffect, useRef } from 'react';
import { isMirroringOnTheWatch, mirrorOnTheWatch } from '../modules/jarvis-assistant';

/**
 * Shows the watch what this phone's sphere is doing, when it was the watch that summoned him.
 *
 * Summoned on the wrist with AirPods in, the conversation is held here, in the earbuds, and the
 * watch says nothing (`JarvisWatchSummonService.kt`). It still shows him, though — it is what was
 * looked at — so every {@link MIRROR_INTERVAL_MS} this reads what the sphere here is being handed and
 * sends it across, and he moves on the wrist as he does here: talking, listening, thinking. The
 * frame's layout is `mirrored-sphere.ts` in `hologram`, which the watch decodes with.
 *
 * Only in the assistant's window, the one place a summoning from the watch is shown, and only while
 * a watch is following, which the native side knows from the moment it told the watch yes until the
 * window is put away — when it tells the watch he has stopped.
 */
export function useWatchMirror(sphere: MirroredSphereState, inAssistantWindow: boolean): void {
  // Read at each frame rather than captured, since the voice is a new object on most renders.
  const latest = useRef(sphere);
  latest.current = sphere;

  useEffect(() => {
    if (!inAssistantWindow) {
      return;
    }
    const timer = setInterval(() => {
      if (isMirroringOnTheWatch()) {
        mirrorOnTheWatch(encodeMirrorFrame(latest.current));
      }
    }, MIRROR_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inAssistantWindow]);
}
