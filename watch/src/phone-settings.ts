import type { ElevenLabsSettings } from 'conversation';
import { useEffect, useState } from 'react';
import { askThePhoneForSettings, readPhoneSettings, whenSettingsArrive } from '../modules/jarvis-phone';

/** How often the watch asks again while it is sitting on the waiting screen. */
const ASK_AGAIN_MS = 5000;

/** What the watch knows about its credentials, and whether there is a phone answering. */
export interface PhoneHandover {
  /** The credentials, once there are any. */
  settings: ElevenLabsSettings | undefined;
  /** False until the store has been read, so nothing is drawn on a guess. */
  isLoaded: boolean;
  /** Whether the last ask found a phone at all. The waiting screen says different things either way. */
  isPhoneInRange: boolean;
}

/**
 * The credentials, and the asking that gets them.
 *
 * **This is the watch's entire setup.** There is no form, no keyboard and no tour: an ElevenLabs
 * API key is fifty characters that begin `sk_`, and a watch is not where anybody should type one.
 * The phone already has it, the Data Layer exists to carry exactly this, and the two apps share
 * the package name and signing key that Play Services requires before it will — see
 * `watch/AGENTS.md`.
 *
 * Three things can happen, and the screen looks different for each:
 *
 * - **They are already here.** The store survives restarts, so a watch that has been given the key
 *   once never asks again; it opens straight into a conversation, phone or no phone.
 * - **The phone is open and answers.** The ask goes out, the phone sends them back, and
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
  const [settings, setSettings] = useState<ElevenLabsSettings | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPhoneInRange, setIsPhoneInRange] = useState(false);

  // Read once, before anything is drawn. Synchronous on the native side, so this is only an effect
  // in order to keep it out of the render.
  useEffect(() => {
    setSettings(readPhoneSettings());
    setIsLoaded(true);
  }, []);

  // Then listen, for as long as there is nothing stored. A watch that already has the credentials
  // is not waiting for anything, and a listener on a conversation screen would only be there to
  // overwrite them mid-sentence.
  useEffect(() => {
    if (settings) {
      return;
    }
    return whenSettingsArrive(() => setSettings(readPhoneSettings()));
  }, [settings]);

  useEffect(() => {
    if (!isLoaded || settings) {
      return;
    }
    let wanted = true;
    const ask = () => {
      void askThePhoneForSettings().then((asked) => {
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
  }, [isLoaded, settings]);

  return { settings, isLoaded, isPhoneInRange };
}
