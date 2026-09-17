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
 * The drawing decides how many particles it can afford by measuring what it is getting and moving
 * the number until that is the target frame rate — see `density-control.ts`. All a screen has to do
 * is give it somewhere to put the answers and remember the best one for next time.
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

  // What this phone managed last time, so the climb does not have to happen in front of anyone.
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

  // And writing it back. Rarely, and only when it has actually gone up: this is a keystore write,
  // not a counter, and the value only ever rises anyway.
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
