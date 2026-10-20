import { createContext, useEffect, useRef } from 'react';
import { type SharedValue, useSharedValue } from 'react-native-reanimated';
import { activityOfMessage } from '../agent-activity';
import {
  type AgentWorkState,
  NO_WORK,
  pretendWork,
  recordActivity,
  type SatelliteOrbit,
  satelliteOrbits,
  stepWork,
} from '../agent-work';
import { READ_INTERVAL_MS } from '../frame-timing';
import type { ServerLink } from '../jarvis-server-link';

/**
 * The satellites round him on a screen: which of his agents a request is using, from the server's
 * `agentActivity` messages, worked out on the JS thread and handed to the view's picture on the UI
 * thread as a shared value — as his voice is, and on the same beat (`READ_INTERVAL_MS`). Only where
 * each is on the ring is fixed here; the view goes round with its own frame clock, so they move as
 * smoothly as he turns (`satellite-drawing.ts`).
 *
 * Skia-free, so a screen can hold it before CanvasKit has loaded in a browser (`lifecycle.ts`).
 */

/**
 * The satellites for every `JarvisHologram` under it that is not handed its own — the phone puts
 * its line's at the top of the app, so whichever screen shows him shows them. None given, there are none.
 */
export const AgentSatellitesContext = createContext<SharedValue<SatelliteOrbit[]> | undefined>(undefined);

/** Seconds on a steady clock, which is all the lifecycle asks of one. */
function nowSeconds(): number {
  return performance.now() / 1000;
}

/**
 * The satellites `link` says are out, and — while `pretending` — sample mode's pretend agents at
 * work (`pretendWork`), so they can be seen with no server at all. With no line and nothing
 * pretended, there are none.
 */
export function useAgentSatellites(link: ServerLink | undefined, pretending = false): SharedValue<SatelliteOrbit[]> {
  const orbits = useSharedValue<SatelliteOrbit[]>([]);
  const work = useRef<AgentWorkState>(NO_WORK);
  const pretend = useRef(pretending);
  pretend.current = pretending;

  useEffect(() => {
    if (link === undefined) return;
    return link.subscribe((message) => {
      if (message.type !== 'agentActivity') return;
      work.current = recordActivity(work.current, activityOfMessage(message), nowSeconds());
    });
  }, [link]);

  useEffect(() => {
    let drawing = false;
    const step = () => {
      const now = nowSeconds();
      work.current = stepWork(pretendWork(work.current, pretend.current, now), now);
      const next = satelliteOrbits(work.current, now);
      // Written only while there is something to draw, and once more to clear it: a write is a
      // reason for the picture to be built again.
      if (next.length > 0 || drawing) orbits.value = next;
      drawing = next.length > 0;
    };
    const timer = setInterval(step, READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [orbits]);

  return orbits;
}
