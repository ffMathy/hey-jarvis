import type { ReadStoredValue, WriteStoredValue } from './platform-contracts';

/**
 * Storage in a browser: `localStorage`.
 *
 * `expo-secure-store` ships an empty object as its web implementation, so the
 * native path here does not merely behave differently on web — it throws. This
 * file is what Metro picks instead.
 *
 * The difference is real and worth stating plainly rather than papering over:
 * `localStorage` is not a keystore. Anything running on the page's origin can
 * read the access token, and it survives until the site data is cleared. That is
 * the ordinary bargain for a browser app, and it is why the settings screen says
 * where the token is kept when it is running on web.
 *
 * Every access is wrapped because `localStorage` is not always there to be used:
 * a browser with site data blocked throws on the property access itself, and
 * writing past the quota throws too. Failing to remember a setting is worth
 * degrading over; it is not worth a blank screen.
 */
export const readStoredValue: ReadStoredValue = async (key) => {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

export const writeStoredValue: WriteStoredValue = async (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to be done and nothing worth interrupting the user for: the
    // settings simply will not be remembered for the next visit.
  }
};
