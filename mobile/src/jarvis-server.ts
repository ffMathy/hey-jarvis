import {
  JARVIS_SERVER_ADDRESS_STORAGE_KEY,
  JARVIS_SERVER_TOKEN_STORAGE_KEY,
  parseJarvisServerAddress,
  parseJarvisServerToken,
} from 'hologram';
import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * The Jarvis server's address, kept on the phone: where it sends sir's photos, and where it, the
 * watch and the headset open their line to the server during a conversation (`jarvis-server-link.ts`
 * in `hologram`). What an address may be is `hologram`'s to say (`jarvis-server-address.ts`); this
 * is where the phone keeps one.
 *
 * **Optional.** Talking to Jarvis needs nothing but ElevenLabs, as it always has, so a phone without
 * an address talks to him exactly as before: no camera button beside him, nothing told to the agent
 * about one (`use-photo-sending.ts`), and no line to the server. See "Showing him something" in
 * `mobile/AGENTS.md`.
 *
 * **Handed to the watch**, with the ElevenLabs settings (`answer-the-watch.ts`), so it opens the same
 * line; the headset's page reads it from the `localStorage` it shares with the phone's web build. It
 * is kept under a storage key of its own, so it and the settings can be saved and read without either
 * having to know the other's shape.
 */

/**
 * What came back: an address, none kept, or a read that failed — the same three answers
 * `settings-storage.ts` gives, for the same reason.
 *
 * **A read that fails is not yet "no address".** It is read at the same moment as the settings, from
 * the same keystore, in a window the system has only just made — exactly the read that can throw
 * while the native module is still coming up. Folded into "none", one such throw would take the
 * camera away from a summoning of the assistant's window with the address in the keystore the whole
 * time. So `app.tsx` tries again, as it does for the settings (`read-again.ts`), and only an address
 * that still cannot be read is no address: the camera stays off, which is what failing closed means
 * here.
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
 * The settings screen changing the server's address or its token: the ones to keep instead,
 * `undefined` for none.
 *
 * A save that leaves both fields as they were is no change at all, and is reported as none rather
 * than as the fields' values — see `elevenlabs-fields.tsx` for the address that would otherwise be
 * erased.
 */
export interface JarvisServerChange {
  address: string | undefined;
  token: string | undefined;
}

/**
 * Keeps the address, or forgets it. No address is stored as an empty string, which reads back as
 * none — the store has no way to delete an entry, and an empty one is what an unset field saves as.
 */
export async function saveJarvisServerAddress(address: string | undefined): Promise<void> {
  await writeStoredValue(JARVIS_SERVER_ADDRESS_STORAGE_KEY, address ?? '');
}

/**
 * What came back for the token: the same three answers as for the address, read the same way and
 * retried with it.
 */
export type StoredJarvisServerToken = { kind: 'token'; token: string } | { kind: 'nothing' } | { kind: 'unreadable' };

/**
 * Reads the stored token for the server: the JWT the Cloudflare Zero Trust application in front of
 * it accepts (`parseJarvisServerToken` in `hologram`). Kept in the keystore like the ElevenLabs key,
 * since it is a credential too, and parsed again on the way out.
 */
export async function loadJarvisServerToken(): Promise<StoredJarvisServerToken> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(JARVIS_SERVER_TOKEN_STORAGE_KEY);
  } catch {
    return { kind: 'unreadable' };
  }

  const parsed = parseJarvisServerToken(stored ?? '');
  return 'token' in parsed && parsed.token !== undefined ? { kind: 'token', token: parsed.token } : { kind: 'nothing' };
}

/** Keeps the token, or forgets it, as the address is kept. */
export async function saveJarvisServerToken(token: string | undefined): Promise<void> {
  await writeStoredValue(JARVIS_SERVER_TOKEN_STORAGE_KEY, token ?? '');
}
