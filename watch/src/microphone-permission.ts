import { PermissionsAndroid } from 'react-native';

/**
 * Asking for the microphone on the watch.
 *
 * The same call the phone makes (`mobile/src/microphone-permission.ts`), and not shared with it,
 * because there is nothing here to share: one `PermissionsAndroid.request` and a comparison. What
 * differs is only where it is asked — the phone has a `.web.ts` beside it for a browser that
 * answers the question a different way, and a watch has no browser.
 *
 * Asked up front rather than left to WebRTC, which would otherwise raise the prompt in the middle
 * of connecting, where a refusal surfaces as a failed connection rather than as the permission
 * question it actually was. On a round screen that prompt is most of the display, so asking before
 * the sphere is drawn also keeps it from landing on top of him.
 */
export async function requestMicrophoneAccess(): Promise<boolean> {
  const outcome = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return outcome === PermissionsAndroid.RESULTS.GRANTED;
}
