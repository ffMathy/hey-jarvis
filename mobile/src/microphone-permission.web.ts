import type { RequestMicrophoneAccess } from './platform-contracts';

/**
 * Asking for the microphone in a browser.
 *
 * There is no permission API to call — the question is asked by requesting a
 * stream, and answered by whether one comes back. So that is what this does,
 * before the session starts, for the same reason the Android side asks early: a
 * refusal in the middle of connecting looks like a broken connection.
 *
 * **The stream is held until `release`, and that is what lets him greet.** A tab
 * nobody has clicked since it loaded — the conversation reloaded, or opened in a
 * new tab — may not start a sound, unless it is using the microphone. The
 * recorded greeting starts before the session opens a stream of its own, so this
 * one is kept open until it has: released straight away, as it once was, the
 * browser refused the recording and the agent greeted in its own voice instead.
 * Once a sound has started it plays on after the stream is stopped.
 */
export const requestMicrophoneAccess: RequestMicrophoneAccess = async () => {
  if (!navigator.mediaDevices) {
    // No `mediaDevices` at all means the page is not on a secure origin, and no
    // amount of asking will produce a microphone.
    return undefined;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    return {
      // Nothing is recorded from it: the session opens its own stream a moment
      // later, and this one goes as soon as the greeting no longer needs it.
      release: () => {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      },
    };
  } catch {
    return undefined;
  }
};
