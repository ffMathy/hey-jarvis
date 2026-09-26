import { requireOptionalNativeModule } from 'expo';
import type { ElevenLabsSettings } from 'hologram';
import { parseElevenLabsSettings } from 'hologram';

/** What the native side stores, which is the JSON the phone sent with nothing added. */
interface StoredSettings {
  apiKey: string;
  agentId: string;
}

interface JarvisPhoneNativeModule {
  readSettings(): StoredSettings | null;
  forgetSettings(): void;
  askThePhone(): Promise<boolean>;
  askThePhoneToAnswer(timeoutMs: number): Promise<boolean>;
  addListener(event: 'onSettingsArrived', listener: () => void): { remove: () => void };
}

/**
 * Optional, like the phone app's three local modules: absent under a bundler, under `bun test`,
 * and in any build without the native side. Every reader below treats a missing module as "this
 * watch has never heard from a phone", which is the truth in all three.
 */
const nativeModule = requireOptionalNativeModule<JarvisPhoneNativeModule>('JarvisPhone');

/**
 * The credentials the phone has handed over, if it has.
 *
 * Validated on the way out rather than trusted, with the same rules the phone's own settings
 * screen applies — `parseElevenLabsSettings` is the one place those live. The values have crossed
 * a device boundary since they were typed, and a watch that reads back a key with a newline in it
 * should fail here, where the screen can say so, rather than at ElevenLabs.
 */
export function readPhoneSettings(): ElevenLabsSettings | undefined {
  // The native side already answers a keystore it cannot open with null rather than a throw — see
  // `PhoneSettingsStore.kt` — but this is the call the first screen makes, and a screen that
  // cannot be drawn is a watch app that will not start. Two guards for one failure is cheap.
  let stored: StoredSettings | null;
  try {
    stored = nativeModule?.readSettings() ?? null;
  } catch {
    return undefined;
  }
  if (!stored) {
    return undefined;
  }
  const parsed = parseElevenLabsSettings(stored.apiKey, stored.agentId);
  return 'problem' in parsed ? undefined : parsed.settings;
}

/**
 * Asks the phone to send them, and says whether there was a phone to ask.
 *
 * False means no phone in range, which on a watch is an ordinary state rather than a failure. True
 * means the request left — not that it was answered: the answer arrives on the other path and
 * shows up through {@link whenSettingsArrive}, if this app is still running, or in the store the
 * next time it opens if it is not.
 */
export async function askThePhoneForSettings(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  try {
    return await nativeModule.askThePhone();
  } catch {
    return false;
  }
}

/**
 * Asks the phone to hold this conversation, in its earbuds, and says whether it has.
 *
 * The phone says yes only when it has a Bluetooth headset connected, is unlocked, has Jarvis as its
 * assistant, and has actually opened his window — see `JarvisWatchSummonService.kt` in
 * `mobile/modules/jarvis-assistant`. Anything else, including no answer within `timeoutMs`, is
 * false, and the watch talks for itself.
 */
export async function askThePhoneToAnswer(timeoutMs: number): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  try {
    return await nativeModule.askThePhoneToAnswer(timeoutMs);
  } catch {
    return false;
  }
}

/** Calls back when credentials land, so a waiting screen can stop waiting. */
export function whenSettingsArrive(arrived: () => void): () => void {
  const subscription = nativeModule?.addListener('onSettingsArrived', arrived);
  return () => subscription?.remove();
}

/** Forgets them. For a watch being handed on, and for the only way out of a rejected key. */
export function forgetPhoneSettings(): void {
  try {
    nativeModule?.forgetSettings();
  } catch {
    // Nothing to be done and nothing worth interrupting anybody for: credentials that cannot be
    // cleared are credentials that also cannot be read, which is the same as having none.
  }
}
