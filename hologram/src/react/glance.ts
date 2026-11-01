import { useEffect, useState } from 'react';
import type { Glance } from '../glance';
import type { ServerLink } from '../jarvis-server-link';

/**
 * The latest glance `link` has heard from the server (`glance.ts`), for a screen to show: `undefined`
 * with no line, and until the server has sent one. A new line starts from whatever it has heard, so a
 * glance that arrived before the screen listened is not missed (`ServerLink.onGlance`).
 *
 * Clear of expo-gl, so a screen can hold it without the view (`lifecycle.ts`).
 */
export function useGlance(link: ServerLink | undefined): Glance | undefined {
  const [glance, setGlance] = useState<Glance | undefined>(undefined);
  useEffect(() => {
    if (link === undefined) {
      setGlance(undefined);
      return;
    }
    return link.onGlance(setGlance);
  }, [link]);
  return glance;
}
