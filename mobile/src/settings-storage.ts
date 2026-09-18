import type { ElevenLabsSettings } from 'hologram';
import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * Where the ElevenLabs API key and agent ID live.
 *
 * The storage underneath differs by platform — the Android keystore, or
 * `localStorage` in a browser — and `key-value-store.ts` against
 * `key-value-store.web.ts` is where that difference is kept. Everything above
 * this line is the same on both.
 *
 * A new key rather than the one the earlier server settings used: what was kept
 * under that one is a different shape, and reading it as this one would only
 * ever fail. An install that has it simply opens on the settings screen.
 */
const STORAGE_KEY = 'jarvis.elevenlabs-settings';

/** Narrows what came back out of storage, which is only ever a string. */
function readSettings(stored: string): ElevenLabsSettings | undefined {
  const parsed: unknown = JSON.parse(stored);

  if (typeof parsed !== 'object' || parsed === null || !('apiKey' in parsed) || !('agentId' in parsed)) {
    return undefined;
  }

  const { apiKey, agentId } = parsed;
  if (typeof apiKey !== 'string' || !apiKey || typeof agentId !== 'string' || !agentId) {
    return undefined;
  }

  return { apiKey, agentId };
}

/**
 * What came back: the settings, nothing stored at all, or a read that failed.
 *
 * **The third used to be folded into the second**, on the reasoning that a first run and a
 * corrupted entry both mean "there is nothing usable, so ask for it". That is right for the app's
 * own window, where asking is a settings screen the user can fill in. It is wrong everywhere else,
 * and it hid a real bug: summoned as the assistant with credentials saved, a failed read looked
 * exactly like a phone that had never been set up, so the assistant opened sample mode — the
 * hologram with nobody on the other end of it — and there was no way to tell which had happened.
 */
export type StoredSettings =
  | { kind: 'settings'; settings: ElevenLabsSettings }
  | { kind: 'nothing' }
  | { kind: 'unreadable'; why: string };

/**
 * Reads the stored settings, saying which of the three things happened.
 *
 * Reading can throw as well as parsing: the keystore key protecting the entry can be invalidated by
 * an OS update or a restore, and a surface that is still starting up can fail to reach the native
 * module at all. Neither is "not set up".
 */
export async function loadElevenLabsSettings(): Promise<StoredSettings> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(STORAGE_KEY);
  } catch (error: unknown) {
    return { kind: 'unreadable', why: error instanceof Error ? error.message : 'the keystore could not be read' };
  }

  if (!stored) {
    return { kind: 'nothing' };
  }

  // A corrupted entry *is* "nothing usable": it can never become readable, and answering anything
  // else would wedge the app on a screen it cannot leave. Only the throw above is worth retrying.
  const settings = readSettings(stored);
  return settings ? { kind: 'settings', settings } : { kind: 'nothing' };
}

export async function saveElevenLabsSettings(settings: ElevenLabsSettings): Promise<void> {
  await writeStoredValue(STORAGE_KEY, JSON.stringify(settings));
}
