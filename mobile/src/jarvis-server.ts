import {
  JARVIS_DEVICE_TOKEN_STORAGE_KEY,
  JARVIS_SERVER_ADDRESS_STORAGE_KEY,
  parseJarvisServerAddress,
  parseStoredDeviceToken,
} from 'hologram';
import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * Where the phone keeps its pairing with sir's Jarvis server: the server's address, and the token
 * the server gave this phone when it was paired with it. Pairing is the only way the app is set up
 * (`paired-device.ts` in `hologram`): the server holds the ElevenLabs key and starts every
 * conversation, the camera sends its photos there, and the line to it (`jarvis-server-link.ts` in
 * `hologram`) opens with the token. What an address may be is `hologram`'s to say
 * (`jarvis-server-address.ts`); this is where the phone keeps one.
 *
 * **Handed to the watch** (`answer-the-watch.ts`), which shares this phone's pairing rather than
 * having one of its own. The web build's are under `hologram`'s keys in the `localStorage` it shares
 * with the headset's page, so a browser paired on either is paired on both.
 */

/**
 * What came back: a value, none kept, or a read that failed.
 *
 * **A read that fails is not yet "nothing".** The pairing is read from the keystore in a window the
 * system has only just made — exactly the read that can throw while the native module is still
 * coming up. Folded into "none", one such throw would make a summoned Jarvis look like a phone that
 * was never set up, and open sample mode with the pairing in the keystore the whole time. So
 * `app.tsx` tries again (`read-again.ts`), and only a value that still cannot be read is none.
 */
export type StoredJarvisServerAddress =
  | { kind: 'address'; address: string }
  | { kind: 'nothing' }
  | { kind: 'unreadable' };

/**
 * Reads the stored address, saying which of the three things happened. A stored value is parsed again
 * on the way out, so nothing that could not have been saved is ever sent anything.
 */
export async function loadJarvisServerAddress(): Promise<StoredJarvisServerAddress> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(JARVIS_SERVER_ADDRESS_STORAGE_KEY);
  } catch {
    return { kind: 'unreadable' };
  }

  const parsed = parseJarvisServerAddress(stored ?? '');
  return 'address' in parsed && parsed.address !== undefined
    ? { kind: 'address', address: parsed.address }
    : { kind: 'nothing' };
}

/**
 * Keeps the address, or forgets it. No address is stored as an empty string, which reads back as
 * none — the store has no way to delete an entry.
 */
export async function saveJarvisServerAddress(address: string | undefined): Promise<void> {
  await writeStoredValue(JARVIS_SERVER_ADDRESS_STORAGE_KEY, address ?? '');
}

/** What came back for the device token: the same three answers as for the address. */
export type StoredJarvisDeviceToken = { kind: 'token'; token: string } | { kind: 'nothing' } | { kind: 'unreadable' };

/** Reads the token this device was paired with, if it has been, checked as `hologram` checks one. */
export async function loadJarvisDeviceToken(): Promise<StoredJarvisDeviceToken> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(JARVIS_DEVICE_TOKEN_STORAGE_KEY);
  } catch {
    return { kind: 'unreadable' };
  }
  const token = parseStoredDeviceToken(stored);
  return token === undefined ? { kind: 'nothing' } : { kind: 'token', token };
}

/** Keeps the token, or forgets it — when the server it was paired with is changed or cleared. */
export async function saveJarvisDeviceToken(token: string | undefined): Promise<void> {
  await writeStoredValue(JARVIS_DEVICE_TOKEN_STORAGE_KEY, token ?? '');
}
