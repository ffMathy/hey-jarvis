import { INTERRUPTED_TOO_SOON_MS, UNEXPLAINED_INTERRUPTIONS } from 'hologram';
import { createTranscriptEchoWatch } from './echo-transcript';
import type { VoiceDemotion } from './voice-route';

/**
 * Watching his spatial voice for the two ways it can go wrong: coming back through the microphone,
 * or not being heard at all.
 *
 * **Echo.** Whether the headset's echo canceller copes with a voice that moves between the ears as
 * the head turns has only been read about, so the signs are watched for, and any one of them moves
 * his voice back to the headset (`voice-route.ts`):
 *
 * - an interruption within {@link INTERRUPTED_TOO_SOON_MS} of his voice starting, measured from the
 *   audio itself rather than from the SDK's mode, which follows the server and lags — faster than
 *   anyone draws breath to talk over him;
 * - {@link UNEXPLAINED_INTERRUPTIONS} interruptions with no transcript of the user between them;
 * - a transcript of the user that repeats what he has just said (`echo-transcript.ts`).
 *
 * The first two are the half-duplex fallback's own signs, from `hologram`, watched here first: the
 * fallback costs barge-in, and moving his voice to the headset may be all it takes.
 *
 * **Silence.** His spatial voice depends on things the element never did: the AudioContext running,
 * and a remote track feeding Web Audio at all. So the AudioContext stopping for longer than a
 * moment, or LiveKit's server hearing him speak while nothing reaches the panner for
 * {@link SILENT_FOR_MS}, moves him too. The server's word is used because it does not depend on the
 * page pulling his audio; WebRTC's own received-audio level is measured after the element's volume,
 * which is 0 while he is spatial, and would read silence whatever was arriving.
 */

/** The level of his voice that counts as him speaking: −45 dBFS, the research's onset threshold. */
export const AUDIBLE_LEVEL = 10 ** (-45 / 20);

/**
 * How long he has to have been quiet for his voice coming back to count as starting again. The
 * pauses inside a sentence are shorter; the gap before a new turn is longer.
 */
export const QUIET_BEFORE_ONSET_MS = 500;

/** A level this low is nothing at all getting through: comfort noise alone is louder. */
export const SILENT_LEVEL = 1e-4;

/** How long the server may hear him while nothing reaches the panner. */
export const SILENT_FOR_MS = 1_500;

/** How long the AudioContext may be stopped before his spatial voice is given up on. */
export const STOPPED_FOR_MS = 500;

/** One look at his spatial voice, taken every XR frame. */
export interface VoiceSample {
  /**
   * The RMS of his voice on its way into the panner, or undefined while nothing is being played
   * through it — before his track has been found, and between conversations.
   */
  level: number | undefined;
  /** Whether the AudioContext he is played through is running. */
  contextRunning: boolean;
  /** Whether LiveKit's server says he is speaking. */
  serverSaysSpeaking: boolean;
}

export interface VoiceWatch {
  /** Every frame. Says what went wrong, if something just did. */
  sample(sample: VoiceSample): VoiceDemotion | undefined;
  /** One of his interruptions, as the SDK reported it. */
  interrupted(): VoiceDemotion | undefined;
  /** One of his lines, as ElevenLabs sent it. */
  agentSaid(text: string): void;
  /** A transcript of the user. */
  userSaid(text: string): VoiceDemotion | undefined;
  /** A new conversation, with nothing held against it. */
  reset(): void;
}

export function createVoiceWatch(now: () => number): VoiceWatch {
  const transcripts = createTranscriptEchoWatch(now);
  let quietSince: number | undefined = Number.NEGATIVE_INFINITY;
  let startedAt: number | undefined;
  let unexplained = 0;
  let silentSince: number | undefined;
  let stoppedSince: number | undefined;

  const followLevel = (level: number, time: number) => {
    if (level >= AUDIBLE_LEVEL) {
      if (quietSince !== undefined && time - quietSince >= QUIET_BEFORE_ONSET_MS) startedAt = time;
      quietSince = undefined;
      transcripts.agentHeard();
    } else {
      quietSince ??= time;
    }
  };

  const judgeSilence = (sample: VoiceSample, time: number): VoiceDemotion | undefined => {
    if (sample.level === undefined || !sample.serverSaysSpeaking || sample.level >= SILENT_LEVEL) {
      silentSince = undefined;
      return undefined;
    }
    silentSince ??= time;
    return time - silentSince > SILENT_FOR_MS ? 'spatial-silent' : undefined;
  };

  const judgeContext = (running: boolean, time: number): VoiceDemotion | undefined => {
    if (running) {
      stoppedSince = undefined;
      return undefined;
    }
    stoppedSince ??= time;
    return time - stoppedSince >= STOPPED_FOR_MS ? 'context-not-running' : undefined;
  };

  return {
    sample: (sample) => {
      const time = now();
      if (sample.level !== undefined) followLevel(sample.level, time);
      return judgeContext(sample.contextRunning, time) ?? judgeSilence(sample, time);
    },
    interrupted: () => {
      unexplained++;
      if (startedAt !== undefined && now() - startedAt <= INTERRUPTED_TOO_SOON_MS) return 'echo-early-interruption';
      return unexplained >= UNEXPLAINED_INTERRUPTIONS ? 'echo-unexplained-interruptions' : undefined;
    },
    agentSaid: (text) => transcripts.agentSaid(text),
    userSaid: (text) => {
      unexplained = 0;
      return transcripts.userSaid(text) ? 'echo-transcript' : undefined;
    },
    reset: () => {
      transcripts.reset();
      quietSince = Number.NEGATIVE_INFINITY;
      startedAt = undefined;
      unexplained = 0;
      silentSince = undefined;
      stoppedSince = undefined;
    },
  };
}
