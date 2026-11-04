import { JARVIS_SERVER_ADDRESS_STORAGE_KEY, parseJarvisServerAddress } from 'hologram';

/**
 * What the page keeps in `localStorage`, and the part of it the rest of the app reads through.
 *
 * The headset's page is published on the same origin as the phone app's web build
 * (`ffmathy.github.io`), so it shares that build's `localStorage`: the server address and the pairing
 * (`pairing.ts`) are kept under `hologram`'s keys, where the phone's web build keeps them.
 */

/** The part of `localStorage` this uses, so the tests can hand it a map. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The Jarvis server's address, as the phone's web build or this page's pairing keeps it on this same
 * origin, or nothing. Checked again on the way out, as the phone checks it.
 */
export function loadServerAddress(storage: KeyValueStorage): string | undefined {
  try {
    const parsed = parseJarvisServerAddress(storage.getItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY) ?? '');
    return 'address' in parsed ? parsed.address : undefined;
  } catch {
    return undefined;
  }
}
