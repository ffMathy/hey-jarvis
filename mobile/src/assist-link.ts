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

/**
 * Says yes exactly once for each summoning, and no for everything else.
 *
 * The same summoning is seen more than once: `useURL` hands the URL back on
 * every render, and when the conversation screen is mounted again — after the
 * settings screen, say — it reads the activity's original launch URL afresh.
 * Acting on it again would start a conversation the user did not ask for, or
 * tear down the one already running. So a URL is acted on the first time only.
 *
 * That only works because each summoning is a different URL: the session adds a
 * `summon` value that changes every time (see `AssistLauncher.kt`). Without it,
 * every summoning after the first in the same process would look like the first
 * one again, and be ignored — which is what a device showed before that value
 * existed.
 *
 * Kept for the life of the process rather than of a component, because the
 * launch URL outlives any one mount of the screen.
 */
export function createAssistLaunchClaim(): (url: string | null | undefined) => boolean {
  const claimed = new Set<string>();

  return (url) => {
    if (!url || !isAssistLaunch(url) || claimed.has(url)) {
      return false;
    }

    claimed.add(url);
    return true;
  };
}
