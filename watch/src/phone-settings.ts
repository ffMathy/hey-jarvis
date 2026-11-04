import type { Pairing } from 'hologram';
import { useEffect, useState } from 'react';
import { askThePhoneForPairing, readPhonePairing, whenSettingsArrive } from '../modules/jarvis-phone';

/** How often the watch asks again while it is sitting on the waiting screen. */
const ASK_AGAIN_MS = 5000;

/** What the watch knows about its pairing, and whether there is a phone answering. */
export interface PhoneHandover {
  /** The phone's pairing with the Jarvis server, once it has handed it over. */
  pairing: Pairing | undefined;
  /** False until the store has been read, so nothing is drawn on a guess. */
  isLoaded: boolean;
  /** Whether the last ask found a phone at all. The waiting screen says different things either way. */
  isPhoneInRange: boolean;
}

/**
 * The phone's pairing with the Jarvis server, and the asking that gets it.
 *
 * **This is the watch's entire setup.** There is no form, no keyboard and no tour: pairing signs
 * in to Cloudflare Access in a browser, and a watch has none. The phone is paired already, the Data
 * Layer exists to carry exactly this, and the two apps share the package name and signing key that
 * Play Services requires before it will — see `.claude/rules/watch.md`. The watch shares the phone's
 * pairing, so unpairing the phone on the server unpairs the watch too.
 *
 * Three things can happen, and the screen looks different for each:
 *
 * - **It is already here.** The store survives restarts, so a watch that has been given the pairing
 *   once never asks again; it opens straight into a conversation, phone or no phone.
 * - **The phone is open and answers.** The ask goes out, the phone sends it back, and
 *   `onSettingsArrived` lands while this is still on screen.
 * - **The phone is asleep, or Jarvis is not open on it.** Nothing comes back. The watch keeps
 *   asking every few seconds — a request with no payload, over a link that is already up — and the
 *   screen says to open Jarvis on the phone, because that is the one thing that will help.
 *
 * The repeat is not a retry loop around a failure: each ask is the same request to a phone that
 * may since have woken up or had Jarvis opened on it, and there is no other event that would tell
 * the watch either of those things had happened.
 */
export function usePhoneHandover(): PhoneHandover {
  const [pairing, setPairing] = useState<Pairing | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPhoneInRange, setIsPhoneInRange] = useState(false);

  // Read once, before anything is drawn. Synchronous on the native side, so this is only an effect
  // in order to keep it out of the render.
  useEffect(() => {
    setPairing(readPhonePairing());
    setIsLoaded(true);
  }, []);

  // Then listen, for as long as there is nothing stored. A watch that already has the pairing is not
  // waiting for anything; a new one the phone sends later lands in the store, and is read the next
  // time the app starts.
  useEffect(() => {
    if (pairing) {
      return;
    }
    return whenSettingsArrive(() => setPairing(readPhonePairing()));
  }, [pairing]);

  useEffect(() => {
    if (!isLoaded || pairing) {
      return;
    }
    let wanted = true;
    const ask = () => {
      void askThePhoneForPairing().then((asked) => {
        if (wanted) {
          setIsPhoneInRange(asked);
        }
      });
    };
    ask();
    const again = setInterval(ask, ASK_AGAIN_MS);
    return () => {
      wanted = false;
      clearInterval(again);
    };
  }, [isLoaded, pairing]);

  return { pairing, isLoaded, isPhoneInRange };
}
