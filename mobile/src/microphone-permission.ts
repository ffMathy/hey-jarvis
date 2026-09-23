import { PermissionsAndroid } from 'react-native';
import type { RequestMicrophoneAccess } from './platform-contracts';

/**
 * Asking for the microphone on Android.
 *
 * `PermissionsAndroid` is not part of `react-native-web` — the import resolves to
 * nothing there — which is half of why this file has a `.web.ts` beside it. The
 * other half is that a browser answers the same question differently anyway.
 */
export const requestMicrophoneAccess: RequestMicrophoneAccess = async () => {
  const outcome = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  // A permission, not a stream: there is nothing held open to release.
  return outcome === PermissionsAndroid.RESULTS.GRANTED ? { release: () => undefined } : undefined;
};
