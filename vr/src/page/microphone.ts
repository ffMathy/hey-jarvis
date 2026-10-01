import { MICROPHONE_BLOCKED, microphonePermission, openWakeMicrophone } from '../wake/microphone';
import type { MicrophonePermission, MicrophoneProfile } from '../wake/types';

/**
 * The microphone permission, as the 2D page needs it — what it is now, and asking for it — and the
 * stream that asking opened, kept for the room.
 *
 * The page asks here, on the 2D panel, because that is the only place Quest Browser can show the
 * prompt; once it is granted, a stream opened in the room needs no prompt at all. Asking is done by
 * opening the very stream the wake word listens on (`openWakeMicrophone`, normally with the
 * processing the ElevenLabs SDK asks for too), and that stream is kept rather than stopped: the tap on **Enter
 * your room** has to start the wake engine before it awaits anything, so that its AudioContext is
 * created inside the gesture, and a stream already open is the only one it can start on at once.
 */

export interface MicrophoneGate {
  /** The permission as it stands, without prompting. */
  permission(): Promise<MicrophonePermission>;
  /** Prompts for it (on the 2D page), and says how that went; rejects with a readable Error otherwise. */
  ask(): Promise<MicrophonePermission>;
}

/** As much of a stream as keeping one takes: a `MediaStream` is one, and so are the tests' fakes. */
export interface KeptStream {
  getTracks(): Array<{ stop(): void }>;
  getAudioTracks(): Array<{ readonly readyState: string }>;
}

/** A gate that also hands the stream its asking opened over to the room. */
export interface MicrophoneKeeper<Stream extends KeptStream = MediaStream> extends MicrophoneGate {
  /**
   * The stream `ask` opened, if it is still live, handed over once: whoever takes it stops it.
   * Undefined when there is none — the permission was already granted when the page opened, so
   * nothing was asked — and the room then opens a stream of its own.
   */
  take(): Stream | undefined;
}

/** How the keeper reaches the microphone. */
export interface MicrophoneAccess<Stream extends KeptStream> {
  permission(): Promise<MicrophonePermission>;
  open(): Promise<Stream>;
}

function stop(stream: KeptStream) {
  for (const track of stream.getTracks()) track.stop();
}

function isLive(stream: KeptStream): boolean {
  return stream.getAudioTracks().some((track) => track.readyState === 'live');
}

/** The browser's own microphone, through wake's permission check, opened with `profile`'s processing. */
export function createBrowserMicrophoneKeeper(profile: MicrophoneProfile): MicrophoneKeeper {
  return createMicrophoneKeeper<MediaStream>({
    permission: () => microphonePermission(),
    open: () => openWakeMicrophone(profile),
  });
}

/** A keeper over `access`; apart from the browser's so the specs can hand in fakes. */
export function createMicrophoneKeeper<Stream extends KeptStream>(
  access: MicrophoneAccess<Stream>,
): MicrophoneKeeper<Stream> {
  let kept: Stream | undefined;
  return {
    permission: () => access.permission(),
    async ask() {
      let stream: Stream;
      try {
        stream = await access.open();
      } catch (error) {
        // A refusal is the answer the page shows its instructions for, not a failure to report.
        if (error instanceof Error && error.message === MICROPHONE_BLOCKED) return 'denied';
        if ((await access.permission()) === 'denied') return 'denied';
        throw error;
      }
      if (kept !== undefined) stop(kept);
      kept = stream;
      return 'granted';
    },
    take() {
      const stream = kept;
      kept = undefined;
      if (stream === undefined || isLive(stream)) return stream;
      stop(stream);
      return undefined;
    },
  };
}
