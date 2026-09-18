import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * Whether the tour has been walked, which is the whole of what makes it a *first-run* tour.
 *
 * It cannot be inferred from the credentials being there. The last step of the tour is the one
 * that recommends making Jarvis the phone's assistant, and it comes *after* the credentials are
 * saved — so "there are credentials" and "the tour is over" are different facts, and the app would
 * either cut the tour short or start it again on somebody who had already declined the
 * recommendation.
 *
 * It lives beside the credentials rather than in ordinary storage only because that is the one
 * key-value store this app has. There is nothing secret in it: the value is the word `yes`.
 */
const STORAGE_KEY = 'jarvis.onboarding-walked';

/** What is written. Only its presence is ever read; the word is for whoever finds it in a dump. */
const WALKED = 'yes';

/**
 * Whether to skip the tour.
 *
 * **A read that fails answers "skip it".** The read can throw — the keystore key protecting this
 * store is invalidated by some OS updates and restores, and a surface the system has only just
 * created can fail to reach the native module at all (see `settings-storage.ts`, where the same
 * throw hid a real bug). Of the two ways to be wrong, showing a tour to somebody who has already
 * walked it is the worse one: they have a working Jarvis and are being asked to sign up for
 * ElevenLabs. Somebody who genuinely has not been through it still lands on the settings screen,
 * which is where the app opened before there was a tour at all.
 */
export async function hasWalkedOnboarding(): Promise<boolean> {
  try {
    return (await readStoredValue(STORAGE_KEY)) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Remembers that the tour is over, so the next launch goes straight to Jarvis.
 *
 * Never throws. A tour that cannot be remembered has still been walked, and the alternative — an
 * error on the screen that just finished congratulating the user — is worse than the chance of
 * seeing it again.
 */
export async function rememberOnboardingWalked(): Promise<void> {
  try {
    await writeStoredValue(STORAGE_KEY, WALKED);
  } catch {
    // Deliberately nothing. See above.
  }
}
