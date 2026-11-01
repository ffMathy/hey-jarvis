import { type Glance, glanceOf } from 'hologram';
import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * The latest glance, kept on the phone, so the app opened from the launcher can show it at once.
 *
 * **The line takes a moment, and opening the app does not wait.** The server sends its current
 * glance right after `ready`, which is a socket, a hello and an answer after the app has read its
 * settings. Without a kept one, the conversation screen would be what opened — greeting and all —
 * and the glance would have to wait for it to end. With one, the glance is there from the first
 * frame, and the line's own replaces it the moment it comes (`app.tsx`).
 *
 * Not a secret, and nothing is lost if it cannot be read or written: the line sends it again. A kept
 * glance is read back through the same parser the line's is (`glanceOf`), so nothing that could not
 * have come from the server is ever shown, and `glanceToShow` stops showing one once the server
 * would no longer keep it current.
 */

/** Where it is kept. */
export const GLANCE_STORAGE_KEY = 'jarvis.glance';

/** The kept glance, or `undefined` for none, one that is no longer usable, or a store that cannot be read. */
export async function loadGlance(): Promise<Glance | undefined> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(GLANCE_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (!stored) return undefined;
  try {
    return glanceOf(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

/** Keeps `glance` in place of whatever was kept. A store that cannot be written keeps nothing new. */
export async function saveGlance(glance: Glance): Promise<void> {
  try {
    await writeStoredValue(GLANCE_STORAGE_KEY, JSON.stringify(glance));
  } catch {
    // The line sends the current glance again on the next `ready`; what is lost is only the head start.
  }
}
