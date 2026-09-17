import { requireOptionalNativeModule } from 'expo';

/** What the phone can see of the watch beside it. */
export interface PairedWatch {
  /** Whether a watch is paired and reachable right now. A watch that is off is not. */
  paired: boolean;
  /** What it calls itself, for saying which watch is meant. */
  name: string | undefined;
  /** Whether Jarvis is installed on it, as told by the capability the watch app advertises. */
  hasJarvis: boolean;
}

interface JarvisWatchNativeModule {
  findWatch(): Promise<PairedWatch>;
  openJarvisOnTheWatch(): Promise<boolean>;
}

/**
 * Optional, like the other two local modules: absent on web, under `bun test`, and in any build
 * without the native side. Every reader below treats a missing module as "there is no watch",
 * which is the truth in all three.
 */
const nativeModule = requireOptionalNativeModule<JarvisWatchNativeModule>('JarvisWatch');

/** Nothing there: what every caller gets where the Data Layer cannot be reached at all. */
const NO_WATCH: PairedWatch = { paired: false, name: undefined, hasJarvis: false };

/**
 * Asks whether there is a watch, and whether Jarvis is on it.
 *
 * Never throws. A phone with no Play Services, a watch that is off, a build without the module —
 * all of them are "no watch", and a setting that says so is better than one that shows an error
 * for a device the user may not even own.
 */
export async function findWatch(): Promise<PairedWatch> {
  if (!nativeModule) {
    return NO_WATCH;
  }
  try {
    return await nativeModule.findWatch();
  } catch {
    return NO_WATCH;
  }
}

/**
 * Opens Jarvis's Play Store page on the watch, so it can be installed there.
 *
 * This is as far as an Android app is allowed to go: it opens a page on the watch, and somebody
 * taps install on the watch. Nothing can push an APK across — see `JarvisWatchModule.kt`.
 *
 * Returns false if it could not be opened, which the caller shows as words rather than a crash.
 */
export async function openJarvisOnTheWatch(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  try {
    return await nativeModule.openJarvisOnTheWatch();
  } catch {
    return false;
  }
}

/** The capability the watch app advertises, which is how {@link findWatch} knows it is there. */
export const JARVIS_ON_THE_WATCH = 'jarvis_on_the_watch';
