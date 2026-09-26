import { requireOptionalNativeModule } from 'expo';

interface JarvisVolumeNativeModule {
  capCallVolume(share: number): void;
}

/** Optional, like the other two: absent under a bundler and in any build without the native side. */
const nativeModule = requireOptionalNativeModule<JarvisVolumeNativeModule>('JarvisVolume');

/**
 * Brings the watch's call volume down to `share` of its maximum, if it is above that.
 *
 * Call volume because that is what Jarvis plays at on a watch, greeting and conversation alike. See
 * `JarvisVolumeModule.kt`. Never throws: a volume that could not be lowered is a louder Jarvis, not
 * a reason to stop him talking.
 */
export function capCallVolume(share: number): void {
  try {
    nativeModule?.capCallVolume(share);
  } catch {
    // As loud as it was.
  }
}
