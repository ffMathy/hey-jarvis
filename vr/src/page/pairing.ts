import {
  JARVIS_DEVICE_TOKEN_STORAGE_KEY,
  JARVIS_SERVER_ADDRESS_STORAGE_KEY,
  type Pairing,
  parseJarvisServerAddress,
  parseStoredDeviceToken,
} from 'hologram';
import type { KeyValueStorage } from './settings';

/**
 * Where the headset's page keeps its pairing with sir's Jarvis server: the address where the phone's
 * web build keeps it, and the token beside it, under `hologram`'s keys. How a browser is paired, and
 * what the pairing is used for, is `hologram`'s `paired-device.ts`, shared with the phone's web
 * build; both pages are on the same origin, so a browser paired on either is paired on both.
 */

/** What the headset is listed as among the server's paired devices. */
export const HEADSET_DEVICE_NAME = 'Meta Quest headset';

/** The pairing kept on this page, or nothing when the headset has not been paired, or storage throws. */
export function loadPairing(storage: KeyValueStorage): Pairing | undefined {
  try {
    const parsed = parseJarvisServerAddress(storage.getItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY) ?? '');
    const deviceToken = parseStoredDeviceToken(storage.getItem(JARVIS_DEVICE_TOKEN_STORAGE_KEY));
    if (!('address' in parsed) || parsed.address === undefined || !deviceToken) return undefined;
    return { address: parsed.address, deviceToken };
  } catch {
    return undefined;
  }
}

/** Keeps a pairing: the address where the phone's web build keeps it, and the token beside it. */
export function savePairing(storage: KeyValueStorage, { address, deviceToken }: Pairing): string | undefined {
  try {
    storage.setItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY, address);
    storage.setItem(JARVIS_DEVICE_TOKEN_STORAGE_KEY, deviceToken);
    return undefined;
  } catch {
    return 'This browser would not keep the pairing. Check that it allows this site to store data.';
  }
}
