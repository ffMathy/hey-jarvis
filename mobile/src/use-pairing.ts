import type { Pairing } from 'hologram';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadJarvisDeviceToken,
  loadJarvisServerAddress,
  pairedTokenFromLink,
  saveJarvisDeviceToken,
  saveJarvisServerAddress,
} from './jarvis-server';
import { readTryingAgain } from './read-again';

/**
 * The Jarvis server's address to use: the one read, or none — an address that still cannot be read
 * after `readTryingAgain` has tried is no address.
 */
async function readJarvisServerAddress(stillWanted: () => boolean): Promise<string | undefined> {
  const stored = await readTryingAgain(loadJarvisServerAddress, stillWanted);
  return stored?.kind === 'address' ? stored.address : undefined;
}

/** The token this device was paired with, read as the address is: one that still cannot be read is none. */
async function readJarvisDeviceToken(stillWanted: () => boolean): Promise<string | undefined> {
  const stored = await readTryingAgain(loadJarvisDeviceToken, stillWanted);
  return stored?.kind === 'token' ? stored.token : undefined;
}

/** This device's pairing with the Jarvis server, and the ways it changes. */
export interface PairingState {
  /** The server's address, which the phone app keeps before it has a token from the server. */
  serverAddress: string | undefined;
  /** The address and the token together, once there are both: what being set up is. */
  pairing: Pairing | undefined;
  /** False until the store has been read, so nothing is drawn on a guess. */
  isRead: boolean;
  /**
   * The phone app is opening the server's pairing page for this address. It is kept now, since the
   * token comes back on a link that names no server; a pairing is with one server, so another
   * address forgets the token there was.
   */
  keepPairingAddress: (address: string) => void;
  /** A browser was paired there and then (`server-pairing.tsx`): the address and the token are kept. */
  savePairing: (pairing: Pairing) => void;
  /** Forgets the server, and with it the pairing: the app is not set up any more. */
  forgetServer: () => void;
}

/**
 * Where sir's Jarvis server is, and the token it gave this device when it was paired with it:
 * together, the pairing — the only setting the app has. Kept apart, because the phone app keeps the
 * address before it has a token: it opens the server's pairing page in the browser, and the token
 * comes back later on the app's own link (`launchUrl`). See `jarvis-server.ts`.
 *
 * `showing` and `launchUrl` are what say a summoning happened, which is when it is read again.
 */
export function usePairing(showing: number | undefined, launchUrl: string | null): PairingState {
  const [serverAddress, setServerAddress] = useState<string | undefined>(undefined);
  const [deviceToken, setDeviceToken] = useState<string | undefined>(undefined);
  const [isRead, setIsRead] = useState(false);

  /**
   * Reads the pairing, and tries again if the *reading* failed rather than there being none — see
   * `read-again.ts` for the blank sheet that answering both the same way caused. If every attempt
   * fails the settings screen opens, which is the right answer for a keystore that genuinely cannot
   * be read any more.
   */
  useEffect(() => {
    let wanted = true;
    const stillWanted = () => wanted;
    void Promise.all([readJarvisServerAddress(stillWanted), readJarvisDeviceToken(stillWanted)]).then(
      ([storedServerAddress, storedDeviceToken]) => {
        if (wanted) {
          setServerAddress(storedServerAddress);
          // A pairing link the app was opened with may have arrived while this was being read.
          setDeviceToken((paired) => paired ?? storedDeviceToken);
          setIsRead(true);
        }
      },
    );
    return () => {
      wanted = false;
    };
  }, []);

  /**
   * Reads the pairing again for every summoning after the first.
   *
   * **This window may not be where it was changed.** The assistant's window is kept between
   * summonings, with its own copy of everything read when it was made, and the pairing is as often
   * made in the app's own window — the one the launcher opens, where the settings are most often
   * reached, and the one the pairing page's link opens. Read once, a pairing made there never reached
   * the window Jarvis is summoned into, and one forgotten there went on being used from it. A
   * summoning is a new `showing` in the assistant's window and a new launch URL in the app's own, so
   * either is read as one.
   */
  const seenSummoning = useRef({ showing, launchUrl });
  useEffect(() => {
    if (showing === seenSummoning.current.showing && launchUrl === seenSummoning.current.launchUrl) {
      return;
    }
    seenSummoning.current = { showing, launchUrl };
    let wanted = true;
    void Promise.all([readJarvisServerAddress(() => wanted), readJarvisDeviceToken(() => wanted)]).then(
      ([storedServerAddress, storedDeviceToken]) => {
        if (wanted) {
          setServerAddress(storedServerAddress);
          // The pairing link itself is a new launch URL too, and its token is being kept as this reads.
          setDeviceToken(pairedTokenFromLink(launchUrl) ?? storedDeviceToken);
        }
      },
    );
    return () => {
      wanted = false;
    };
  }, [showing, launchUrl]);

  // The server's pairing page opens the app with its token (`pairedTokenFromLink`): kept beside the
  // address the page was opened for, and used at once, so the next conversation is the server's and
  // the line opens on the paired path. A token the keystore would not keep still works until the app
  // is closed, and pairing again keeps it.
  useEffect(() => {
    const paired = pairedTokenFromLink(launchUrl);
    if (paired === undefined) return;
    setDeviceToken(paired);
    saveJarvisDeviceToken(paired).catch((error: unknown) => {
      console.warn('The phone could not keep its pairing with the Jarvis server; pair it again.', error);
    });
  }, [launchUrl]);

  const keepPairingAddress = useCallback(
    (address: string) => {
      if (address !== serverAddress) {
        setDeviceToken(undefined);
        void saveJarvisDeviceToken(undefined);
      }
      setServerAddress(address);
      void saveJarvisServerAddress(address);
    },
    [serverAddress],
  );

  const savePairing = useCallback(({ address, deviceToken: token }: Pairing) => {
    setServerAddress(address);
    setDeviceToken(token);
    void saveJarvisServerAddress(address);
    void saveJarvisDeviceToken(token);
  }, []);

  const forgetServer = useCallback(() => {
    setServerAddress(undefined);
    setDeviceToken(undefined);
    void saveJarvisServerAddress(undefined);
    void saveJarvisDeviceToken(undefined);
  }, []);

  const pairing = useMemo<Pairing | undefined>(
    () =>
      serverAddress === undefined || deviceToken === undefined ? undefined : { address: serverAddress, deviceToken },
    [serverAddress, deviceToken],
  );

  return { serverAddress, pairing, isRead, keepPairingAddress, savePairing, forgetServer };
}
