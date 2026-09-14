import * as SecureStore from 'expo-secure-store';
import type { ServerSettings } from './server-settings';

/**
 * Where the server address and access token live.
 *
 * `expo-secure-store` rather than plain storage, because the access token mints
 * live microphone sessions into the house — it is a credential, and a phone is
 * lost more often than a server is.
 */
const STORAGE_KEY = 'jarvis.server-settings';

/** Narrows what came back out of storage, which is only ever a string. */
function readSettings(stored: string): ServerSettings | undefined {
  const parsed: unknown = JSON.parse(stored);

  if (typeof parsed !== 'object' || parsed === null || !('serverUrl' in parsed) || !('accessToken' in parsed)) {
    return undefined;
  }

  const { serverUrl, accessToken } = parsed;
  if (typeof serverUrl !== 'string' || typeof accessToken !== 'string') {
    return undefined;
  }

  return { serverUrl, accessToken };
}

/**
 * Reads the stored settings, or nothing at all.
 *
 * A first run and a corrupted entry are the same answer here — there is nothing
 * usable, so the app asks for it — and treating them alike means a bad write can
 * never wedge the app on a screen it cannot leave.
 */
export async function loadServerSettings(): Promise<ServerSettings | undefined> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!stored) {
    return undefined;
  }

  try {
    return readSettings(stored);
  } catch {
    return undefined;
  }
}

export async function saveServerSettings(settings: ServerSettings): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(settings));
}
