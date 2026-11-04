import { requireOptionalNativeModule } from 'expo';
import { type Pairing, parseJarvisServerAddress, parseStoredDeviceToken } from 'hologram';

/** What the native side stores, which is the JSON the phone sent with nothing added. */
interface StoredSettings {
  serverAddress: string;
  deviceToken: string;
}

interface JarvisPhoneNativeModule {
  readSettings(): StoredSettings | null;
  forgetSettings(): void;
  askThePhone(): Promise<boolean>;
  askThePhoneToAnswer(timeoutMs: number): Promise<boolean>;
  addListener(event: 'onSettingsArrived', listener: () => void): { remove: () => void };
  addListener(event: 'onPhoneMirrored', listener: (event: { frame: number[] }) => void): { remove: () => void };
}

/**
 * Optional, like the phone app's three local modules: absent under a bundler, under `bun test`,
 * and in any build without the native side. Every reader below treats a missing module as "this
 * watch has never heard from a phone", which is the truth in all three.
 */
const nativeModule = requireOptionalNativeModule<JarvisPhoneNativeModule>('JarvisPhone');

/**
 * The phone's pairing with the Jarvis server, if it has handed it over: where the server is, and
 * the token the server gave the phone, which the watch asks for its conversations and opens its
 * line with.
 *
 * Validated on the way out rather than trusted, with the rules the phone checked them with —
 * `parseJarvisServerAddress` and `parseStoredDeviceToken` in `hologram`. The values have crossed a
 * device boundary since the phone was paired, and a watch that reads back something that is not an
 * address or a token should wait for the phone again here, rather than fail at the server.
 */
export function readPhonePairing(): Pairing | undefined {
  const stored = readStoredSettings();
  if (!stored) {
    return undefined;
  }
  const parsed = parseJarvisServerAddress(stored.serverAddress);
  const address = 'address' in parsed ? parsed.address : undefined;
  const deviceToken = parseStoredDeviceToken(stored.deviceToken);
  return address === undefined || deviceToken === undefined ? undefined : { address, deviceToken };
}

/** What the native side has stored, or `null` for nothing at all. */
function readStoredSettings(): StoredSettings | null {
  // The native side already answers a keystore it cannot open with null rather than a throw — see
  // `PhoneSettingsStore.kt` — but this is the call the first screen makes, and a screen that
  // cannot be drawn is a watch app that will not start. Two guards for one failure is cheap.
  try {
    return nativeModule?.readSettings() ?? null;
  } catch {
    return null;
  }
}

/**
 * Asks the phone to send its pairing, and says whether there was a phone to ask.
 *
 * False means no phone in range, which on a watch is an ordinary state rather than a failure. True
 * means the request left — not that it was answered: the answer arrives on the other path and
 * shows up through {@link whenSettingsArrive}, if this app is still running, or in the store the
 * next time it opens if it is not.
 */
export async function askThePhoneForPairing(): Promise<boolean> {
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

/** Calls back when the pairing lands, so a waiting screen can stop waiting. */
export function whenSettingsArrive(arrived: () => void): () => void {
  const subscription = nativeModule?.addListener('onSettingsArrived', arrived);
  return () => subscription?.remove();
}

/**
 * Calls back with each frame of the phone's sphere, while the phone holds a conversation this watch
 * was summoned for: `encodeMirrorFrame` in `hologram`, or empty when he has stopped.
 */
export function whenThePhoneMirrors(received: (frame: number[]) => void): () => void {
  const subscription = nativeModule?.addListener('onPhoneMirrored', (event) => received(event.frame));
  return () => subscription?.remove();
}

/** Forgets the pairing. For a watch being handed on. */
export function forgetPhoneSettings(): void {
  try {
    nativeModule?.forgetSettings();
  } catch {
    // Nothing to be done and nothing worth interrupting anybody for: a pairing that cannot be
    // cleared is one that also cannot be read, which is the same as having none.
  }
}
