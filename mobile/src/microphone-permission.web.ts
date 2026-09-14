import type { RequestMicrophoneAccess } from './platform-contracts';

/**
 * Asking for the microphone in a browser.
 *
 * There is no permission API to call — the question is asked by requesting a
 * stream, and answered by whether one comes back. So that is what this does,
 * before the session starts, for the same reason the Android side asks early: a
 * refusal in the middle of connecting looks like a broken connection.
 */
export const requestMicrophoneAccess: RequestMicrophoneAccess = async () => {
  if (!navigator.mediaDevices) {
    // No `mediaDevices` at all means the page is not on a secure origin, and no
    // amount of asking will produce a microphone.
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Released straight away: this was a question, not a recording. The session
    // opens its own stream a moment later, and holding this one meanwhile would
    // light the browser's recording indicator before Jarvis is listening.
    for (const track of stream.getTracks()) {
      track.stop();
    }

    return true;
  } catch {
    return false;
  }
};
