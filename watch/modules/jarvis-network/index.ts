import { requireOptionalNativeModule } from 'expo';

/** What a conversation ended up held over. `none` means whatever the system was already using. */
export type FastNetwork = 'wifi' | 'cellular' | 'other' | 'none';

interface JarvisNetworkNativeModule {
  holdFastNetwork(timeoutMs: number): Promise<FastNetwork>;
  releaseFastNetwork(): void;
}

/**
 * Optional, like `jarvis-phone`: absent under a bundler and in any build without the native side,
 * and in all of those there is no Bluetooth proxy to get off, so there is nothing to do.
 */
const nativeModule = requireOptionalNativeModule<JarvisNetworkNativeModule>('JarvisNetwork');

/**
 * Brings Wi-Fi or cellular up and puts this app's traffic on it, instead of the phone's Bluetooth.
 *
 * See `JarvisNetworkModule.kt` for why a conversation needs it: the proxy a watch uses near its
 * phone carries TCP only, and WebRTC's audio does not get through it. Waits at most `timeoutMs`,
 * and never throws — no fast network means the conversation is tried on whatever there is.
 */
export async function holdFastNetwork(timeoutMs: number): Promise<FastNetwork> {
  if (!nativeModule) {
    return 'none';
  }
  try {
    return await nativeModule.holdFastNetwork(timeoutMs);
  } catch {
    return 'none';
  }
}

/** Lets the radio go again. Safe to call when nothing is held. */
export function releaseFastNetwork(): void {
  try {
    nativeModule?.releaseFastNetwork();
  } catch {
    // Nothing held, or nothing to release it with: either way nothing is being kept up.
  }
}
