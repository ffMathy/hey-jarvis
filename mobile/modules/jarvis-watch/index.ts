import type { ElevenLabsSettings } from 'conversation';
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
  sendSettingsToTheWatch(apiKey: string, agentId: string): Promise<boolean>;
  addListener(event: 'onWatchAskedForCredentials', listener: () => void): { remove: () => void };
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

/**
 * Hands the ElevenLabs credentials to the watch, so they are typed once and on the right keyboard.
 *
 * This is the whole answer to "does the watch need its own setup?". It does not: the two apps
 * share a package name and a signing key on purpose — see `watch/AGENTS.md` — which is exactly
 * what Play Services requires before the Data Layer will connect them, and this is what that
 * connection is for. A long API key is not something anybody should enter on a watch.
 *
 * Sent as a **message**, which is handed to the receiving app and stored nowhere in between. The
 * easier route, a replicated `DataItem`, would leave a live API key sitting in Play Services' own
 * store on both devices; see `JarvisWatchModule.kt`.
 *
 * Returns false rather than throwing when there is no watch in range, no Jarvis on it, or no Data
 * Layer at all — the caller shows that as a line of text, because "your watch is not here right
 * now" is not an error anybody needs a stack trace for.
 */
export async function sendSettingsToTheWatch(settings: ElevenLabsSettings): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  try {
    return await nativeModule.sendSettingsToTheWatch(settings.apiKey, settings.agentId);
  } catch {
    return false;
  }
}

/**
 * Calls back whenever the watch asks to be given the credentials, for as long as the return value
 * is not called.
 *
 * The watch asks when it starts with none, and only an app that is *running* can answer, because
 * the credentials are in the keystore behind JavaScript rather than anywhere this module can read.
 * That is the one asymmetry in the handover, and it is why the watch's own screen says to open
 * Jarvis on the phone rather than waiting silently.
 *
 * A no-op where the module is absent, which is web and every test.
 */
export function whenTheWatchAsksForCredentials(answer: () => void): () => void {
  const subscription = nativeModule?.addListener('onWatchAskedForCredentials', answer);
  return () => subscription?.remove();
}
