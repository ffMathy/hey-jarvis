/**
 * The microphone permission, as the 2D page needs it: what it is now, and asking for it.
 *
 * Only the permission — not the stream Jarvis listens on, which the wake engine opens itself inside
 * the tap that enters the room. The page asks here, on the 2D panel, because that is the only place
 * Quest Browser can show the prompt; once it is granted, the stream opened in the room needs no
 * prompt at all.
 */

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * What the page asks of the microphone, so the room's own microphone code (`src/wake/`) can stand
 * in for this one without the page changing.
 */
export interface MicrophoneGate {
  /** The permission as it stands, without prompting. */
  permission(): Promise<MicrophonePermission>;
  /** Prompts for it (on the 2D page), and says how that went; rejects with a readable Error otherwise. */
  ask(): Promise<MicrophonePermission>;
}

/** A Permissions API answer folded to the four the page acts on. */
export function foldPermissionState(state: string): MicrophonePermission {
  return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown';
}

/** Why a microphone could not be had, in words for the page. */
export function describeMicrophoneFailure(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'This headset has no microphone the page can use.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy with something else. Close other apps using it and try again.';
    case 'SecurityError':
      return 'This page is not allowed to use the microphone here. Open it over HTTPS.';
    default:
      return `The microphone could not be opened${error instanceof Error && error.message ? `: ${error.message}` : '.'}`;
  }
}

/** The browser's own microphone permission, through the Permissions API and getUserMedia. */
export function createBrowserMicrophoneGate(navigatorLike: Navigator = navigator): MicrophoneGate {
  return {
    async permission() {
      try {
        const status = await navigatorLike.permissions.query({ name: 'microphone' });
        return foldPermissionState(status.state);
      } catch {
        // Browsers that cannot be asked about the microphone without prompting: asking is how to find out.
        return 'unknown';
      }
    },
    async ask() {
      let stream: MediaStream;
      try {
        stream = await navigatorLike.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') return 'denied';
        throw new Error(describeMicrophoneFailure(error));
      }
      // The permission was the point; the stream Jarvis listens on is opened in the room.
      for (const track of stream.getTracks()) track.stop();
      return 'granted';
    },
  };
}
