import { startFromRemembered } from 'hologram';
import { useEffect, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { readProvenSparks, rememberProvenSparks } from './spark-memory';

/** How often the remembered count is looked at, and how much better it has to be to be written. */
const REMEMBER_EVERY_MS = 4000;
const REMEMBER_WHEN_BETTER_BY = 0.03;

/**
 * Everything a screen needs in order to let the hologram find its own particle count.
 *
 * The drawing decides how many particles it can afford by measuring what it is getting — how long
 * each picture takes to build, with the frame rate as a backstop — and moving the number until it
 * is right; see `density-control.ts`. All a screen has to do is give it somewhere to put the answers
 * and remember the best one for next time.
 *
 * In a hook of its own because both screens want it and the wiring is fiddly enough to get subtly
 * wrong twice: four shared values, a read that has to finish before the first frame is useful, and
 * a write that must not happen often. Sample mode had it first; the conversation screen had none of
 * it, and so drew whatever the default was on every phone regardless of what the phone could do.
 */
export function useSparkDensity() {
  // Filled in on the UI thread by the hologram, read back by whoever is watching.
  const frameRate = useSharedValue(0);
  const buildMilliseconds = useSharedValue(0);
  // Nought means "nothing measured yet", which is what lets the hologram tell a first mount from a
  // rebuilt one and carry the count across the second.
  const particleShare = useSharedValue(0);
  const provenShare = useSharedValue(0);
  const [startingShare, setStartingShare] = useState<number | undefined>(undefined);

  // Half of what this phone was last seen holding, so the climb starts somewhere it is already
  // known to be safe rather than at the floor — and, just as importantly, never above it.
  useEffect(() => {
    let wanted = true;
    void readProvenSparks().then((proven) => {
      if (wanted && proven > 0) {
        setStartingShare(startFromRemembered(proven));
      }
    });
    return () => {
      wanted = false;
    };
  }, []);

  // And writing it back. Rarely, and only once it has risen within this summoning: this is a
  // keystore write rather than a counter, and the loop's own high-water mark only ever goes up.
  //
  // Across summonings it is not a high-water mark, and that is deliberate: `written` begins at
  // nought every time, so what today's phone settles at replaces what yesterday's managed, down as
  // well as up. A phone that has picked up a background job it is not going to put down should be
  // allowed to say so. What makes that safe rather than a slow slide to the floor is that each
  // summoning climbs and re-proves for itself — see the launch-after-launch tests in
  // `density-control.spec.ts`.
  //
  // What is written is a count the loop *settled* at rather than one it climbed through — see
  // `proven` in `density-control.ts` — so a number that reaches the keystore is one the phone
  // held, not one it was given just before it fell over.
  useEffect(() => {
    let written = 0;
    const timer = setInterval(() => {
      const proven = provenShare.value;
      if (proven > written + REMEMBER_WHEN_BETTER_BY) {
        written = proven;
        void rememberProvenSparks(proven);
      }
    }, REMEMBER_EVERY_MS);
    return () => clearInterval(timer);
  }, [provenShare]);

  return { frameRate, buildMilliseconds, particleShare, provenShare, startingShare };
}
