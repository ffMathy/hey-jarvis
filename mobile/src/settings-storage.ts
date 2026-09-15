import type { ElevenLabsSettings } from './elevenlabs-settings';
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
 * Reads the stored settings, or nothing at all.
 *
 * A first run and a corrupted entry are the same answer here — there is nothing
 * usable, so the app asks for it — and treating them alike means a bad write can
 * never wedge the app on a screen it cannot leave.
 */
export async function loadElevenLabsSettings(): Promise<ElevenLabsSettings | undefined> {
  const stored = await readStoredValue(STORAGE_KEY);
  if (!stored) {
    return undefined;
  }

  try {
    return readSettings(stored);
  } catch {
    return undefined;
  }
}

export async function saveElevenLabsSettings(settings: ElevenLabsSettings): Promise<void> {
  await writeStoredValue(STORAGE_KEY, JSON.stringify(settings));
}
