import * as SecureStore from 'expo-secure-store';
import type { ReadStoredValue, WriteStoredValue } from './platform-contracts';

/**
 * Storage on a phone: the Android keystore, by way of `expo-secure-store`.
 *
 * What is kept here is an ElevenLabs API key — an account credential, not a
 * session — so it belongs behind the keystore rather than in ordinary app
 * storage. `elevenlabs-settings.ts` says why it should also be a key made for this
 * app alone, and mobile/AGENTS.md what the keystore does and does not protect it
 * from.
 *
 * The web build takes `key-value-store.web.ts` instead, which is a real
 * difference in kind and not just in API. See the note there.
 */
export const readStoredValue: ReadStoredValue = async (key) => (await SecureStore.getItemAsync(key)) ?? undefined;

export const writeStoredValue: WriteStoredValue = async (key, value) => {
  await SecureStore.setItemAsync(key, value);
};
