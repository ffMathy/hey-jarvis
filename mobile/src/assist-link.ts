/**
 * The URL the assistant session opens the app with.
 *
 * Android hands control to an assistant by starting a service, not an activity,
 * and a `VoiceInteractionSession` has no React Native surface of its own. So the
 * session's job is to bring the app to the front and get out of the way, and
 * this link is how it says why it did: opened from the launcher, Jarvis waits;
 * opened from here, Jarvis is already listening.
 */
export const ASSIST_URL = 'heyjarvis://assist';

/** The path that means "the user summoned the assistant". */
const ASSIST_PATH = 'assist';

/**
 * Strips the scheme and any authority slashes off a deep link.
 *
 * Android normalises `heyjarvis://assist` and `heyjarvis:/assist` differently
 * depending on how the intent was built, and `expo-linking` hands back whatever
 * arrived, so both spellings have to mean the same thing here.
 */
function stripScheme(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '');
}

/**
 * Whether the app was opened because the user summoned Jarvis, rather than
 * because they tapped the icon.
 *
 * A launch that came through the assistant should start listening immediately —
 * the user has already said the equivalent of "hey Jarvis", and making them
 * press a button afterwards would be asking twice.
 */
export function isAssistLaunch(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  const withoutFragment = stripScheme(url).split('#')[0] ?? '';
  const path = withoutFragment.split('?')[0] ?? '';

  return path.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase() === ASSIST_PATH;
}
