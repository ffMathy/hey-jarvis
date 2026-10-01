import type { MicrophonePermission, MicrophoneProfile } from './types';

/**
 * Opening the microphone for the wake word, and asking whether it may be.
 *
 * Quest Browser cannot show the permission prompt inside an immersive session, so the page asks
 * for the microphone with its own tap on the 2D page before entering the room — and skips that
 * tap when `microphonePermission` says it is already granted. Inside the room the microphone is
 * only ever reopened (after sleep, or when the system took it), which needs no prompt.
 */

/**
 * How long getUserMedia gets before giving up. A capture request can hang rather than fail —
 * inside an immersive session, where the prompt cannot be shown, it may never answer — and a
 * button stuck on "Allowing the microphone…" is worse than a readable failure (the VROS headset
 * app settled on the same 8 s).
 */
export const MICROPHONE_TIMEOUT_MILLISECONDS = 8000;

/** What the user reads when the browser refuses the microphone. */
export const MICROPHONE_BLOCKED =
  "Jarvis isn't allowed to use the microphone. Allow it for this site in the browser's settings.";

/** The constraints for a profile; see `MicrophoneProfile` for why `processed` is the default. */
export function microphoneConstraints(profile: MicrophoneProfile): MediaStreamConstraints {
  const processing = profile === 'processed';
  return {
    audio: {
      channelCount: 1,
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    },
    video: false,
  };
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : undefined;
}

/** A getUserMedia failure in words the status line can show. */
export function describeMicrophoneError(error: unknown): string {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return MICROPHONE_BLOCKED;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy or unavailable. Close whatever else is using it and try again.';
    case 'TimeoutError':
      return `The microphone did not answer within ${MICROPHONE_TIMEOUT_MILLISECONDS / 1000} seconds. Try again.`;
    default:
      return `The microphone could not be opened: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** What the engine needs of a stream: a MediaStream is one; the tests' fakes are too. */
export interface StoppableStream {
  getTracks(): Array<{ stop(): void }>;
}

/** What opening a microphone needs of `navigator.mediaDevices`. */
export interface MicrophoneSource<Stream extends StoppableStream> {
  getUserMedia(constraints: MediaStreamConstraints): Promise<Stream>;
}

export interface MicrophoneTimers {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

function stopStream(stream: StoppableStream) {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * getUserMedia from `source` with the profile's constraints and the timeout, as
 * `openWakeMicrophone` does it; apart so the tests can hand in a fake source and clock.
 *
 * A stream that arrives after the timeout is stopped at once, so a late answer never leaves the
 * microphone open behind a failure the user has already been shown.
 */
export function openMicrophoneFrom<Stream extends StoppableStream>(
  profile: MicrophoneProfile,
  source: MicrophoneSource<Stream> | undefined,
  timers: MicrophoneTimers,
): Promise<Stream> {
  if (source === undefined) {
    return Promise.reject(new Error('This browser cannot use a microphone here. The page must be opened over HTTPS.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = timers.setTimeout(() => {
      settled = true;
      reject(new Error(describeMicrophoneError(new DOMException('Timed out', 'TimeoutError'))));
    }, MICROPHONE_TIMEOUT_MILLISECONDS);
    source.getUserMedia(microphoneConstraints(profile)).then(
      (stream) => {
        if (settled) {
          stopStream(stream);
          return;
        }
        settled = true;
        timers.clearTimeout(timeout);
        resolve(stream);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timeout);
        reject(new Error(describeMicrophoneError(error)));
      },
    );
  });
}

/** getUserMedia with the profile's constraints and an 8 s timeout. Rejects with a readable Error. */
export function openWakeMicrophone(profile: MicrophoneProfile): Promise<MediaStream> {
  return openMicrophoneFrom(profile, globalThis.navigator?.mediaDevices, {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle),
  });
}

/** What asking for the permission needs of `navigator.permissions`. */
export interface PermissionSource {
  query(descriptor: { name: 'microphone' }): Promise<{ state: PermissionState }>;
}

/** permissions.query({name:'microphone'}) folded to three answers; 'unknown' where unsupported. */
export async function microphonePermission(
  permissions: PermissionSource | undefined = globalThis.navigator?.permissions,
): Promise<MicrophonePermission> {
  if (permissions === undefined) return 'unknown';
  try {
    const status = await permissions.query({ name: 'microphone' });
    return status.state;
  } catch {
    // Firefox and older browsers throw for a permission name they do not know.
    return 'unknown';
  }
}
