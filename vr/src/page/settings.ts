import {
  ELEVENLABS_SETTINGS_STORAGE_KEY,
  type ElevenLabsSettings,
  HEADSET_PARTICIPANT_NAME,
  JARVIS_SERVER_ADDRESS_STORAGE_KEY,
  parseElevenLabsSettings,
  parseJarvisServerAddress,
  parseStoredElevenLabsSettings,
  requestConversationToken,
  serialiseElevenLabsSettings,
} from 'hologram';

/**
 * The ElevenLabs API key and agent ID: kept, read back, and checked before they are kept.
 *
 * **Kept where the phone's web build keeps them**, under hologram's storage key and in its format.
 * The headset's page is published on the same origin as the phone app's web build
 * (`ffmathy.github.io`), so it shares that build's `localStorage`: someone who has set Jarvis up in
 * the phone's web app on the headset — or here — has set him up in both.
 *
 * **Checked with ElevenLabs on save.** A 50-character key typed on a headset's virtual keyboard is
 * a typo waiting to happen, and without a check it would only surface in the room, after the wake
 * word, the arrival and the greeting, as an error panel far from the field that caused it. Minting
 * one conversation token (as the headset, `HEADSET_PARTICIPANT_NAME`) proves the key, its
 * permissions and the agent ID in one request, opens no conversation, and puts ElevenLabs' answer
 * next to the field, where the keyboard is.
 */

/** The part of `localStorage` this uses, so the tests can hand it a map. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The stored settings, or nothing.
 *
 * Nothing covers a first visit, an entry in some other shape, and a storage that throws — which
 * `localStorage` does when the browser has storage switched off. On this page all three mean the
 * same thing: the fields are empty and the key has to be entered.
 */
export function loadSettings(storage: KeyValueStorage): ElevenLabsSettings | undefined {
  try {
    const stored = storage.getItem(ELEVENLABS_SETTINGS_STORAGE_KEY);
    return stored ? parseStoredElevenLabsSettings(stored) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Jarvis server's address, as the phone's web build keeps it on this same origin, or nothing:
 * the headset has no field of its own for it. Checked again on the way out, as the phone checks it.
 */
export function loadServerAddress(storage: KeyValueStorage): string | undefined {
  try {
    const parsed = parseJarvisServerAddress(storage.getItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY) ?? '');
    return 'address' in parsed ? parsed.address : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps `settings`; says why it could not, rather than throwing. */
export function saveSettings(storage: KeyValueStorage, settings: ElevenLabsSettings): string | undefined {
  try {
    storage.setItem(ELEVENLABS_SETTINGS_STORAGE_KEY, serialiseElevenLabsSettings(settings));
    return undefined;
  } catch {
    return 'This browser would not keep the settings. Check that it allows this site to store data.';
  }
}

/** What reaching ElevenLabs at all failing is called, since the browser's own words are "Failed to fetch". */
export const UNREACHABLE =
  'ElevenLabs could not be reached to check the key. Check the headset’s connection and save again.';

/**
 * Validates what was typed, then asks ElevenLabs whether it works.
 *
 * The problem, when there is one, is already in words for the page: hologram's own wording for what
 * is wrong with the text, ElevenLabs' failure as `requestConversationToken` describes it (never the
 * response body, which can echo the key), or {@link UNREACHABLE}.
 */
export async function checkSettings(
  rawApiKey: string,
  rawAgentId: string,
  fetchImplementation: typeof fetch,
): Promise<{ settings: ElevenLabsSettings } | { problem: string }> {
  const parsed = parseElevenLabsSettings(rawApiKey, rawAgentId);
  if ('problem' in parsed) return parsed;
  try {
    await requestConversationToken(
      { settings: parsed.settings, participantName: HEADSET_PARTICIPANT_NAME },
      fetchImplementation,
    );
    return parsed;
  } catch (error) {
    // `fetch` rejects with a TypeError, and only then, when the request never got an answer.
    if (error instanceof TypeError) return { problem: UNREACHABLE };
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}
